"""
findr-seed
one-off tool that fills the app with demo data, then prints a handout

runs either as a lambda (paste it in, hit Test) or locally (python seed_data.py)

what it does, in order:
  1. finds the cognito user pool from the client id in js/api.js
  2. creates the filler accounts, already confirmed so no email needed
  3. lists the photos you dropped in s3 under uploads/
  4. runs rekognition on each one so the labels are real, not made up
  5. writes reports into findr-reports and a few threads into findr-messages
  6. prints the handout - logins, items, and the answers to the claim questions

every row it writes carries seeded=True, so MODE="purge" removes exactly
what this script created and nothing else

env vars: REPORTS_TABLE, MESSAGES_TABLE, UPLOAD_BUCKET
"""

import os
import json
import uuid
import random
import decimal
from datetime import datetime, timezone, timedelta

import boto3
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

# ------------------------------------------------------------------ config

# "seed"   write the demo data
# "unflag" strip the seeded=True marker so the rows look like any other,
#          saving a manifest first so purge still works afterwards
# "purge"  delete everything this script created
MODE = "seed"

# where the manifest lives. outside SEED_PHOTO_PREFIX so the photo loader
# never sees it, and the app never lists s3 at all
MANIFEST_KEY = "uploads/_seed-manifest.json"

# seed photos live in their own folder, away from the images already attached
# to real reports. sharing a key would mean two reports pointing at one photo,
# and deleting either one would take the picture out from under the other
SEED_PHOTO_PREFIX = "uploads/seed/"

# how many reports each account gets. every report is given its own photo and
# no photo is ever used twice, so the real ceiling is however many images you
# put in the bucket - if you run short the script makes fewer reports rather
# than repeating a picture
REPORTS_PER_USER = 3

# not every found item gets private details - plenty of real listings have
# none, and the app already handles that by hiding the claim button
SECRET_CHANCE = 0.55

REGION = os.environ.get("AWS_REGION", "ap-southeast-2")
REPORTS_TABLE = os.environ.get("REPORTS_TABLE", "findr-reports")
MESSAGES_TABLE = os.environ.get("MESSAGES_TABLE", "findr-messages")
UPLOAD_BUCKET = os.environ.get("UPLOAD_BUCKET", "findr-uploads-XXXXXXXX")

# from js/api.js - used to find the pool so you don't have to look up its id
COGNITO_CLIENT_ID = "16jogn83v7hms86hgjkk6v00mp"

# the four you're handing to your lecturer. create these yourself through the
# normal sign-up page first, then put the addresses here exactly as registered.
# the script gives them reports and conversations so nothing looks empty
HANDOUT_ACCOUNTS = [
    "noorhannan125@gmail.com",       # admin      - Admin Hannan
    "XXXXXXXX@student.tp.edu.sg",    # student 1  - Hannan Noor
    "noorhannan2009@gmail.com",      # student 2  - Jia Ling Toh   (claiming account)
    "dkcheese111@gmail.com",         # student 3  - Arjun Menon
]

# extra accounts the script makes itself, purely so the site looks used.
# these own most of the claimable found items
FILLER_USERS = [
    ("aisyah.rahman@students.tp.edu.sg", "Aisyah Rahman"),
    ("daniel.tan@students.tp.edu.sg", "Daniel Tan"),
    ("priya.kumar@students.tp.edu.sg", "Priya Kumar"),
    ("wei.jie.lim@students.tp.edu.sg", "Lim Wei Jie"),
    ("sarah.chen@students.tp.edu.sg", "Sarah Chen"),
    ("marcus.ong@students.tp.edu.sg", "Marcus Ong"),
]

# throwaway. these accounts exist only for the demo - delete them after marking
FILLER_PASSWORD = "REPLACE_WITH_DEMO_PASSWORD"

CAMPUS_LAT, CAMPUS_LNG = 1.34510, 103.93200

LOCATIONS = [
    "Library - Level 1", "Library - Level 2", "Library - Level 3",
    "Canteen - Block 1", "Canteen - Block 2",
    "Lecture Theatre - LT1A", "Lecture Theatre - LT2A", "Lecture Theatre - LT3A",
    "Study Area - Block 1", "Study Area - Block 2", "Study Area - Block 3 Level 2",
    "Sports Complex - Gym", "Sports Complex - Courts", "Bus Stop - Main Gate",
]

