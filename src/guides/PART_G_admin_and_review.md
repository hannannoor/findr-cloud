# Findr — Part G: Admin role, cleanup, and rubric check

---

## Step 41 — Make the admin role real (5 minutes)

Right now `admin.html` exists but nobody is actually an admin. The Lambdas already
check for it:

```python
"isAdmin": "admin" in claims.get("cognito:groups", "")
```

That claim only appears if a Cognito **group** called `admin` exists and you're in it.

1. **Cognito** → **User pools** → your pool
2. Left menu → **Groups** → **Create group**
3. Group name: `admin`
4. Description: `Findr administrators — can manage any report`
5. Leave the IAM role empty (we're only using this for the JWT claim)
6. **Create group**

Now add yourself:

7. **Users** → click your account → **Group memberships** → **Add user to group**
8. Select `admin` → **Add**

📸 `81-cognito-admin-group.png`

> **You must log out and back in.** The group only appears in a token issued *after*
> you joined it — an existing session's JWT won't have it. This confuses everyone once.

### How to check it worked

Log back in, open the browser console, and run:

```javascript
JSON.parse(localStorage.getItem("findr_session")).role
```

Should print `"admin"`. Then `/admin.html` loads the dashboard; without it you get
an "Admins only" panel instead.

📸 `82-admin-dashboard.png` — the dashboard with the Verification column
📸 `83-admin-blocked.png` — the same page from a normal account

> **Why this is worth marks:** it's role-based access control done properly. The role
> lives in a signed JWT issued by Cognito, API Gateway validates the signature, and
> the Lambda reads the group claim to decide whether someone may edit another user's
> report. The frontend check is only cosmetic — a user could bypass it with devtools
> and still be refused by the backend. **Say that explicitly**; knowing which checks
> are real and which are convenience is exactly what the security row is looking for.

---

## Step 42 — Tidy up the IAM policy

We removed the face check, so the policy has permissions nothing uses any more.
Repaste `findr-lambda-policy.json` — the updated version drops:

- `rekognition:CompareFaces` — no face comparison any more
- The whole `verify/*` S3 statement — no verification photos are ever uploaded

What's left, and why each is still needed:

| Statement | Used by |
|---|---|
| `ReadWriteFindrTablesOnly` | reports, messages, verify |
| `ReadWriteUploadedImagesOnly` | images (upload + Rekognition), reports (delete) |
| `GenerativeDescriptionsAndMatching` | images, match, verify |
| `TranslateListings` | translate *(includes `comprehend:DetectDominantLanguage` for auto-detect)* |
| `AnalyseImagesWithRekognition` | images |
| `PublishNotificationsToFindrTopicOnly` | reports, messages, verify |

📸 `84-iam-policy-final.png`

> Removing permissions you stopped using is itself a least-privilege point. Mention
> it in the report — "the policy was tightened as features were removed" reads much
> better than a policy that accumulated everything anyone ever tried.

### Also delete the unused API routes

- `/verify/face` 🗑️
- `/verify/upload-url` 🗑️

Then **Deploy API → prod**.

---

## Your API design — and why it isn't "all POST"

You asked whether it's a problem that a lot of routes are POST-only. Short answer:
no, and there's a clear rule behind it. Worth putting in the report, because a marker
may well ask.

### The full route table

| Route | Method | Why that method |
|---|---|---|
| `/reports` | **GET** | reads the collection, no side effects |
| `/reports` | **POST** | creates a new report |
| `/reports/{id}` | **GET** | reads one report |
| `/reports/{id}` | **PUT** | replaces fields on an existing report |
| `/reports/{id}` | **DELETE** | removes it |
| `/messages` | **GET** | reads conversations |
| `/messages` | **POST** | sends a message |
| `/images/upload-url` | POST | *action* — mints a presigned URL |
| `/images/analyse` | POST | *action* — runs Rekognition, costs money |
| `/match` | POST | *action* — runs Bedrock over a body of data |
| `/translate` | POST | *action* — runs Translate |
| `/verify/start` | POST | *action* — checks claim eligibility |
| `/verify/questions` | POST | *action* — generates questions with Bedrock |
| `/verify/answers` | POST | *action* — marks answers, writes a claim |

**The rule:** `/reports` is a **resource**, so it gets the full REST verb set —
GET, POST, PUT, DELETE. That's your CRUD, and it's what the rubric's "Database
Functions" row is actually measuring:

| CRUD | HTTP | Lambda |
|---|---|---|
| **C**reate | `POST /reports` | `create()` → `put_item` |
| **R**ead | `GET /reports`, `GET /reports/{id}` | `read_many()` / `read_one()` → `query` / `scan` / `get_item` |
| **U**pdate | `PUT /reports/{id}` | `update()` → `update_item` |
| **D**elete | `DELETE /reports/{id}` | `delete()` → `delete_item` |

**Everything else is an operation, not a resource.** "Analyse this image", "translate
this text", "mark these answers" aren't nouns you can GET — they're verbs that do
work, cost money, and often write data. POST is the correct method for those, and
using GET would be actively wrong:

- GET is defined as **safe** — it must not change state. `/verify/answers` writes a
  claim record and emails the finder. That must not be a GET.
- GET is **idempotent and cacheable**. Browsers, CDNs and proxies will happily replay
  or cache a GET. You do not want a cached Bedrock result, or a claim submitted twice
  because someone hit refresh.
- GET has **no request body**. `/match` sends labels, a title, a description and a
  location. That doesn't fit in a query string.

There's also a real security reason: **query strings get logged everywhere** — browser
history, CloudWatch access logs, proxies. Answers to ownership questions have no
business in a URL. A POST body stays out of all of that.

> **The one-line version for your report:**
> *"Resources use the full REST verb set — `/reports` supports GET, POST, PUT and
> DELETE, giving complete CRUD. Operations that perform work rather than manipulate a
> resource use POST, because GET is required to be safe, idempotent and cacheable, and
> none of those hold for an operation that invokes a paid AI service or writes a
> record."*

**One exception worth knowing about:** `GET /messages?conversationId=...` reads a
thread via query string rather than `/messages/{id}`. That's not a design choice —
conversation IDs contain `#`, and API Gateway rejects `%23` inside a path parameter
with a 403. Worth mentioning in the report as a concrete platform limitation you hit
and worked around.

---

## Rubric check — where you stand

### Application, Deliverable 2 (30%, 75 marks)

| Criterion | A-band wording | Status |
|---|---|---|
| **Cloud Security** | *"correct bucket policies, HTTPS enforced, principle of least privilege"* | ✅ **Strong.** Both buckets private, CloudFront OAC, HTTPS redirect, WAF, scoped IAM per-resource, Cognito auth with a Lambda trigger, RBAC via groups, private data stripped server-side, permissions removed when features were dropped |
| **Database Functions** | *"full and complete CRUD with no errors, properly integrated and secured"* | ✅ All four verbs, ownership enforced server-side, admin override |
| **Deployment** | *"fully deployed on S3, no runtime errors, responsive across devices"* | ✅ S3 + CloudFront. ⚠️ **Test on a phone before submitting** |
| **Rekognition** | *"correctly identifies relevant images… no hardcoded results"* | ✅ Labels, moderation, text detection, **plus a custom model you trained (F1 0.93)** — well beyond the band |
| **Additional Services** | *"multiple… not taught in class… significantly enhancing functionality"* | ✅ Cognito, SNS, Bedrock, Translate, Location Service, CloudFront, WAF |

### Report (20%)

| Criterion | Status |
|---|---|
| Rekognition development documentation | ⬜ **Not started** |
| Deployment process | ⬜ Not started — your screenshots cover it |
| Setup guide for all services | ⬜ Not started — Parts A–G are essentially the raw material |
| Technical accuracy | ⬜ |
| Visual aids | 🟡 Screenshots exist, need an architecture diagram |

### Presentation (10%)

⬜ Not started. Slides + a 5-minute YouTube video, both due Monday 0900.

---

## What's actually missing

1. **Report** — 20%, not started
2. **Slides + video** — 10%, not started
3. **Architecture diagram** — needed for the report, and it's the single best figure you'll have
4. **Mobile check** — the deployment row explicitly says "responsive across devices". Open the site on your phone and click through. Ten minutes
5. **Page screenshots** — you deferred these; they're required
6. **The zip** — `XXXXXXXX_MohammedHannanNoor.zip`, web files plus each Lambda as a separate `.txt`

## One risk worth naming

You have **more than enough** for the Application marks. The report and presentation
are worth **30% combined and neither exists yet.**

Stop adding features. Everything from here should go into the report, the slides and
the video.
