"""
findr-translate
translates a listing into the other official languages

POST /translate   body: {"text": "...", "title": "...", "target": "zh",
                          "extras": ["Library - Level 1", "Umbrella", ...]}

extras is for the short bits on the listing - location, category, labels.
they come back in the same order under "extras"

no env vars needed
"""

import os
import json
import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "ap-southeast-2")
translate = boto3.client("translate", region_name=REGION)

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
}

# locked to these four on purpose, otherwise this endpoint is just a
# free translation api for anyone who finds it
SUPPORTED = {
    "en": "English",
    "zh": "Chinese (Simplified)",
    "ms": "Malay",
    "ta": "Tamil",
}

MAX_CHARS = 2000

# short strings off a listing (location, category, labels) or the
# title+description pairs from the browse grid
MAX_EXTRAS = 40
MAX_EXTRA_CHARS = 400


def respond(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", **CORS},
        "body": json.dumps(body, ensure_ascii=False),
    }


def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return respond(200, {"ok": True})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return respond(400, {"success": False, "message": "Request body is not valid JSON."})

    target = (body.get("target") or "").lower()
    if target not in SUPPORTED:
        return respond(400, {
            "success": False,
            "message": f"Target language must be one of: {', '.join(SUPPORTED)}",
        })

    title = (body.get("title") or "")[:200]
    text = (body.get("text") or "")[:MAX_CHARS]

    extras = [str(e)[:MAX_EXTRA_CHARS] for e in (body.get("extras") or [])][:MAX_EXTRAS]

    if not title and not text and not extras:
        return respond(400, {"success": False, "message": "Nothing to translate."})

    try:
        out = {"success": True, "target": target, "targetName": SUPPORTED[target]}

        # "auto" detects the source, so this also works for translating
        # a non-english listing back into english
        if title:
            r = translate.translate_text(
                Text=title, SourceLanguageCode="auto", TargetLanguageCode=target
            )
            out["title"] = r["TranslatedText"]
            out["detectedSource"] = r.get("SourceLanguageCode", "")

        if text:
            r = translate.translate_text(
                Text=text, SourceLanguageCode="auto", TargetLanguageCode=target
            )
            out["text"] = r["TranslatedText"]
            out.setdefault("detectedSource", r.get("SourceLanguageCode", ""))

        # one short string at a time, order preserved so the page can map them
        # straight back onto the fields they came from. a single failure just
        # leaves that one in english rather than killing the whole listing
        if extras:
            translated = []
            for e in extras:
                if not e.strip():
                    translated.append(e)
                    continue
                try:
                    r = translate.translate_text(
                        Text=e, SourceLanguageCode="auto", TargetLanguageCode=target
                    )
                    translated.append(r["TranslatedText"])
                except ClientError as err:
                    print(f"Extra failed, keeping original: {err}")
                    translated.append(e)
            out["extras"] = translated

        return respond(200, out)

    except ClientError as e:
        code = e.response["Error"]["Code"]
        print(f"Translate error: {code} - {e}")
        if code == "UnsupportedLanguagePairException":
            return respond(400, {"success": False, "message": "That language pair isn't supported."})
        return respond(500, {"success": False, "message": f"Translation failed: {code}"})
    except Exception as e:
        print(f"Unhandled error: {e}")
        return respond(500, {"success": False, "message": "Internal server error."})
