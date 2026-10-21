"""
findr-match
finds found items that might be someone's lost item (and vice versa)

POST /match   body: {"reportId": "..."} or {"type","title","description","labels"}

two stages: cheap label overlap to shortlist, then bedrock re-ranks on meaning.
part 1 only did exact label overlap so "silver flask" never matched
"metal water bottle" even though it's obviously the same thing

env vars: REPORTS_TABLE, UPLOAD_BUCKET, BEDROCK_MODEL, ENABLE_BEDROCK
"""

import os
import json
import decimal

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "ap-southeast-2")
REPORTS_TABLE = os.environ["REPORTS_TABLE"]
UPLOAD_BUCKET = os.environ["UPLOAD_BUCKET"]
BEDROCK_MODEL = os.environ.get("BEDROCK_MODEL", "apac.amazon.nova-lite-v1:0")
ENABLE_BEDROCK = os.environ.get("ENABLE_BEDROCK", "true").lower() == "true"

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(REPORTS_TABLE)
s3 = boto3.client("s3", region_name=REGION)
bedrock = boto3.client("bedrock-runtime", region_name=REGION) if ENABLE_BEDROCK else None

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
}

SHORTLIST_SIZE = 8
RESULT_SIZE = 4


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, decimal.Decimal):
            return int(o) if o % 1 == 0 else float(o)
        return super().default(o)


def respond(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", **CORS},
        "body": json.dumps(body, cls=DecimalEncoder),
    }


def image_url(key):
    if not key:
        return ""
    try:
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": UPLOAD_BUCKET, "Key": key},
            ExpiresIn=3600,
        )
    except ClientError:
        return ""


def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return respond(200, {"ok": True})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return respond(400, {"success": False, "message": "Request body is not valid JSON."})

    try:
        return find_matches(body)
    except ClientError as e:
        print(f"AWS ClientError: {e}")
        return respond(500, {"success": False, "message": "AWS error while matching."})
    except Exception as e:
        print(f"Unhandled error: {e}")
        return respond(500, {"success": False, "message": "Internal server error."})


def find_matches(body):
    if body.get("reportId"):
        source = table.get_item(Key={"reportId": body["reportId"]}).get("Item")
        if not source:
            return respond(404, {"success": False, "message": "Report not found."})
    else:
        source = {
            "type": (body.get("type") or "lost").lower(),
            "title": body.get("title", ""),
            "description": body.get("description", ""),
            "category": body.get("category", ""),
            "location": body.get("location", ""),
            "rekognitionLabels": body.get("labels") or [],
            "reportId": None,
        }

    # lost items get matched against found ones and the other way round
    opposite = "found" if source.get("type") == "lost" else "lost"

    result = table.query(
        IndexName="type-createdAt-index",
        KeyConditionExpression=Key("type").eq(opposite),
        ScanIndexForward=False,
    )
    candidates = [
        c for c in result.get("Items", [])
        if c.get("status") != "Closed" and c.get("reportId") != source.get("reportId")
    ]

    if not candidates:
        return respond(200, {"success": True, "matches": [], "method": "none",
                             "message": f"No open {opposite} reports to compare against yet."})

    scored = [(c, jaccard(source.get("rekognitionLabels") or [],
                          c.get("rekognitionLabels") or [])) for c in candidates]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    shortlist = [c for c, _ in scored[:SHORTLIST_SIZE]]

    if ENABLE_BEDROCK:
        ranked = semantic_rank(source, shortlist)
        if ranked is not None:
            return respond(200, {"success": True, "method": "bedrock", "matches": ranked[:RESULT_SIZE]})

    # bedrock off or broken, fall back to plain label overlap
    fallback = [
        {
            "report": present(c),
            "score": int(round(score * 100)),
            "reason": "Matched on shared image labels.",
        }
        for c, score in scored[:RESULT_SIZE] if score > 0
    ]
    return respond(200, {"success": True, "method": "labels", "matches": fallback})


def jaccard(a, b):
    # overlap / union. 1.0 means identical label sets, 0.0 means nothing shared
    set_a = {str(x).lower() for x in a}
    set_b = {str(x).lower() for x in b}
    if not set_a or not set_b:
        return 0.0
    union = set_a | set_b
    return len(set_a & set_b) / len(union) if union else 0.0


def present(item):
    return {
        "reportId": item.get("reportId"),
        "title": item.get("title"),
        "description": item.get("description"),
        "category": item.get("category"),
        "location": item.get("location"),
        "date": item.get("date"),
        "status": item.get("status"),
        "type": item.get("type"),
        "userName": item.get("userName"),
        "imageUrl": image_url(item.get("imageKey")),
        "rekognitionLabels": item.get("rekognitionLabels") or [],
    }


def semantic_rank(source, shortlist):
    # returns None if anything goes wrong so the caller can fall back
    def describe(item, index=None):
        prefix = f"[{index}] " if index is not None else ""
        return (
            f"{prefix}Title: {item.get('title')}\n"
            f"    Description: {item.get('description')}\n"
            f"    Category: {item.get('category')}\n"
            f"    Location: {item.get('location')}\n"
            f"    Image labels: {', '.join(str(l) for l in (item.get('rekognitionLabels') or []))}"
        )

    candidate_text = "\n".join(describe(c, i) for i, c in enumerate(shortlist))

    prompt = (
        "You are matching lost-and-found reports on a university campus.\n\n"
        f"SOMEONE REPORTED THIS {source.get('type', 'lost').upper()} ITEM:\n"
        f"{describe(source)}\n\n"
        f"CANDIDATE REPORTS:\n{candidate_text}\n\n"
        "For each candidate, judge how likely it is to be the SAME PHYSICAL OBJECT. "
        "Different wording for the same thing should score high - 'silver flask' and "
        "'metal water bottle' are very likely the same item. Different object types "
        "should score low even if the words look similar. Consider whether the "
        "locations and dates are consistent.\n\n"
        "Respond with ONLY a JSON array, no markdown fences and no commentary, like:\n"
        '[{"index": 0, "score": 87, "reason": "Both describe a metal drinking bottle '
        'found near the library within a day of each other."}]\n\n'
        "Include only candidates scoring above 40. Keep each reason under 20 words. "
        "Order by score, highest first."
    )

    try:
        response = bedrock.converse(
            modelId=BEDROCK_MODEL,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 700, "temperature": 0.2},
        )
        raw = response["output"]["message"]["content"][0]["text"].strip()

        # models like wrapping json in ``` fences even when told not to
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        parsed = json.loads(raw)

        matches = []
        for entry in parsed:
            idx = entry.get("index")
            if not isinstance(idx, int) or not 0 <= idx < len(shortlist):
                continue
            score = entry.get("score", 0)
            if not isinstance(score, (int, float)) or score <= 40:
                continue
            matches.append({
                "report": present(shortlist[idx]),
                "score": int(score),
                "reason": str(entry.get("reason", ""))[:160],
            })

        matches.sort(key=lambda m: m["score"], reverse=True)
        return matches

    except Exception as e:
        print(f"Bedrock ranking failed, falling back to label matching: {e}")
        return None