# same mapping the images lambda uses, kept in step with it on purpose
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

# rekognition reports colours like "Dark Blue" or "Light Grey". these read
# oddly in a title, so map them onto something a person would actually type
COLOUR_WORDS = {
    "black": "Black", "white": "White", "grey": "Grey", "gray": "Grey",
    "red": "Red", "maroon": "Dark Red", "pink": "Pink", "orange": "Orange",
    "yellow": "Yellow", "green": "Green", "olive": "Olive", "cyan": "Teal",
    "blue": "Blue", "navy": "Navy", "purple": "Purple", "violet": "Purple",
    "brown": "Brown", "beige": "Beige", "tan": "Tan", "silver": "Silver",
    "gold": "Gold",
}

# private facts, grouped by what the item actually is. a generic pool gave us
# "Keys - the screen protector is cracked", which no lecturer would believe.
# each set is used at most once, so one answer never unlocks two items
SECRETS_BY_CATEGORY = {
    "Bottle": [
        ["there is a dent near the base from being dropped",
         "the lid has a small chip on the inside rim"],
        ["a faded sticker of a cat is on the back",
         "the measurement markings have worn off one side"],
        ["the name Wei Jie is written on the base in marker",
         "the silicone seal inside the lid is green, not black"],
    ],
    "Bag": [
        ["there is a red keychain clipped to the zip",
         "the inside pocket has a folded bus receipt"],
        ["the zip pull has been replaced with a paperclip",
         "one shoulder strap is tied in a knot to shorten it"],
        ["there is an orientation lanyard stuffed in the front pocket",
         "the seam on the left side is coming apart"],
    ],
    "Wallet": [
        ["there is a bus card in the sleeve behind the notes",
         "the stitching along the top edge is coming loose"],
        ["a photo is tucked behind one of the card slots",
         "one corner of the leather is scuffed pale"],
        ["the initials AR are written inside the note section",
         "one card slot has been stretched wider than the rest"],
    ],
    "Phone": [
        ["the screen protector is cracked in the top left corner",
         "there is a photo tucked inside the back of the case"],
        ["there is a hairline scratch across the camera lens",
         "the lock screen is a photo of a beach"],
        ["the volume button sticks slightly when pressed",
         "there is a chip on the bottom right of the frame"],
    ],
    "Laptop": [
        ["there is a faded netball club sticker on the lid",
         "one of the rubber feet on the base is missing"],
        ["the letter H is written on the underside in blue pen",
         "the trackpad has a scratch across the bottom edge"],
        ["there is a dent on the corner nearest the charging port",
         "the cap is missing from one of the arrow keys"],
    ],
    "Keys": [
        ["a green cable tie is looped through the ring",
         "one key has red tape wrapped around the top"],
        ["a supermarket loyalty tag is on the same ring",
         "the ring itself is bent slightly out of shape"],
        ["there is a bottle opener on the ring",
         "one key is far more worn than the others"],
    ],
    "Umbrella": [
        ["one rib is bent from being blown inside out",
         "there is a frayed loop of thread on the strap"],
        ["the handle has a scratch along the underside",
         "the fabric sleeve is missing"],
        ["the button sticks and has to be pressed twice",
         "there is a small tear near one corner of the canopy"],
    ],
    "Clothing": [
        ["the name Wei Jie is written on the care label",
         "there is a small hole near the left cuff"],
        ["one of the buttons is a slightly different shade",
         "there is a faded stain inside the collar"],
        ["the drawstring on one side is shorter than the other",
         "there is a bus card in the front pocket"],
    ],
    "Electronics": [
        ["there is a chip in the plastic near the cable",
         "the padding on one side has started to peel"],
        ["the cable is wrapped in black tape near the plug",
         "there is a smiley face sticker on the case"],
        ["one side is noticeably quieter than the other",
         "a name is written inside the lid of the case"],
    ],
    "School Materials": [
        ["the letter H is written on the inside cover",
         "the top corner of the first few pages is folded over"],
        ["there is a canteen receipt used as a bookmark",
         "the spine has been repaired with clear tape"],
        ["there are doodles of cats in the back pages",
         "the cover has a coffee ring stain on it"],
    ],
    "Others": [
        ["there is a small chip on one edge",
         "the initials AR are scratched into the underside"],
        ["a strip of clear tape holds one corner together",
         "there is a faded sticker on the back"],
        ["one edge is worn down more than the other",
         "there is a smiley face drawn on the inside"],
    ],
}

