"""
findr-reports
all the crud for lost/found reports

GET    /reports        list, filters: ?type= &category= &status= &search=
GET    /reports/mine   the caller's own reports, including their secretDetails
GET    /reports/{id}   read one
POST   /reports        create (needs login)
PUT    /reports/{id}   update (owner or admin)
DELETE /reports/{id}   delete (owner or admin)

env vars: REPORTS_TABLE, UPLOAD_BUCKET, SNS_TOPIC_ARN
"""

import os
import json
import uuid
import decimal
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "ap-southeast-2")
REPORTS_TABLE = os.environ["REPORTS_TABLE"]
UPLOAD_BUCKET = os.environ["UPLOAD_BUCKET"]
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(REPORTS_TABLE)
s3 = boto3.client("s3", region_name=REGION)
sns = boto3.client("sns", region_name=REGION)

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
}

VALID_TYPES = {"lost", "found"}
VALID_STATUSES = {"Open", "Claimed", "Closed"}
MAX_TITLE = 120
MAX_DESC = 1000


class DecimalEncoder(json.JSONEncoder):
    # dynamodb hands back Decimal and json.dumps chokes on it
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
    # api gateway already checked the jwt before we got here, so these claims
    # are safe to trust. never read the user id off the request body
    try:
        claims = event["requestContext"]["authorizer"]["claims"]
        return {
            "id": claims["sub"],
            "email": claims.get("email", ""),
            "name": claims.get("name") or claims.get("email", "User"),
            "isAdmin": "admin" in claims.get("cognito:groups", ""),
        }
    except (KeyError, TypeError):
        return None


def image_url(key):
    # bucket is private so we hand out a temporary link instead
    if not key:
        return ""
    try:
        return s3.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": UPLOAD_BUCKET, "Key": key},
            ExpiresIn=3600,
        )
    except ClientError as e:
        print(f"Could not presign {key}: {e}")
        return ""


def decorate(item, user=None):
    """
    SECURITY: secretDetails are the private facts used to verify ownership
    claims. every read path goes through here, so stripping in one place covers
    list, get, create and update.

    the one exception is the person who wrote them - they need them back to edit
    their own report. everyone else only learns whether any exist
    """
    item = dict(item)
    item["imageUrl"] = image_url(item.get("imageKey"))

    details = item.pop("secretDetails", [])
    item.pop("secretDetail", None)      # older reports, before this was a list
    item.pop("ownerName", None)         # dropped feature, strip any leftovers

    item["hasSecretDetails"] = bool(details)

    is_owner = bool(user) and user.get("id") == item.get("userId")
    is_admin = bool(user) and user.get("isAdmin")

    if is_owner and details:
        item["secretDetails"] = details

    # /reports is public, so anything left on this dict is world readable.
    # the reporter's email address and the claim records (which carry the
    # claimant's name, email and score) are only for the owner and admins
    item.pop("userEmail", None)
    if not (is_owner or is_admin):
        item.pop("verification", None)
        item.pop("lastClaimAttempt", None)

    return item


def notify(subject, message):
    # a failed notification should never kill the actual request
    if not SNS_TOPIC_ARN:
        return
    try:
        sns.publish(TopicArn=SNS_TOPIC_ARN, Subject=subject[:100], Message=message)
    except ClientError as e:
        print(f"SNS publish failed: {e}")


def lambda_handler(event, context):
    method = event.get("httpMethod", "")
    if method == "OPTIONS":
        return respond(200, {"ok": True})

    path = event.get("path", "")
    report_id = (event.get("pathParameters") or {}).get("id")

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return respond(400, {"success": False, "message": "Request body is not valid JSON."})

    try:
        if method == "GET" and path.endswith("/reports/mine"):
            return read_mine(get_user(event))
        if method == "GET" and report_id:
            return read_one(report_id, get_user(event))
        if method == "GET":
            return read_many(event.get("queryStringParameters") or {}, get_user(event))
        if method == "POST":
            return create(body, get_user(event))
        if method == "PUT" and report_id:
            return update(report_id, body, get_user(event))
        if method == "DELETE" and report_id:
            return delete(report_id, get_user(event))
        return respond(405, {"success": False, "message": f"{method} not allowed here."})
    except ClientError as e:
        code = e.response["Error"]["Code"]
        print(f"AWS ClientError: {code} - {e}")
        return respond(500, {"success": False, "message": f"AWS error: {code}"})
    except Exception as e:
        print(f"Unhandled error: {e}")
        return respond(500, {"success": False, "message": "Internal server error."})


