"""
findr-images
handles photo uploads + rekognition analysis

POST /images/upload-url  -> presigned s3 put url
POST /images/analyse     -> rekognition labels + bedrock description

env vars: UPLOAD_BUCKET, BEDROCK_MODEL, ENABLE_BEDROCK, CUSTOM_MODEL_ARN
"""

import os
import json
import uuid
import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "ap-southeast-2")
UPLOAD_BUCKET = os.environ["UPLOAD_BUCKET"]
BEDROCK_MODEL = os.environ.get("BEDROCK_MODEL", "apac.amazon.nova-lite-v1:0")
ENABLE_BEDROCK = os.environ.get("ENABLE_BEDROCK", "true").lower() == "true"

# our own trained model. blank = off, and it's also "off" whenever the model
# isn't running, since custom labels bills by the hour we keep it stopped
CUSTOM_MODEL_ARN = os.environ.get("CUSTOM_MODEL_ARN", "").strip()
CUSTOM_MIN_CONFIDENCE = 60

s3 = boto3.client("s3", region_name=REGION)
rekognition = boto3.client("rekognition", region_name=REGION)
bedrock = boto3.client("bedrock-runtime", region_name=REGION) if ENABLE_BEDROCK else None

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
}

ALLOWED_TYPES = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

# bedrock's converse api names formats slightly differently to our extensions
EXT_TO_BEDROCK_FORMAT = {"jpg": "jpeg", "png": "png", "webp": "webp"}

# bedrock rejects very large payloads, and we already cap uploads at 5MB
# client side. this is the backstop for anything that slips past
MAX_IMAGE_BYTES = 4 * 1024 * 1024

CATEGORY_MAP = {
    "Bottle": "Bottle", "Wallet": "Wallet", "Phone": "Phone",
    "Mobile Phone": "Phone", "Laptop": "Laptop", "Computer": "Laptop",
    "Backpack": "Bag", "Bag": "Bag", "Handbag": "Bag", "Key": "Keys",
    "Umbrella": "Umbrella", "Headphones": "Electronics", "Earbuds": "Electronics",
    "Charger": "Electronics", "Adapter": "Electronics", "Watch": "Electronics",
    "Glasses": "Others", "Jacket": "Clothing", "Clothing": "Clothing",
    "Shoe": "Clothing", "Card": "Others",
    "Book": "School Materials", "Notebook": "School Materials",
    "Pen": "School Materials", "Pencil": "School Materials",
    "Paper": "School Materials", "Page": "School Materials",
    "Text": "School Materials", "Calculator": "School Materials",
}

# what the UI tells the user about where the labels came from. kept here rather
# than in the frontend so the wording can't drift between the two
SOURCE_NOTICE = {
    "custom-model": (
        "Identified by the Findr Custom Model, trained on our own campus "
        "lost-property dataset. The AWS pretrained model is shown below only "
        "as supporting detail."
    ),
    "custom-model-no-match": (
        "The Findr Custom Model is running but did not recognise this item as "
        "one of its trained categories. The labels below come from the AWS "
        "pretrained general model instead."
    ),
    "pretrained-fallback": (
        "The Findr Custom Model is currently stopped, so this image was "
        "analysed using the AWS pretrained general model. Results are less "
        "specific to campus lost property than the trained model would be."
    ),
}