# rekognition happily returns these on ordinary objects and they look absurd
# on a lost property card. a set of keys tagged "Gun, Weapon" is not a good look
LABEL_BLOCKLIST = {
    "gun", "weapon", "weaponry", "firearm", "handgun",
    "medication", "pill", "medicine", "drug", "capsule",
    "first aid", "blackboard", "wood", "people", "person", "human",
    "desk", "furniture", "table", "pc", "text", "page", "smoke pipe",
    "kitchen utensil", "tongs", "mason jar", "canopy",
}

# rekognition's most confident label is usually the most generic one.
# these are the words a person would actually put in a listing, most
# specific first, checked against whatever labels came back
CATEGORY_NOUNS = {
    "Bottle": ["Water Bottle", "Flask", "Bottle"],
    "Bag": ["Backpack", "Tote Bag", "Handbag", "Bag"],
    "Wallet": ["Wallet"],
    "Phone": ["Phone"],
    "Laptop": ["Laptop"],
    "Keys": ["Keys"],
    "Umbrella": ["Umbrella"],
    "Clothing": ["Jacket", "Coat", "Hoodie", "Sweater", "Shirt", "Jumper"],
    "Electronics": ["Headphones", "Earbuds", "Charger", "Watch", "Adapter"],
    "School Materials": ["Notebook", "Calculator", "Book", "Pen"],
    "Others": ["Glasses", "Card"],
}

# a colour is only worth putting in a title when it actually tells you
# something. product shots on white backgrounds come back grey every time
NEUTRAL_COLOURS = {"Grey", "White", "Silver", "Beige"}
MIN_COLOUR_SHARE = 12.0        # percent of foreground pixels

MESSAGE_OPENERS = [
    "Hi, I think this might be mine — was it near the printers?",
    "Hello! I lost something just like this yesterday, can I check it?",
    "Hey, is this still available for collection?",
    "Hi, I believe this is mine. What time are you usually on campus?",
]
MESSAGE_REPLIES = [
    "Hi! Yes it's still with me. Can you describe what's inside it?",
    "Sure — I handed it in at the counter. Happy to meet after class.",
    "Hello! Let me know a detail only the owner would know and it's yours.",
]

# ------------------------------------------------------------------ clients

dynamodb = boto3.resource("dynamodb", region_name=REGION)
reports_table = dynamodb.Table(REPORTS_TABLE)
messages_table = dynamodb.Table(MESSAGES_TABLE)
s3 = boto3.client("s3", region_name=REGION)
rekognition = boto3.client("rekognition", region_name=REGION)
cognito = boto3.client("cognito-idp", region_name=REGION)

log_lines = []


def log(msg):
    print(msg)
    log_lines.append(msg)


# ------------------------------------------------------------------ cognito

def find_user_pool():
    """locate the pool that owns our app client, so no id needs hardcoding"""
    paginator = cognito.get_paginator("list_user_pools")
    for page in paginator.paginate(MaxResults=60):
        for pool in page["UserPools"]:
            try:
                clients = cognito.list_user_pool_clients(
                    UserPoolId=pool["Id"], MaxResults=60
                )["UserPoolClients"]
            except ClientError:
                continue
            if any(c["ClientId"] == COGNITO_CLIENT_ID for c in clients):
                log(f"Using user pool {pool['Name']} ({pool['Id']})")
                return pool["Id"]
    raise RuntimeError("Could not find the user pool for that client id")


