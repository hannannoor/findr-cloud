"""
findr-messages
in-app chat between whoever lost the item and whoever found it

GET  /messages                        conversation list for the logged in user
GET  /messages?conversationId=...     all messages in one convo
POST /messages                        send one

table is conversationId (pk) + sentAt (sk), so a query comes back already
in time order. conversationId is built from both user ids sorted + the report
id, so both people always end up on the same convo without a lookup

env vars: MESSAGES_TABLE, SNS_TOPIC_ARN
"""

import os
import json
import decimal
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key, Attr
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "ap-southeast-2")
MESSAGES_TABLE = os.environ["MESSAGES_TABLE"]
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(MESSAGES_TABLE)
sns = boto3.client("sns", region_name=REGION)

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
}

MAX_MESSAGE = 1000


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


def conversation_id(user_a, user_b, report_id):
    first, second = sorted([user_a, user_b])
    return f"{first}#{second}#{report_id}"


def lambda_handler(event, context):
    method = event.get("httpMethod", "")
    if method == "OPTIONS":
        return respond(200, {"ok": True})

    user = get_user(event)
    if not user:
        return respond(401, {"success": False, "message": "You must be signed in to use messages."})

    # conversation ids contain '#', and api gateway 403s on %23 inside a path
    # parameter, so we read it from the query string instead. the path version
    # is still accepted in case anything old calls it
    params = event.get("queryStringParameters") or {}
    convo_id = params.get("conversationId") or (event.get("pathParameters") or {}).get("conversationId")

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return respond(400, {"success": False, "message": "Request body is not valid JSON."})

    try:
        if method == "GET" and convo_id:
            return read_conversation(convo_id, user)
        if method == "GET":
            return list_conversations(user)
        if method == "POST":
            return send_message(body, user)
        return respond(405, {"success": False, "message": f"{method} not allowed here."})
    except ClientError as e:
        print(f"AWS ClientError: {e}")
        return respond(500, {"success": False, "message": "AWS error."})
    except Exception as e:
        print(f"Unhandled error: {e}")
        return respond(500, {"success": False, "message": "Internal server error."})


def list_conversations(user):
    # scan + filter is fine at campus scale. a real app with millions of messages
    # would add a gsi on participant id so this became a query instead
    result = table.scan(FilterExpression=Attr("participants").contains(user["id"]))
    items = result.get("Items", [])

    conversations = {}
    for msg in items:
        cid = msg["conversationId"]
        current = conversations.get(cid)
        if current is None or msg["sentAt"] > current["lastMessageTime"]:
            participants = msg.get("participants", [])
            other_id = next((p for p in participants if p != user["id"]), "")
            conversations[cid] = {
                "id": cid,
                "otherUser": {
                    "id": other_id,
                    "name": msg.get("toName") if msg.get("fromUserId") == user["id"] else msg.get("fromName"),
                },
                "reportId": msg.get("reportId", ""),
                "reportTitle": msg.get("reportTitle", "Unknown item"),
                "lastMessage": msg.get("text", ""),
                "lastMessageTime": msg.get("sentAt", ""),
            }

    ordered = sorted(conversations.values(), key=lambda c: c["lastMessageTime"], reverse=True)
    return respond(200, {"success": True, "conversations": ordered})


def read_conversation(convo_id, user):
    # user id is baked into the convo id so this is a cheap ownership check
    if user["id"] not in convo_id.split("#"):
        return respond(403, {"success": False, "message": "This conversation isn't yours."})

    result = table.query(
        KeyConditionExpression=Key("conversationId").eq(convo_id),
        ScanIndexForward=True,
    )

    messages = [
        {
            "from": m.get("fromUserId"),
            "fromName": m.get("fromName"),
            "text": m.get("text"),
            "time": m.get("sentAt"),
            "mine": m.get("fromUserId") == user["id"],
        }
        for m in result.get("Items", [])
    ]

    return respond(200, {"success": True, "conversationId": convo_id, "messages": messages})


def send_message(body, user):
    to_user_id = (body.get("toUserId") or "").strip()
    text = (body.get("text") or "").strip()
    report_id = (body.get("reportId") or "").strip()

    if not to_user_id or not text or not report_id:
        return respond(400, {
            "success": False,
            "message": "toUserId, reportId and text are all required.",
        })
    if len(text) > MAX_MESSAGE:
        return respond(400, {"success": False, "message": f"Messages must be under {MAX_MESSAGE} characters."})
    if to_user_id == user["id"]:
        return respond(400, {"success": False, "message": "You can't message yourself."})

    now = datetime.now(timezone.utc).isoformat()
    cid = conversation_id(user["id"], to_user_id, report_id)

    item = {
        "conversationId": cid,
        "sentAt": now,
        "fromUserId": user["id"],
        "fromName": user["name"],
        "toUserId": to_user_id,
        "toName": body.get("toName", "User"),
        "participants": [user["id"], to_user_id],
        "reportId": report_id,
        "reportTitle": body.get("reportTitle", ""),
        "text": text,
    }

    table.put_item(Item=item)

    if SNS_TOPIC_ARN:
        try:
            sns.publish(
                TopicArn=SNS_TOPIC_ARN,
                Subject="Findr: you have a new message"[:100],
                Message=(
                    f"{user['name']} sent you a message about "
                    f"'{body.get('reportTitle', 'an item')}':\n\n"
                    f"{text}\n\nOpen Findr to reply."
                ),
            )
        except ClientError as e:
            print(f"SNS publish failed: {e}")

    return respond(201, {
        "success": True,
        "message": "Message sent.",
        "conversationId": cid,
        "sent": {"from": user["id"], "fromName": user["name"], "text": text, "time": now, "mine": True},
    })
