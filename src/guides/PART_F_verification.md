# Findr — Part F: Ownership Verification

**Region: `ap-southeast-2`** · **Account: `958202484887`**

The feature that answers your tutor's proposal feedback: *"how are you going to
verify that it is indeed your item?"*

About 45 minutes of console work.

## What it does

Someone clicks **"This is mine — verify & claim"** on a found item:

1. **Identity** — they photograph their student card, then take a selfie.
   Rekognition `CompareFaces` returns a similarity score. Below 80% and the claim stops.
2. **Ownership** — Bedrock reads the item's Rekognition labels, detected text and
   description, and writes three questions only the real owner could answer.
3. **Assessment** — Bedrock marks the answers for consistency and specificity,
   returning a confidence score. Below 60% and the claim isn't approved.
4. **Notification** — SNS emails the finder either way, with both scores and the
   reasoning. Approved claims mark the item as `Claimed`.

**Services involved in one flow:** Rekognition (face comparison), Bedrock (question
generation and marking), S3 (temporary photo storage), DynamoDB (claim record),
SNS (notification), Cognito (identity), API Gateway + Lambda.

> **The privacy design is the bit to talk about.** The card photo and selfie are
> deleted from S3 the moment `CompareFaces` returns — including when it errors.
> They're biometric data needed for exactly one API call, so they're never
> persisted. Nothing about the face is stored; only the resulting *score* goes into
> the claim record.
>
> That's a deliberate decision, and "we process it and destroy it rather than keeping
> it" is exactly the kind of reasoning the Cloud Security rubric rewards.

---

## Step 36 — Update the IAM policy

Two additions: `rekognition:CompareFaces`, and S3 access to the `verify/` prefix.

1. **IAM** → **Policies** → `findr-lambda-policy` → **Edit**
2. Paste the updated JSON (provided alongside this guide)
3. **Next** → **Save changes**

📸 `71-iam-compare-faces.png`

> Note the `verify/*` permissions are a **separate statement** from `uploads/*`.
> Same bucket, different prefixes, granted independently — that's least privilege
> at the prefix level, and worth a sentence in the report.

---

## Step 37 — Create the `findr-verify` Lambda

Same recipe as the others:

1. **Lambda** → **Create function** → **Author from scratch**
2. **Function name:** `findr-verify`
3. **Runtime:** Python 3.13
4. **Change default execution role** → **Use an existing role** → `findr-lambda-role`
5. **Create function**
6. Paste `findr-verify.py` into the code editor → **Deploy**
7. **Configuration** → **General configuration** → **Edit** → Memory **512 MB**,
   Timeout **60 sec** → Save

   *(Face comparison plus two Bedrock calls — it needs the headroom.)*

8. **Configuration** → **Environment variables** → **Edit** → add all four:

```
UPLOAD_BUCKET   = findr-uploads-XXXXXXXX
REPORTS_TABLE   = findr-reports
SNS_TOPIC_ARN   = arn:aws:sns:ap-southeast-2:958202484887:findr-notifications
BEDROCK_MODEL   = apac.amazon.nova-lite-v1:0
```

📸 `72-lambda-verify-config.png`

---

## Step 38 — Add the API routes

Four new POST methods under a `/verify` resource.

### Create the resources

**API Gateway** → `findr-api` → **Resources**

1. Select the root `/` → **Create resource** → name: `verify` → Create
2. Select `/verify` → **Create resource** → name: `upload-url` → Create
3. Select `/verify` → **Create resource** → name: `face` → Create
4. Select `/verify` → **Create resource** → name: `questions` → Create
5. Select `/verify` → **Create resource** → name: `answers` → Create

You should end up with:

```
/verify
├── /upload-url
├── /face
├── /questions
└── /answers
```

### Create the methods

On **each** of the four child resources:

- **Create method** → **POST**
- Integration type: **Lambda**
- ✅ **Lambda proxy integration**
- Lambda function: **`findr-verify`**
- Authorization: **`findr-cognito-auth`**
- Create method