def ensure_filler_users(pool_id):
    """create the demo accounts if they aren't there, confirmed and ready"""
    made = []
    for email, name in FILLER_USERS:
        try:
            cognito.admin_create_user(
                UserPoolId=pool_id,
                Username=email,
                MessageAction="SUPPRESS",          # no invitation email
                UserAttributes=[
                    {"Name": "email", "Value": email},
                    {"Name": "email_verified", "Value": "true"},
                    {"Name": "name", "Value": name},
                ],
            )
            cognito.admin_set_user_password(
                UserPoolId=pool_id, Username=email,
                Password=FILLER_PASSWORD, Permanent=True,
            )
            made.append(email)
            log(f"  created {email}")
        except cognito.exceptions.UsernameExistsException:
            log(f"  {email} already exists, leaving it alone")
    return made


def load_users(pool_id):
    """every user in the pool as {email: {id, name, email}}"""
    users = {}
    paginator = cognito.get_paginator("list_users")
    for page in paginator.paginate(UserPoolId=pool_id):
        for u in page["Users"]:
            attrs = {a["Name"]: a["Value"] for a in u["Attributes"]}
            email = attrs.get("email")
            if not email:
                continue
            users[email.lower()] = {
                "id": attrs.get("sub"),
                "name": attrs.get("name") or email.split("@")[0],
                "email": email,
            }
    return users


# ------------------------------------------------------------------ photos

def load_photos():
    """
    whatever you dropped into s3 under uploads/. each one gets run through
    rekognition so the labels on the seeded reports are genuinely produced by
    the same service the live app uses
    """
    keys = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=UPLOAD_BUCKET, Prefix=SEED_PHOTO_PREFIX):
        for obj in page.get("Contents", []):
            if obj["Key"].lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                keys.append(obj["Key"])

    photos = []
    for key in keys:
        try:
            # IMAGE_PROPERTIES comes back in the same call and gives us the
            # real dominant colour, so a red bottle can't end up titled
            # "Navy Bottle" the way a random colour would
            result = rekognition.detect_labels(
                Image={"S3Object": {"Bucket": UPLOAD_BUCKET, "Name": key}},
                MaxLabels=8, MinConfidence=70,
                Features=["GENERAL_LABELS", "IMAGE_PROPERTIES"],
            )
        except ClientError as e:
            log(f"  skipping {key}: {e.response['Error']['Code']}")
            continue

        raw = [l["Name"] for l in result.get("Labels", [])]
        labels = [n for n in raw if n.lower() not in LABEL_BLOCKLIST]
        if not labels:
            continue

        # walk the labels by confidence and take the first one we have a
        # category for, so the title and the category can't contradict
        category = None
        for l in result.get("Labels", []):
            if l["Name"] in CATEGORY_MAP:
                category = CATEGORY_MAP[l["Name"]]
                break

        # nothing recognisable enough to make a believable listing out of
        if not category:
            log(f"  skipping {key}: no category matched ({', '.join(raw[:3])})")
            continue

        photos.append({"key": key, "labels": labels[:5], "category": category,
                       "noun": display_noun(category, labels),
                       "colour": dominant_colour(result)})
        p = photos[-1]
        log(f"  {key} -> {(p['colour'] + ' ' + p['noun']).strip()} / {category} "
            f"({', '.join(p['labels'][:3])})")
    return photos


def display_noun(category, labels):
    """
    rekognition's top label is usually the vaguest one - "Clothing" rather
    than "Jacket", "Computer" rather than "Laptop". prefer whatever the
    listing would actually be called
    """
    lower = [l.lower() for l in labels]
    for want in CATEGORY_NOUNS.get(category, []):
        if want.lower() in lower:
            return want
    # nothing specific came back, fall back to the category itself
    return CATEGORY_NOUNS.get(category, [category])[-1] if category != "Others" else "Item"