def read_many(params, user=None):
    type_filter = (params.get("type") or "").lower()
    category = params.get("category")
    status = params.get("status")
    search = (params.get("search") or "").strip().lower()

    # query on the index only reads matching rows and comes back sorted already.
    # scan reads the whole table, so we only fall back to it when there's no type filter
    if type_filter in VALID_TYPES:
        result = table.query(
            IndexName="type-createdAt-index",
            KeyConditionExpression=Key("type").eq(type_filter),
            ScanIndexForward=False,
        )
    else:
        result = table.scan()

    items = result.get("Items", [])

    if category:
        items = [i for i in items if i.get("category") == category]
    if status:
        items = [i for i in items if i.get("status") == status]
    if search:
        items = [
            i for i in items
            if search in str(i.get("title", "")).lower()
            or search in str(i.get("description", "")).lower()
            or search in str(i.get("location", "")).lower()
        ]

    items.sort(key=lambda i: i.get("createdAt", ""), reverse=True)

    return respond(200, {
        "success": True,
        "reports": [decorate(i, user) for i in items],
        "total": len(items),
    })


def read_mine(user):
    """
    the signed in user's own reports.

    /reports is public so anyone can browse, which means get_user() is None
    there and decorate() can never tell that the caller owns a row. this route
    has the cognito authorizer on it, so the owner gets their own
    secretDetails back and the edit form can show what they actually wrote
    """
    if not user:
        return respond(401, {"success": False, "message": "You must be signed in."})

    items = table.scan().get("Items", [])
    mine = [i for i in items if i.get("userId") == user["id"]]
    mine.sort(key=lambda i: i.get("createdAt", ""), reverse=True)

    return respond(200, {
        "success": True,
        "reports": [decorate(i, user) for i in mine],
        "total": len(mine),
    })


def read_one(report_id, user=None):
    item = table.get_item(Key={"reportId": report_id}).get("Item")
    if not item:
        return respond(404, {"success": False, "message": "Report not found."})

    verification = item.get("verification")
    report = decorate(item, user)

    # the "ownership verified" banner is public, but only the display name and
    # the score - not the claimant's email address
    if verification and "verification" not in report:
        report["verification"] = {
            "claimedByName": verification.get("claimedByName", ""),
            "answerConfidence": verification.get("answerConfidence", 0),
            "approved": verification.get("approved", False),
        }

    return respond(200, {"success": True, "report": report})


def create(body, user):
    if not user:
        return respond(401, {"success": False, "message": "You must be signed in to submit a report."})

    report_type = (body.get("type") or "").lower()
    title = (body.get("title") or "").strip()
    description = (body.get("description") or "").strip()
    location = (body.get("location") or "").strip()

    if report_type not in VALID_TYPES:
        return respond(400, {"success": False, "message": "Type must be 'lost' or 'found'."})
    if not title:
        return respond(400, {"success": False, "message": "A title is required."})
    if len(title) > MAX_TITLE:
        return respond(400, {"success": False, "message": f"Title must be under {MAX_TITLE} characters."})
    if len(description) > MAX_DESC:
        return respond(400, {"success": False, "message": f"Description must be under {MAX_DESC} characters."})
    if not location:
        return respond(400, {"success": False, "message": "A location is required."})

    now = datetime.now(timezone.utc).isoformat()

    item = {
        "reportId": uuid.uuid4().hex,
        "type": report_type,
        "title": title,
        "description": description,
        "category": body.get("category") or "Others",
        "location": location,
        "date": body.get("date") or now[:10],
        "status": "Open",
        "userId": user["id"],
        "userName": user["name"],
        "userEmail": user["email"],
        "imageKey": body.get("imageKey", ""),
        "rekognitionLabels": body.get("rekognitionLabels") or [],
        "detectedText": body.get("detectedText") or [],
        "createdAt": now,
    }

    # private verification details, found items only. stored, and only ever
    # read back out to the person who wrote them
    if report_type == "found":
        details = [str(d).strip()[:300] for d in (body.get("secretDetails") or []) if str(d).strip()]
        if details:
            item["secretDetails"] = details[:3]

    # coords from the map picker, if they used it
    if body.get("lat") is not None and body.get("lng") is not None:
        try:
            item["lat"] = decimal.Decimal(str(round(float(body["lat"]), 6)))
            item["lng"] = decimal.Decimal(str(round(float(body["lng"]), 6)))
        except (TypeError, ValueError):
            pass

    table.put_item(Item=item)

    notify(
        f"Findr: new {report_type} item reported",
        f"{user['name']} reported a {report_type} item.\n\n"
        f"Item: {title}\nLocation: {location}\nCategory: {item['category']}\n"
        f"Reported at: {now}\n",
    )

    return respond(201, {
        "success": True,
        "message": "Report submitted successfully!",
        "report": decorate(item, user),
    })