*(`/verify` itself gets no method — it's just a container.)*

### CORS

On each of the four child resources: **Enable CORS** → tick Default 4XX and 5XX →
tick POST and OPTIONS → Save.

### Deploy

**Deploy API** → stage **`prod`** → Deploy.

**Nothing works until you deploy.** This catches everyone.

📸 `73-api-verify-routes.png` — the resource tree showing `/verify` and its children

---

## Step 39 — Upload the frontend

Changed files: `js/api.js`, `js/verify.js` *(new)*, `js/item-details.js`,
`item-details.html`, `css/styles.css`.

1. **S3** → `findr-site-XXXXXXXX` → **Upload** → **Add files** (all HTML) →
   **Add folder** → `css`, `js`, `images` → **Upload**
2. **CloudFront** → **Invalidations** → **Create invalidation** → `/*`
3. Hard-refresh the site

---

## Step 40 — Test it

**The camera needs HTTPS.** Use your CloudFront URL — `https://d3d5h347656j6.cloudfront.net`.
On plain HTTP the browser silently refuses camera access, and you'll get the
"camera unavailable" message.

**You need two accounts** — you can't claim your own report. Either register a
second account, or use a browser incognito window for the second user.

1. Account A: report a **found** item with a photo
2. Account B: open that item → **"This is mine — verify & claim"**
3. Photograph something with a face on it (any printed photo, or a phone showing a
   photo of yourself) as the "student card"
4. Take a selfie
5. Watch the similarity score come back
6. Answer the three Bedrock-generated questions
7. See the verdict, and check the finder's inbox for the SNS email

📸 `74-verify-intro.png` — the wizard's opening screen
📸 `75-verify-camera.png` — camera capture in progress
📸 `76-verify-face-score.png` — the identity match score ← **best screenshot of the feature**
📸 `77-verify-questions.png` — the Bedrock-generated questions
📸 `78-verify-approved.png` — the verdict screen with both scores
📸 `79-verify-sns-email.png` — the email the finder receives
📸 `80-verify-banner.png` — the item page afterwards showing the verified banner

### If something fails

| Symptom | Cause |
|---|---|
| "Camera unavailable — only works over HTTPS" | You're on the S3 URL, not CloudFront |
| "Couldn't find a face in one of the photos" | Rekognition found no face — use a clearer photo. This is a real error message, not a bug |
| 403 on `/verify/...` | You didn't Deploy the API after adding the methods |
| `AccessDeniedException` in CloudWatch | The IAM policy update didn't save |
| Questions are generic/boring | Bedrock fell back — check CloudWatch for the reason |

---

## ✅ Part F checklist

- [ ] IAM policy updated with `CompareFaces` and `verify/*`
- [ ] `findr-verify` Lambda created with all 4 env vars
- [ ] Memory 512 MB, timeout 60s
- [ ] `/verify` + 4 child resources created
- [ ] 4 POST methods, all with proxy integration and Cognito auth
- [ ] CORS enabled on all four
- [ ] **API deployed to `prod`**
- [ ] Frontend uploaded, CloudFront invalidated
- [ ] Tested end-to-end with two accounts
- [ ] Screenshots 71–80 saved

---

## What to say about it

> The proposal feedback raised that the application had no way to verify a claimant
> actually owns an item. Verification now runs in two independent stages.
>
> The first is identity: Rekognition's `CompareFaces` compares the photo on the
> claimant's student card against a live selfie, and the claim cannot proceed below
> an 80% similarity threshold. Both images are deleted from S3 immediately after the
> comparison — they are biometric data required for a single API call, so they are
> never persisted. Only the resulting score is recorded.
>
> The second stage is ownership. Identity proves who someone is, not that the item
> is theirs, so Bedrock generates three questions from the item's Rekognition labels,
> detected text and description — details a real owner would know but which aren't
> stated in the public listing. Bedrock then assesses the answers for specificity and
> consistency and returns a confidence score.
>
> Both scores are sent to the finder by SNS whether the claim passes or fails, so a
> human always retains the final decision. The system advises rather than adjudicates.

That last sentence matters. Automating a decision entirely would be the wrong design
here, and saying so shows judgement rather than just capability.
