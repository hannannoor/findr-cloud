# Findr — Reviewer's Guide

**Mohammed Hannan Noor · XXXXXXXX · PC02 · Tutor: Lee Jin**
CTAI / CAI2C09 Cloud Technologies for AI · AY2026/27 April semester

**Site:** https://d3d5h347656j6.cloudfront.net
**Region:** ap-southeast-2 (Sydney)

---

## What Findr is

A campus lost-and-found platform. Students post items they've lost or found,
and the site uses AWS AI services to tag photos automatically, suggest possible
matches between lost and found reports, translate listings into Singapore's
four official languages, and verify that whoever claims a found item is
genuinely its owner.

---

## 1. Logins

| Role | Email | Password |
|---|---|---|
| **Admin** | `noorhannan125@gmail.com` | `REPLACE_WITH_DEMO_PASSWORD` |
| Student — Hannan Noor | `XXXXXXXX@student.tp.edu.sg` | `REPLACE_WITH_DEMO_PASSWORD` |
| Student — Jia Ling Toh | `noorhannan2009@gmail.com` | `REPLACE_WITH_DEMO_PASSWORD` |
| Student — Arjun Menon | `dkcheese111@gmail.com` | `REPLACE_WITH_DEMO_PASSWORD` |

The admin account is the only one with the **Admin** dashboard. The other three
are ordinary student accounts.

You're welcome to register your own account instead — sign-up sends a real
verification code by email through Amazon Cognito.

---

## 2. A five-minute tour

If you're short on time, this order covers the most ground:

1. **Browse** — the item grid. Try the category and status filters.
2. **Read this in → 中文** on Browse. Amazon Translate converts the listings
   live. Try Tamil too.
3. Open any item, then **Read this in** again — on an item page the location,
   category and AI labels translate as well, not just the title.
4. **Map** — every report with coordinates, plotted with Amazon Location
   Service. Click a pin.
5. **Report Found** — upload a photo and watch the AI tag it. Section 3.
6. Claim a found item — Section 4.
7. Sign in as the admin and open **Admin** for the moderation dashboard.

---

## 3. Photo analysis (Rekognition + Bedrock)

On **Report Lost** or **Report Found**, upload a photo of any everyday object.

Two models look at it, and the page keeps them clearly separated:

- **Findr Custom Model** — an Amazon Rekognition Custom Labels model I trained
  on my own dataset of campus lost property (F1 score 0.955). It classifies the
  item straight into one of Findr's categories.
- **AWS Rekognition (pretrained)** — Amazon's general-purpose model, shown
  underneath as supporting detail.

Amazon Bedrock (Nova Lite) then drafts a description. It receives the actual
image, not just the labels, plus my model's classification, which it's told to
treat as authoritative.

---

## 4. Ownership verification

The problem: anyone can read a listing and claim "that's mine". So when
somebody reports a **found** item, they can privately record up to three
details only the true owner would know. Those details never leave the database
and are never sent to the browser.

When someone claims the item, **Amazon Bedrock turns those private facts into
questions**, then marks the answers against the real facts and scores the
match. Pass 60% and the item is marked Claimed; either way the finder gets an
email through Amazon SNS telling them what happened.

### To try it

1. Sign in as **Jia Ling Toh** (`noorhannan2009@gmail.com`)
2. Open one of the items in the table below
3. Click **This is mine — verify & claim**
4. Answer using the facts listed — **in your own words**

The questions are generated fresh each time, so they won't be worded the way
the facts below are. Answering in your own words is the point: the system is
checking that you *know* the fact, not that you can repeat a sentence.

### Answer key

| Item | Where | Held by | The private facts |
|---|---|---|---|
| Black Wallet | Bus Stop — Main Gate | Priya Kumar | A photo is tucked behind one of the card slots · One corner of the leather is scuffed pale |
| Brown Wallet | Canteen — Block 2 | Daniel Tan | There is a bus card in the sleeve behind the notes · The stitching along the top edge is coming loose |
| Bottle | Library — Level 2 | Marcus Ong | The name Wei Jie is written on the base in marker · The silicone seal inside the lid is green, not black |
| Brown Phone | Study Area — Block 1 | Lim Wei Jie | The screen protector is cracked in the top left corner · There is a photo tucked inside the back of the case |
| Sweater | Study Area — Block 1 | Sarah Chen | The name Wei Jie is written on the care label · There is a small hole near the left cuff |
| Sweater | Library — Level 2 | Priya Kumar | The drawstring on one side is shorter than the other · There is a bus card in the front pocket |
| Black Laptop | Study Area — Block 3 Level 2 | Daniel Tan | The letter H is written on the underside in blue pen · The trackpad has a scratch across the bottom edge |
| Black Keys | Library — Level 1 | Marcus Ong | A supermarket loyalty tag is on the same ring · The ring itself is bent slightly out of shape |
| Keys | Library — Level 2 | Lim Wei Jie | A green cable tie is looped through the ring · One key has red tape wrapped around the top |

Not every found item has private details — that's intentional. Items without
them show no claim button, because there'd be nothing to check an answer
against.

---

## 5. AWS services used

| Service | What it does here |
|---|---|
| S3 | Static website hosting, and private storage for item photos |
| CloudFront | HTTPS delivery of the site, with AWS WAF in front |
| API Gateway (REST) | The API layer, with a Cognito authorizer on protected routes |
| Lambda | Six functions — reports, images, messages, matching, verification, translation |
| DynamoDB | Reports and messages |
| Cognito | Sign-up, sign-in, JWTs, and the admin group |
| Rekognition | Label detection, moderation, text detection, **and my own Custom Labels model** |
| Bedrock (Nova Lite / Nova Pro) | Item descriptions, semantic matching, verification questions and marking |
| Translate + Comprehend | Listings in English, Chinese, Malay and Tamil |
| SNS | Email notifications to finders |
| Location Service | The campus map |
| CloudWatch | Logs and metrics |
| IAM | Scoped roles for each function |

---

Thank you for taking the time to look through it. If anything doesn't work,
please let me know.

**Mohammed Hannan Noor · XXXXXXXX**
