"""
findr-verify
ownership verification for claiming a found item

POST /verify/start        does this item have anything to verify against?
POST /verify/questions    bedrock writes questions from the finder's private details
POST /verify/answers      bedrock marks them, records the claim, emails the finder

when someone reports a found item they can record up to 3 private details -
things they can see but a stranger reading the listing can't. those never leave
the database. on a claim bedrock turns them into open questions, then marks the
answers against the real thing, so reading the public page isn't enough to pass

the finder still gets the final say, we just tell them how it went

env vars: REPORTS_TABLE, SNS_TOPIC_ARN, BEDROCK_MODEL, QUESTION_MODEL
"""

import os
import json
import decimal
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "ap-southeast-2")
REPORTS_TABLE = os.environ["REPORTS_TABLE"]
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "")
BEDROCK_MODEL = os.environ.get("BEDROCK_MODEL", "apac.amazon.nova-lite-v1:0")

# questions only get written when someone starts a claim, so this rare path
# gets the stronger model. marking still runs on the cheaper one
QUESTION_MODEL = os.environ.get("QUESTION_MODEL", "apac.amazon.nova-pro-v1:0")

bedrock = boto3.client("bedrock-runtime", region_name=REGION)
dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(REPORTS_TABLE)
sns = boto3.client("sns", region_name=REGION)

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
}

ANSWER_THRESHOLD = 60      # bedrock's confidence % needed to accept a claim


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


def get_user(event):
    try:
        claims = event["requestContext"]["authorizer"]["claims"]
        return {
            "id": claims["sub"],
            "email": claims.get("email", ""),
            "name": claims.get("name") or claims.get("email", "User"),
        }
    except (KeyError, TypeError):
        return None


def load_report(report_id, user):
    """fetch a report and check this user is actually allowed to claim it"""
    report = table.get_item(Key={"reportId": report_id}).get("Item")
    if not report:
        return None, respond(404, {"success": False, "message": "Report not found."})
    if report.get("userId") == user["id"]:
        return None, respond(400, {"success": False, "message": "This is your own report."})
    if report.get("type") != "found":
        return None, respond(400, {"success": False, "message": "Only found items can be claimed."})
    if report.get("status") != "Open":
        return None, respond(400, {"success": False, "message": "This item is no longer open for claims."})
    return report, None


def lambda_handler(event, context):
    method = event.get("httpMethod", "")
    path = event.get("path", "")

    if method == "OPTIONS":
        return respond(200, {"ok": True})

    user = get_user(event)
    if not user:
        return respond(401, {"success": False, "message": "You must be signed in to claim an item."})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return respond(400, {"success": False, "message": "Request body is not valid JSON."})

    try:
        if path.endswith("/start"):
            return start(body, user)
        if path.endswith("/questions"):
            return make_questions(body, user)
        if path.endswith("/answers"):
            return mark_answers(body, user)
        return respond(404, {"success": False, "message": f"No route for {path}"})
    except ClientError as e:
        code = e.response["Error"]["Code"]
        print(f"AWS ClientError: {code} - {e}")
        return respond(500, {"success": False, "message": f"AWS error: {code}"})
    except Exception as e:
        print(f"Unhandled error: {e}")
        return respond(500, {"success": False, "message": "Internal server error."})


# -------------------------------------------------------------------- start

def start(body, user):
    """
    an item with no private details has nothing to check a claim against, so
    say so rather than running a check that proves nothing
    """
    report, err = load_report(body.get("reportId", ""), user)
    if err:
        return err

    details = report.get("secretDetails") or []

    return respond(200, {
        "success": True,
        "questionCount": min(len(details), 3),
        "verifiable": bool(details),
    })


# ----------------------------------------------------------------- questions

def make_questions(body, user):
    report, err = load_report(body.get("reportId", ""), user)
    if err:
        return err

    details = report.get("secretDetails") or []
    if not details:
        return respond(400, {
            "success": False,
            "message": "This item has no verification details recorded.",
        })

    numbered = "\n".join(f"{i+1}. {d}" for i, d in enumerate(details))

    prompt = (
        "You are helping verify that someone genuinely owns a lost item on a campus "
        "lost-and-found website.\n\n"
        f"PUBLIC INFORMATION about the item (the claimant can already read all of this):\n"
        f"Title: {report.get('title')}\n"
        f"Description: {report.get('description')}\n"
        f"Category: {report.get('category')}\n"
        f"Found at: {report.get('location')}\n\n"
        f"PRIVATE FACTS recorded by the finder - NEVER reveal or hint at these:\n{numbered}\n\n"
        f"Write exactly {len(details)} questions, one per private fact, in the same order.\n\n"
        "RULES - every question must satisfy all of these:\n"
        "1. The true owner must be able to answer it correctly using ONLY the "
        "information contained in the corresponding private fact. If your question "
        "asks for something the fact does not state, it is invalid.\n"
        "2. Never ask for a quantity, number, measurement, brand, colour, date or "
        "price unless that private fact explicitly states one. This is the most "
        "common mistake: given the fact 'there is a coin compartment inside', "
        "asking 'how many compartments does it have?' is WRONG, because the fact "
        "never states a number and the real owner would fail.\n"
        "3. Do not repeat the distinctive wording of the fact back in the question - "
        "asking 'is there a receipt inside?' gives the answer away. Ask about the "
        "general area the fact covers and let the claimant supply the specific.\n"
        "4. Never ask a yes/no question. Begin with What, Which, Where or Describe.\n"
        "5. Someone who has only read the public information above must not be able "
        "to guess the answer.\n"
        "6. Keep each question under 15 words.\n\n"
        "Before answering, silently check each question against rules 1 and 2 and "
        "rewrite any that fail.\n\n"
        "Respond with ONLY a JSON array of strings, no markdown fences."
    )

    try:
        response = bedrock.converse(
            modelId=QUESTION_MODEL,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 300, "temperature": 0.1},
        )
        raw = response["output"]["message"]["content"][0]["text"].strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        questions = [str(q) for q in json.loads(raw.strip())][:len(details)]
        if not questions:
            raise ValueError("no questions returned")
    except Exception as e:
        print(f"Bedrock question generation failed: {e}")
        # open-ended fallbacks so the flow survives bedrock being unavailable
        fallback = [
            "Describe something about this item that isn't visible in the photo.",
            "What was inside it, or attached to it?",
            "Describe any marks, damage or stickers on it.",
        ]
        questions = fallback[:len(details)]

    return respond(200, {
        "success": True,
        "reportId": report["reportId"],
        "questions": questions,
    })