def update(report_id, body, user):
    if not user:
        return respond(401, {"success": False, "message": "You must be signed in."})

    existing = table.get_item(Key={"reportId": report_id}).get("Item")
    if not existing:
        return respond(404, {"success": False, "message": "Report not found."})

    if existing["userId"] != user["id"] and not user["isAdmin"]:
        return respond(403, {"success": False, "message": "You can only edit your own reports."})

    editable = ["title", "description", "category", "location", "date", "status"]
    updates, names, values = [], {}, {}

    for field in editable:
        if field not in body:
            continue
        value = body[field]
        if field == "status" and value not in VALID_STATUSES:
            return respond(400, {"success": False, "message": f"Status must be one of {sorted(VALID_STATUSES)}."})
        if field in ("title", "description", "location"):
            value = str(value).strip()
        # status/date/location are reserved words in dynamodb so everything
        # goes through #placeholders
        updates.append(f"#{field} = :{field}")
        names[f"#{field}"] = field
        values[f":{field}"] = value

    # let them move the map pin
    for coord in ("lat", "lng"):
        if coord in body and body[coord] is not None:
            try:
                updates.append(f"{coord} = :{coord}")
                values[f":{coord}"] = decimal.Decimal(str(round(float(body[coord]), 6)))
            except (TypeError, ValueError):
                updates.pop()

    # the finder can rewrite their private verification details too.
    # an empty list is ignored rather than written: a stale page that couldn't
    # load the existing details would otherwise submit three blank boxes and
    # destroy them, taking the claim flow for that item with them
    if "secretDetails" in body:
        details = [str(d).strip()[:300] for d in (body.get("secretDetails") or []) if str(d).strip()]
        if details:
            updates.append("secretDetails = :secretDetails")
            values[":secretDetails"] = details[:3]
        else:
            print(f"Ignoring empty secretDetails for {report_id} - not overwriting")

    if not updates:
        return respond(400, {"success": False, "message": "No editable fields supplied."})

    kwargs = {
        "Key": {"reportId": report_id},
        "UpdateExpression": "SET " + ", ".join(updates),
        "ExpressionAttributeValues": values,
        "ReturnValues": "ALL_NEW",
    }
    if names:
        kwargs["ExpressionAttributeNames"] = names

    result = table.update_item(**kwargs)

    updated = result["Attributes"]

    if "status" in body and body["status"] != existing.get("status"):
        notify(
            "Findr: report status updated",
            f"'{updated['title']}' changed from {existing.get('status')} to {updated['status']}.\n"
            f"Updated by: {user['name']}\n",
        )

    return respond(200, {
        "success": True,
        "message": "Report updated.",
        "report": decorate(updated, user),
    })


def delete(report_id, user):
    if not user:
        return respond(401, {"success": False, "message": "You must be signed in."})

    existing = table.get_item(Key={"reportId": report_id}).get("Item")
    if not existing:
        return respond(404, {"success": False, "message": "Report not found."})

    if existing["userId"] != user["id"] and not user["isAdmin"]:
        return respond(403, {"success": False, "message": "You can only delete your own reports."})

    table.delete_item(Key={"reportId": report_id})

    # bin the photo too so we don't leave junk in s3
    if existing.get("imageKey"):
        try:
            s3.delete_object(Bucket=UPLOAD_BUCKET, Key=existing["imageKey"])
        except ClientError as e:
            print(f"Could not delete image {existing['imageKey']}: {e}")

    return respond(200, {"success": True, "message": "Report deleted."})