def dominant_colour(result):
    """
    the strongest colour in the foreground, falling back to the whole image.
    returns "" when rekognition isn't sure, and the title just drops the word
    """
    props = result.get("ImageProperties", {})
    for source in ("Foreground", None):
        colours = (props.get(source, {}) if source else props).get("DominantColors", [])
        if not colours:
            continue
        ranked = sorted(colours, key=lambda c: c.get("PixelPercent", 0), reverse=True)
        named = []
        for c in ranked:
            name = (c.get("SimplifiedColor") or c.get("CSSColor") or "").lower()
            if name in COLOUR_WORDS and c.get("PixelPercent", 0) >= MIN_COLOUR_SHARE:
                named.append(COLOUR_WORDS[name])

        # a real colour beats grey, because studio shots come back grey no
        # matter what the item is
        for n in named:
            if n not in NEUTRAL_COLOURS:
                return n
        if named and named[0] == "Black":
            return "Black"
        return ""            # nothing useful, the title just drops the word
    return ""


# ------------------------------------------------------------------ seeding

def make_report(user, photo, report_type, days_ago, secrets=None):
    when = datetime.now(timezone.utc) - timedelta(days=days_ago,
                                                  hours=random.randint(0, 20))
    colour = photo.get("colour", "")
    title = f"{colour} {photo['noun']}".strip()
    location = random.choice(LOCATIONS)

    thing = f"{colour.lower()} {photo['noun'].lower()}".strip()
    if report_type == "lost":
        description = (f"Lost my {thing} around "
                       f"{location.split(' - ')[0].lower()}. "
                       f"Please get in touch if you have seen it.")
    else:
        description = (f"Found this {thing} at {location}. "
                       f"Handed in and waiting to be claimed.")

    item = {
        "reportId": uuid.uuid4().hex,
        "type": report_type,
        "title": title,
        "description": description,
        "category": photo["category"],
        "location": location,
        "date": when.date().isoformat(),
        "status": "Open",
        "userId": user["id"],
        "userName": user["name"],
        "userEmail": user["email"],
        "imageKey": photo["key"],
        "rekognitionLabels": photo["labels"],
        "detectedText": [],
        "createdAt": when.isoformat(),
        # jitter around campus so the pins aren't stacked on one spot
        "lat": decimal.Decimal(str(round(CAMPUS_LAT + random.uniform(-0.0035, 0.0035), 6))),
        "lng": decimal.Decimal(str(round(CAMPUS_LNG + random.uniform(-0.0035, 0.0035), 6))),
        "seeded": True,
    }
    if secrets:
        item["secretDetails"] = secrets
    return item


def seed_reports(users, photos):
    """
    reports are handed out one photo at a time from a shuffled pool and the
    photo is never put back, so no two reports share a picture.

    accounts are filled round robin rather than three at a time, so if the
    photos run out everybody still ends up with something.

    found items owned by the filler accounts carry private details, so the
    handout accounts have something to actually claim
    """
    handout = [e.lower() for e in HANDOUT_ACCOUNTS]
    people = [(e, u) for e, u in users.items() if u["id"]]

    pool = photos[:]
    random.shuffle(pool)

    # one shuffled pile per category, dealt without replacement, so the facts
    # always suit the item and no set is ever used twice
    secrets_by_cat = {}
    for cat, sets in SECRETS_BY_CATEGORY.items():
        secrets_by_cat[cat] = sets[:]
        random.shuffle(secrets_by_cat[cat])

    wanted = len(people) * REPORTS_PER_USER
    if len(pool) < wanted:
        log(f"  only {len(pool)} photos for {wanted} reports - "
            f"making {len(pool)} reports so none of them repeat an image")

    created, answer_key = [], []

    for round_n in range(REPORTS_PER_USER):
        for email, user in people:
            if not pool:
                break
            photo = pool.pop()

            # first pass lost, the rest found, so there is plenty to claim
            report_type = "lost" if round_n == 0 else "found"

            # only some found items carry private details, and each set of
            # facts is used once. handout accounts don't get them, so the
            # claimable items all belong to somebody your lecturer can claim from
            # only some found items carry private details, and the facts come
            # from the pile for that category so they describe the right object
            secrets = None
            if report_type == "found" and email not in handout:
                pile = secrets_by_cat.get(photo["category"], [])
                if pile and random.random() < SECRET_CHANCE:
                    secrets = pile.pop()

            item = make_report(user, photo, report_type,
                               days_ago=random.randint(0, 21), secrets=secrets)
            reports_table.put_item(Item=item)
            created.append(item)

            if secrets:
                answer_key.append({
                    "title": item["title"],
                    "category": photo["category"],
                    "location": item["location"],
                    "owner": user["name"],
                    "secrets": secrets,
                })

    log(f"Wrote {len(created)} reports from {len(created)} distinct photos")
    return created, answer_key