# ------------------------------------------------------------------- marking

def mark_answers(body, user):
    report, err = load_report(body.get("reportId", ""), user)
    if err:
        return err

    questions = body.get("questions") or []
    answers = body.get("answers") or []
    details = report.get("secretDetails") or []

    if not details:
        return respond(400, {"success": False, "message": "This item has no verification details recorded."})
    if len(questions) != len(answers) or not answers:
        return respond(400, {"success": False, "message": "Questions and answers don't line up."})

    qa = "\n".join(
        f"Fact {i+1}: {details[i] if i < len(details) else '(none)'}\n"
        f"  Question: {q}\n  Their answer: {a}"
        for i, (q, a) in enumerate(zip(questions, answers))
    )

    prompt = (
        "You are checking whether someone genuinely owns a lost item.\n\n"
        "Below, each private fact is paired with the question asked and the "
        "claimant's answer. The claimant has never seen the facts.\n\n"
        f"{qa}\n\n"
        "Score how well the answers match the facts:\n"
        "- Clearly matches, even in different words: 80-100\n"
        "- Partly matches, or vague but not wrong: 40-70\n"
        "- Doesn't match, or is generic waffle that could describe any item: 0-30\n\n"
        "Someone who only read the public listing cannot know these facts, so a "
        "confident answer that misses them should score LOW.\n\n"
        "Respond with ONLY this JSON, no markdown fences:\n"
        '{"confidence": 0-100, "verdict": "one short sentence", '
        '"notes": "one sentence for the finder"}\n'
        "Never quote or reveal the private facts in your verdict or notes."
    )

    try:
        response = bedrock.converse(
            modelId=BEDROCK_MODEL,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 300, "temperature": 0.2},
        )
        raw = response["output"]["message"]["content"][0]["text"].strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed = json.loads(raw.strip())
        confidence = int(parsed.get("confidence", 0))
        verdict = str(parsed.get("verdict", ""))[:200]
        notes = str(parsed.get("notes", ""))[:300]
    except Exception as e:
        print(f"Bedrock marking failed: {e}")
        return respond(200, {
            "success": True,
            "approved": False,
            "confidence": 0,
            "threshold": ANSWER_THRESHOLD,
            "verdict": "Automatic assessment unavailable - the finder will review your claim manually.",
            "notes": "",
        })

    approved = confidence >= ANSWER_THRESHOLD
    now = datetime.now(timezone.utc).isoformat()

    claim = {
        "claimedByUserId": user["id"],
        "claimedByName": user["name"],
        "claimedByEmail": user["email"],
        "answerConfidence": decimal.Decimal(str(confidence)),
        "verdict": verdict,
        "approved": approved,
        "claimedAt": now,
    }

    if approved:
        table.update_item(
            Key={"reportId": report["reportId"]},
            UpdateExpression="SET #s = :s, verification = :v",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": "Claimed", ":v": claim},
        )
    else:
        # keep failed attempts too so the finder can see if someone keeps trying
        table.update_item(
            Key={"reportId": report["reportId"]},
            UpdateExpression="SET lastClaimAttempt = :v",
            ExpressionAttributeValues={":v": claim},
        )

    if SNS_TOPIC_ARN:
        try:
            sns.publish(
                TopicArn=SNS_TOPIC_ARN,
                Subject=("Findr: verified claim" if approved else "Findr: claim attempt failed")[:100],
                Message="\n".join([
                    f"{'A verified claim has been made on' if approved else 'Someone attempted to claim'} "
                    f"your found item: {report.get('title')}",
                    "",
                    f"Claimant: {user['name']} ({user['email']})",
                    f"Answer confidence: {confidence}% (need {ANSWER_THRESHOLD}%)",
                    f"Assessment: {verdict}",
                    notes,
                    "",
                    "The item has been marked as Claimed. Arrange handover with the claimant."
                    if approved else
                    "The claim did not pass verification and the item remains Open.",
                ]),
            )
        except ClientError as e:
            print(f"SNS publish failed: {e}")

    return respond(200, {
        "success": True,
        "approved": approved,
        "confidence": confidence,
        "threshold": ANSWER_THRESHOLD,
        "verdict": verdict,
        "notes": notes,
    })