def respond(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", **CORS},
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    method = event.get("httpMethod", "")
    path = event.get("path", "")

    if method == "OPTIONS":
        return respond(200, {"ok": True})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return respond(400, {"success": False, "message": "Request body is not valid JSON."})

    try:
        if path.endswith("/upload-url") and method == "POST":
            return get_upload_url(body)
        if path.endswith("/analyse") and method == "POST":
            return analyse_image(body)
        return respond(404, {"success": False, "message": f"No route for {method} {path}"})
    except ClientError as e:
        code = e.response["Error"]["Code"]
        print(f"AWS ClientError: {code} - {e}")
        return respond(500, {"success": False, "message": f"AWS error: {code}"})
    except Exception as e:
        print(f"Unhandled error: {e}")
        return respond(500, {"success": False, "message": "Internal server error."})


def get_upload_url(body):
    # browser uploads straight to s3 with this url, so the image never goes through
    # lambda and the bucket can stay private. url dies after 5 min
    content_type = (body.get("contentType") or "").lower()

    if content_type not in ALLOWED_TYPES:
        return respond(400, {
            "success": False,
            "message": "Only JPEG, PNG and WebP images are accepted.",
        })

    key = f"uploads/{uuid.uuid4().hex}.{ALLOWED_TYPES[content_type]}"

    url = s3.generate_presigned_url(
        ClientMethod="put_object",
        Params={"Bucket": UPLOAD_BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=300,
    )

    return respond(200, {"success": True, "uploadUrl": url, "key": key})


def analyse_image(body):
    key = body.get("key")
    if not key or not key.startswith("uploads/"):
        return respond(400, {"success": False, "message": "A valid image key is required."})

    # check it's not something dodgy before we do anything else
    moderation = rekognition.detect_moderation_labels(
        Image={"S3Object": {"Bucket": UPLOAD_BUCKET, "Name": key}},
        MinConfidence=70,
    )
    if moderation.get("ModerationLabels"):
        names = ", ".join(sorted({m["Name"] for m in moderation["ModerationLabels"]}))
        print(f"Rejected upload {key} - moderation flags: {names}")
        try:
            s3.delete_object(Bucket=UPLOAD_BUCKET, Key=key)
        except ClientError:
            pass
        return respond(400, {
            "success": False,
            "moderationBlocked": True,
            "message": "This image was flagged as inappropriate and was not saved.",
        })

    status, custom = detect_custom_category(key)

    # pretrained model always runs: supporting detail when ours is up, a
    # labelled fallback when it's stopped. the response says which happened
    result = rekognition.detect_labels(
        Image={"S3Object": {"Bucket": UPLOAD_BUCKET, "Name": key}},
        MaxLabels=12,
        MinConfidence=70,
    )

    labels = [
        {"Name": l["Name"], "Confidence": round(l["Confidence"], 1)}
        for l in result.get("Labels", [])
    ]
    label_names = [l["Name"] for l in labels]

    if status == "ok" and custom:
        analysis_source = "custom-model"
    elif status == "no-match":
        analysis_source = "custom-model-no-match"
    else:
        analysis_source = "pretrained-fallback"

    custom_model_online = status in ("ok", "no-match")

    if not labels and not custom:
        return respond(200, {
            "success": True,
            "customModelStatus": status,
            "customModelOnline": custom_model_online,
            "analysisSource": analysis_source,
            "sourceNotice": SOURCE_NOTICE[analysis_source],
            "modelAvailable": custom_model_online,
            "labels": [],
            "labelNames": [],
            "suggestedCategory": "Others",
            "customLabel": None,
            "detectedText": [],
            "aiDescription": "",
            "message": "No objects were confidently recognised in this image.",
        })

    # our trained model gives us a findr category straight off, no mapping needed
    if custom:
        suggested = custom["Name"]
    else:
        # walk the labels by confidence, not the order of CATEGORY_HINTS.
        # rekognition returned Canopy/Accessories/Wallet for an umbrella and
        # the old loop picked Wallet purely because it appears earlier in the list
        suggested = "Others"
        by_confidence = sorted(labels, key=lambda l: l["Confidence"], reverse=True)
        for label in by_confidence:
            if label["Name"] in CATEGORY_MAP:
                suggested = CATEGORY_MAP[label["Name"]]
                break

    # any writing on the item? like a name on a bottle. still shown and stored,
    # but not sent to bedrock any more - see write_description
    detected_text = []
    try:
        text_result = rekognition.detect_text(
            Image={"S3Object": {"Bucket": UPLOAD_BUCKET, "Name": key}}
        )
        detected_text = [
            d["DetectedText"]
            for d in text_result.get("TextDetections", [])
            if d["Type"] == "LINE" and d["Confidence"] > 80
        ][:5]
    except ClientError as e:
        print(f"DetectText skipped: {e}")

    ai_description = ""
    if ENABLE_BEDROCK:
        ai_description = write_description(
            key=key,
            custom=custom,
            label_names=label_names,
            user_notes=body.get("userNotes", ""),
        )

    return respond(200, {
        "success": True,
        # --- provenance: the UI uses these to show who identified what
        "customModelStatus": status,                 # ok | no-match | off | error
        "customModelOnline": custom_model_online,
        "analysisSource": analysis_source,
        "sourceNotice": SOURCE_NOTICE[analysis_source],
        # kept so the old frontend check doesn't break during rollout
        "modelAvailable": custom_model_online,
        "labels": labels,
        "labelNames": label_names,
        "suggestedCategory": suggested,
        "customLabel": custom,
        "categorySource": "custom-model" if custom else "pretrained",
        "detectedText": detected_text,
        "aiDescription": ai_description,
    })


def detect_custom_category(key):
    """
    runs our trained classifier.

    returns (status, label) where status is one of:
      "ok"          model answered
      "no-match"    model is running but didn't recognise this object
      "off"         model is stopped or not configured
      "error"       something else went wrong

    "off" matters because custom labels bills by the hour, so the model gets
    stopped when it isn't in use. when it's off we fall back to the pretrained
    model but tell the user so, rather than passing generic labels off as ours
    """
    if not CUSTOM_MODEL_ARN:
        return "off", None

    try:
        result = rekognition.detect_custom_labels(
            ProjectVersionArn=CUSTOM_MODEL_ARN,
            Image={"S3Object": {"Bucket": UPLOAD_BUCKET, "Name": key}},
            MinConfidence=CUSTOM_MIN_CONFIDENCE,
        )
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code in ("ResourceNotReadyException", "ResourceNotFoundException"):
            print(f"Custom model not running ({code})")
            return "off", None
        print(f"Custom labels error: {code} - {e}")
        return "error", None
    except Exception as e:
        print(f"Custom labels unavailable: {e}")
        return "error", None

    found = result.get("CustomLabels", [])
    if not found:
        return "no-match", None

    best = max(found, key=lambda c: c.get("Confidence", 0))
    return "ok", {"Name": best["Name"], "Confidence": round(best.get("Confidence", 0), 1)}


def load_image_for_bedrock(key):
    # pulls the object out of s3 so we can hand the real pixels to bedrock.
    # (None, None) if it can't be used, the description just runs without it
    ext = key.rsplit(".", 1)[-1].lower() if "." in key else ""
    fmt = EXT_TO_BEDROCK_FORMAT.get(ext)
    if not fmt:
        print(f"Unsupported extension for bedrock: {ext}")
        return None, None

    try:
        obj = s3.get_object(Bucket=UPLOAD_BUCKET, Key=key)
        data = obj["Body"].read()
    except ClientError as e:
        print(f"Could not read {key} for bedrock: {e}")
        return None, None

    if len(data) > MAX_IMAGE_BYTES:
        print(f"Image {key} too large for bedrock ({len(data)} bytes)")
        return None, None

    return data, fmt


def write_description(key, custom, label_names, user_notes):
    # bedrock sees the actual image plus our trained model's answer, which is
    # given priority over the generic pretrained labels. detect_text is
    # deliberately not sent - the model can read the photo itself and work out
    # what's a watermark. if bedrock is down we return "" and carry on fine
    if not bedrock:
        return ""

    image_bytes, image_format = load_image_for_bedrock(key)

    # ---- identification block, trained model first ----
    if custom:
        identity = (
            "ITEM TYPE (authoritative):\n"
            "A specialist image classifier, trained specifically on this campus "
            "lost-property dataset, has classified this item as: "
            f"{custom['Name']} ({custom['Confidence']}% confidence).\n"
            "Treat this classification as correct. Do not contradict it.\n"
        )
        if label_names:
            identity += (
                "\nSUPPORTING DETAIL (lower priority, general-purpose model):\n"
                f"{', '.join(label_names)}\n"
                "Use these only for extra detail such as material, colour or "
                "shape. They must never override the item type above, and you "
                "should ignore any that contradict it.\n"
            )
    else:
        identity = (
            "ITEM TYPE:\n"
            "The specialist classifier did not identify this item, so only a "
            "general-purpose image labelling service was available. It suggested:\n"
            f"{', '.join(label_names) if label_names else '(no confident labels)'}\n"
            "These labels are generic and may be wrong. Rely mainly on the image.\n"
        )

    notes_hint = f"\nThe user added this note: {user_notes}\n" if user_notes else ""

    prompt = (
        "You are helping a student write a lost-and-found listing for a campus "
        "website. You can see the photograph of the item.\n\n"
        f"{identity}{notes_hint}\n"
        "Write ONE description of the item, 25 words maximum, in plain British "
        "English.\n\n"
        "Rules:\n"
        "- Describe only what you can actually see in the photograph.\n"
        "- Never invent a brand, model, colour or material you cannot see.\n"
        "- Photographs may contain watermarks, stock-photo text, logos or "
        "captions overlaid on the image. Ignore all such text completely. Only "
        "mention writing that is physically printed on or attached to the item "
        "itself.\n"
        "- If the photograph shows several similar objects rather than one, "
        "describe the type of item generically and do not describe the details "
        "of any single one of them.\n"
        "- Do not add preamble, quotes, labels or explanation.\n\n"
        "Return only the description sentence."
    )

    content = []
    if image_bytes:
        content.append({"image": {"format": image_format, "source": {"bytes": image_bytes}}})
    content.append({"text": prompt})

    try:
        response = bedrock.converse(
            modelId=BEDROCK_MODEL,
            messages=[{"role": "user", "content": content}],
            inferenceConfig={"maxTokens": 120, "temperature": 0.2},
        )
        return response["output"]["message"]["content"][0]["text"].strip()
    except Exception as e:
        print(f"Bedrock unavailable, continuing without AI description: {e}")
        return ""