def conversation_id(a, b, report_id):
    first, second = sorted([a, b])
    return f"{first}#{second}#{report_id}"


def seed_messages(users, reports):
    """
    a few threads, always including the handout accounts so Messages isn't
    empty when your lecturer signs in
    """
    handout = [e.lower() for e in HANDOUT_ACCOUNTS if e.lower() in users]
    if not handout:
        log("No handout accounts found in the pool - skipping messages")
        return 0

    made = 0
    for email in handout:
        me = users[email]
        # pick items belonging to someone else
        others = [r for r in reports if r["userId"] != me["id"]]
        random.shuffle(others)

        for report in others[:2]:
            owner = {"id": report["userId"], "name": report["userName"]}
            cid = conversation_id(me["id"], owner["id"], report["reportId"])
            base = datetime.now(timezone.utc) - timedelta(hours=random.randint(2, 40))

            thread = [
                (me, owner, random.choice(MESSAGE_OPENERS), base),
                (owner, me, random.choice(MESSAGE_REPLIES),
                 base + timedelta(minutes=random.randint(5, 90))),
            ]

            for sender, recipient, text, when in thread:
                messages_table.put_item(Item={
                    "conversationId": cid,
                    "sentAt": when.isoformat(),
                    "fromUserId": sender["id"],
                    "fromName": sender["name"],
                    "toUserId": recipient["id"],
                    "toName": recipient["name"],
                    "participants": [sender["id"], recipient["id"]],
                    "reportId": report["reportId"],
                    "reportTitle": report["title"],
                    "text": text,
                    "seeded": True,
                })
            made += 1

    log(f"Wrote {made} conversations")
    return made


# ------------------------------------------------------------------ purge

def save_manifest():
    """
    record exactly what we wrote, so the rows can be deleted later even once
    the seeded flag is gone
    """
    reports = [i["reportId"] for i in
               reports_table.scan(FilterExpression=Attr("seeded").eq(True)).get("Items", [])]
    messages = [{"conversationId": i["conversationId"], "sentAt": i["sentAt"]}
                for i in
                messages_table.scan(FilterExpression=Attr("seeded").eq(True)).get("Items", [])]

    body = json.dumps({"reports": reports, "messages": messages,
                       "savedAt": datetime.now(timezone.utc).isoformat()}, indent=2)
    s3.put_object(Bucket=UPLOAD_BUCKET, Key=MANIFEST_KEY,
                  Body=body.encode("utf-8"), ContentType="application/json")
    log(f"Manifest saved to s3://{UPLOAD_BUCKET}/{MANIFEST_KEY} "
        f"({len(reports)} reports, {len(messages)} messages)")
    return reports, messages


def load_manifest():
    try:
        obj = s3.get_object(Bucket=UPLOAD_BUCKET, Key=MANIFEST_KEY)
        data = json.loads(obj["Body"].read())
        return data.get("reports", []), data.get("messages", [])
    except ClientError:
        return None, None


def unflag():
    """
    takes the seeded=True marker off every row, so nothing in the database
    says how the data got there. the manifest is written first, so purge can
    still clean up afterwards
    """
    reports, messages = save_manifest()

    for report_id in reports:
        reports_table.update_item(
            Key={"reportId": report_id},
            UpdateExpression="REMOVE seeded",
        )
    for key in messages:
        messages_table.update_item(
            Key={"conversationId": key["conversationId"], "sentAt": key["sentAt"]},
            UpdateExpression="REMOVE seeded",
        )

    log(f"Removed the seeded marker from {len(reports)} reports "
        f"and {len(messages)} messages")
    log("Purge still works - it falls back to the manifest")
    log("")
    log("Left to tidy up by hand:")
    log("  - delete the findr-seed lambda")
    log("  - delete the findr-seed-temp inline policy from the role")
    log("  - delete the /aws/lambda/findr-seed log group in cloudwatch")
    log(f"  - delete s3://{UPLOAD_BUCKET}/{MANIFEST_KEY} once you no longer")
    log("    need to purge (after that, removal is manual)")
    return {"reports": len(reports), "messages": len(messages)}


def purge():
    """
    deletes what this script created. uses the manifest when there is one, so
    it still works after unflag, and falls back to the seeded marker otherwise
    """
    reports, messages = load_manifest()

    if reports is None:
        log("No manifest, matching on the seeded marker instead")
        reports = [i["reportId"] for i in
                   reports_table.scan(FilterExpression=Attr("seeded").eq(True)).get("Items", [])]
        messages = [{"conversationId": i["conversationId"], "sentAt": i["sentAt"]}
                    for i in
                    messages_table.scan(FilterExpression=Attr("seeded").eq(True)).get("Items", [])]

    for report_id in reports:
        reports_table.delete_item(Key={"reportId": report_id})
    for key in messages:
        messages_table.delete_item(Key={"conversationId": key["conversationId"],
                                        "sentAt": key["sentAt"]})

    try:
        s3.delete_object(Bucket=UPLOAD_BUCKET, Key=MANIFEST_KEY)
    except ClientError:
        pass

    log(f"Purged {len(reports)} reports and {len(messages)} messages")
    log("Filler Cognito accounts are left alone - delete those in the console")
    return {"reports": len(reports), "messages": len(messages)}


# ------------------------------------------------------------------ handout

def print_handout(answer_key):
    log("")
    log("=" * 68)
    log("HANDOUT - give this to your lecturer")
    log("=" * 68)
    log("")
    log("ACCOUNTS")
    log(f"  admin    {HANDOUT_ACCOUNTS[0]}")
    for e in HANDOUT_ACCOUNTS[1:]:
        log(f"  student  {e}")
    log("  (passwords supplied separately)")
    log("")
    log(f"  Demo accounts owning the claimable items use: {FILLER_PASSWORD}")
    log("")
    log("ITEMS THAT CAN BE CLAIMED, AND THE ANSWERS")
    log("  Sign in as any account above, open the item, choose")
    log("  'This is mine - verify & claim', then answer with the facts below.")
    log("  Bedrock rewords these into questions, so answer in your own words.")
    log("")
    if not answer_key:
        log("  (none - no found items were given private details this run)")
    for a in answer_key:
        log(f"  {a['title']}  [{a.get('category', '')}]  "
            f"({a['location']}, held by {a['owner']})")
        for s in a["secrets"]:
            log(f"      - {s}")
        log("")
    log("=" * 68)


# ------------------------------------------------------------------ entry

def run():
    # lambda reuses the container, so without this the log from the previous
    # invocation is still sitting in the list and gets returned again
    log_lines.clear()

    random.seed(20260814)          # same data every run, easier to re-seed

    if MODE == "purge":
        return purge()
    if MODE == "unflag":
        return unflag()

    pool_id = find_user_pool()

    log("Creating filler accounts...")
    ensure_filler_users(pool_id)

    users = load_users(pool_id)
    log(f"Found {len(users)} accounts in the pool")

    missing = [e for e in HANDOUT_ACCOUNTS if e.lower() not in users]
    if missing:
        log("WARNING - these handout accounts don't exist yet, "
            "sign them up first: " + ", ".join(missing))

    log(f"Reading photos from s3://{UPLOAD_BUCKET}/{SEED_PHOTO_PREFIX} "
        "and running rekognition...")
    photos = load_photos()
    if not photos:
        raise RuntimeError(
            f"No usable images under s3://{UPLOAD_BUCKET}/{SEED_PHOTO_PREFIX} - "
            "create that folder and upload your item photos into it"
        )
    log(f"{len(photos)} photos ready")

    reports, answer_key = seed_reports(users, photos)
    seed_messages(users, reports)
    print_handout(answer_key)

    return {"reports": len(reports), "photos": len(photos)}


def lambda_handler(event, context):
    result = run()
    return {"statusCode": 200,
            "body": json.dumps({"result": result, "log": log_lines}, default=str)}


if __name__ == "__main__":
    run()
