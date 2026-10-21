# Findr — AWS Setup Guide, Part A: Foundations

**Student:** Mohammed Hannan Noor (XXXXXXXX) · **Class:** PC02 · **Region: `ap-southeast-2` (Sydney)**

This part creates everything the Lambda functions will need to exist *before* you
create the Lambdas themselves. Work top to bottom. It should take about 60–75 minutes.

> **CHECK THE REGION ON EVERY SINGLE PAGE.**
> Top-right corner of the console must read **Sydney / ap-southeast-2** the whole way
> through. Resources created in the wrong region are invisible to each other and this is
> the single most common way people lose an afternoon.

---

## Naming used throughout this guide

Copy these exactly — the Lambda code and the frontend both refer to them by name.

| Thing | Name |
|---|---|
| Website bucket | `findr-site-XXXXXXXX` |
| Uploads bucket | `findr-uploads-XXXXXXXX` |
| Reports table | `findr-reports` |
| Messages table | `findr-messages` |
| Users table | `findr-users` |
| SNS topic | `findr-notifications` |
| Lambda role | `findr-lambda-role` |

If a bucket name is taken (bucket names are globally unique across all of AWS), append
a number — `findr-site-XXXXXXXX-2` — and **write down what you actually used**, because
you'll need it in three later steps.

---

## 📸 Screenshot policy — read this once, then follow it forever

Your report is worth 20% and its rubric rewards *"exhaustive, step-by-step guide… detailing
configuration settings"* plus *"effective visual aids."* Every single step below marked
**📸** means: take a screenshot before you click away. You will not want to recreate these
on Sunday night.

Save them into one folder named `report-screenshots/`, named like `01-budget-alert.png`,
`02-site-bucket-created.png`, so they're already in order when we write the report.

---

## Step 0 — Budget alert (do this first, it takes 4 minutes)

You said you can't get close to your spending cap. So the very first thing we do is make
it impossible to be surprised.

1. Go to **Billing and Cost Management** → left sidebar → **Budgets**.
2. **Create budget** → choose **Customize (advanced)** → Budget type: **Cost budget**.
3. Period: **Monthly**. Budget renewal: **Recurring**.
4. Budgeting method: **Fixed**. Enter an amount that is roughly **30% of your cap**.
   (Low on purpose — this is a tripwire, not a limit.)
5. Name it `findr-tripwire`.
6. **Add an alert threshold:** Threshold = **50%** of budgeted amount, Trigger = **Actual**,
   and enter **your email**.
7. Add a second threshold at **80%**, also **Actual**, same email.
8. Create budget. **Confirm the email subscription** if AWS sends a confirmation.

📸 **Screenshot the finished budget page.**

> **Why this matters more than it looks:** AWS bills in arrears and the console's cost
> figures lag by several hours. Without an alert you find out you overspent days later.
> With two thresholds you get warned twice while the numbers are still tiny.

---

## Step 1 — The website bucket (`findr-site-XXXXXXXX`)

This holds your HTML/CSS/JS and serves the site.

1. **S3** → **Create bucket**.
2. Bucket name: `findr-site-XXXXXXXX`
3. AWS Region: **Asia Pacific (Sydney) ap-southeast-2**
4. Object Ownership: leave **ACLs disabled (recommended)**.
5. **Block Public Access:** **UNCHECK** "Block *all* public access", then tick the
   acknowledgement box that appears.
   - *We are deliberately making this bucket public — it's a public website. The uploads
     bucket in Step 2 stays completely locked down, and that contrast is exactly the
     "principle of least privilege" point you'll make in your report.*
6. Bucket Versioning: **Disable** (keeps costs at zero).
7. Default encryption: leave **SSE-S3** enabled.
8. **Create bucket.**

📸 **Screenshot the bucket's Permissions tab showing Block Public Access is off.**

### 1a — Turn on static website hosting

1. Open the bucket → **Properties** tab → scroll to the very bottom → **Static website hosting** → **Edit**.
2. Static website hosting: **Enable**
3. Hosting type: **Host a static website**
4. Index document: `index.html`
5. Error document: `index.html`
6. **Save changes.**
7. Scroll back down and **copy the Bucket website endpoint** URL. It looks like:
   `http://findr-site-XXXXXXXX.s3-website-ap-southeast-2.amazonaws.com`

   **Paste that URL somewhere you'll find it again.** You need it in Part B (CORS) and
   in the CloudFront step.

📸 **Screenshot the static website hosting panel showing the endpoint.**

### 1b — Bucket policy (public read, HTTPS enforced)

1. **Permissions** tab → **Bucket policy** → **Edit**.
2. Paste the contents of `policies/site-bucket-policy.json` (provided alongside this guide).
3. **Replace `findr-site-XXXXXXXX`** with your real bucket name if you had to change it.
4. **Save changes.**

📸 **Screenshot the saved bucket policy.** This is a direct hit on the Cloud Security
rubric row — it shows a correct bucket policy *and* HTTPS enforcement.

> **What that policy actually does:** the first statement allows anyone to `GetObject`
> (read files) but nothing else — no listing, no writing, no deleting. The second
> statement *explicitly denies* every request that didn't arrive over HTTPS. An explicit
> Deny in IAM always wins, so plain-HTTP requests are refused outright. Be ready to say
> this out loud in your presentation — "able to accurately describe the function of the
> services used" is a marked criterion.

---

## Step 2 — The uploads bucket (`findr-uploads-XXXXXXXX`)

This holds user-uploaded item photos. **It stays 100% private.** Nobody ever reads it
directly — Lambda hands out short-lived presigned URLs instead.

1. **S3** → **Create bucket**.
2. Bucket name: `findr-uploads-XXXXXXXX`
3. Region: **ap-southeast-2**
4. **Block Public Access: LEAVE ALL FOUR BOXES TICKED.** ✅✅✅✅
5. Versioning: **Disable**. Encryption: leave **SSE-S3** on.
6. **Create bucket.**

📸 **Screenshot showing all four Block Public Access settings ON.** Put this side by side
with the site bucket screenshot in your report — the contrast *is* the argument.

### 2a — CORS on the uploads bucket

The browser uploads photos straight to S3 using a presigned URL, so S3 itself has to
accept cross-origin PUT requests.

1. Open `findr-uploads-XXXXXXXX` → **Permissions** → scroll to
   **Cross-origin resource sharing (CORS)** → **Edit**.
2. Paste the contents of `policies/uploads-cors.json`.
3. **Save changes.**

📸 **Screenshot the CORS config.**

> Right now it allows `"*"` origins so local testing works. **On Wednesday, once
> CloudFront exists, we tighten this to just your real domain** — and you should mention
> that tightening in the report, because "principle of least privilege applied" is
> literally the A-band wording.

---

## Step 3 — DynamoDB tables

Three tables. Each takes about a minute.

### 3a — `findr-reports`

1. **DynamoDB** → **Tables** → **Create table**.
2. Table name: `findr-reports`
3. Partition key: `reportId` — type **String**
4. *No sort key.*
5. Table settings: **Customize settings**
6. Table class: **DynamoDB Standard**
7. Read/write capacity settings: **On-demand** ← important, this is the pay-per-request
   mode; provisioned capacity would bill you hourly whether you use it or not.
8. **Create table.** Wait for status **Active**.

Now add an index so you can list "all lost items, newest first" without scanning:

9. Open the table → **Indexes** tab → **Create index**.
10. Partition key: `type` — **String**
11. Sort key: `createdAt` — **String**
12. Index name: `type-createdAt-index` (it may fill this in automatically)
13. Attribute projections: **All**
14. **Create index.** It takes a minute or two to go Active.

📸 **Screenshot the table overview and the index.**

> **Why a GSI:** a DynamoDB `Scan` reads every row and gets slower and more expensive as
> data grows. A `Query` against this index jumps straight to the rows you want, already
> sorted by date. Your Lambda uses `Query` on the browse page and only falls back to
> `Scan` for free-text search. Saying that sentence in your presentation demonstrates
> real understanding rather than "I clicked create table."

### 3b — `findr-messages`

1. **Create table**. Name: `findr-messages`
2. Partition key: `conversationId` — **String**
3. Sort key: `sentAt` — **String**
4. **Customize settings** → **On-demand**
5. **Create table.**

> The sort key means messages in a conversation come back already in chronological
> order — the database does the sorting, not your JavaScript.

### 3c — `findr-users`

1. **Create table**. Name: `findr-users`
2. Partition key: `userId` — **String** (this will hold the Cognito `sub`)
3. No sort key. **Customize settings** → **On-demand**
4. **Create table.**

📸 **Screenshot the Tables list showing all three Active.**

---

## Step 4 — SNS topic (`findr-notifications`)

1. **Simple Notification Service** → **Topics** → **Create topic**.
2. Type: **Standard** (FIFO doesn't support email).
3. Name: `findr-notifications`
4. Leave everything else default → **Create topic**.
5. **Copy the Topic ARN** — looks like
   `arn:aws:sns:ap-southeast-2:123456789012:findr-notifications`.
   **Save it**, you need it for the Lambda environment variables.
6. On the topic page → **Create subscription**.
7. Protocol: **Email**. Endpoint: **your email address**. → **Create subscription**.
8. **Go to your inbox and click the confirmation link.** Until you do, status stays
   "Pending confirmation" and no emails will arrive.
9. Refresh the console — status should read **Confirmed**.

📸 **Screenshot the topic ARN and the Confirmed subscription.**
📸 **Later, screenshot an actual notification email in your inbox** — that's the proof
the service really works, and it's a great slide.

---

## Step 5 — IAM role for the Lambda functions

All four main Lambdas share one role. The policy is scoped tightly to *your* specific
tables and buckets, not `"Resource": "*"`.

### 5a — Create the policy

1. **IAM** → **Policies** → **Create policy** → click the **JSON** tab.
2. Delete what's there and paste `iam/findr-lambda-policy.json`.
3. **You must edit two things** before saving:
   - Replace every `ACCOUNT_ID` with your 12-digit AWS account number
     (top-right menu of the console, under your username).
   - Replace bucket names if yours differ.
4. **Next** → Policy name: `findr-lambda-policy` → **Create policy**.

📸 **Screenshot the policy JSON.** This is your single best piece of evidence for
*"principle of least privilege applied."*

### 5b — Create the role

1. **IAM** → **Roles** → **Create role**.
2. Trusted entity type: **AWS service**. Use case: **Lambda**. → **Next**
3. Search for and tick **`findr-lambda-policy`**.
4. Also tick **`AWSLambdaBasicExecutionRole`** (this is what lets Lambda write logs to
   CloudWatch — without it you are debugging blind).
5. **Next** → Role name: `findr-lambda-role` → **Create role**.

📸 **Screenshot the role showing both attached policies.**

> **Presentation talking point:** contrast this with the lazy approach of attaching
> `AmazonS3FullAccess` + `AmazonDynamoDBFullAccess`. Your role can read and write exactly
> three tables, two buckets, one SNS topic, and call Rekognition's detect APIs — nothing
> else. If someone compromised a function, the blast radius is tiny.

---

## Step 6 — Cognito user pool

This replaces the fake login in your `api.js` where any password works.

1. **Cognito** → **User pools** → **Create user pool**.

The console wizard changed fairly recently, so match on *meaning* rather than exact
button text if your screen differs slightly:

2. **Application type:** choose **Single-page application (SPA)**.
   - This matters: SPA clients are created **without a client secret**, which is required
     because browser JavaScript cannot keep a secret safe.
3. **Name your application:** `findr-web`
4. **Sign-in identifiers:** tick **Email**.
5. **Required attributes for sign-up:** add **`name`** (your register page collects a name).
6. Create the user pool.

### 6a — Note down two values

From the pool's overview page, copy and save:
- **User Pool ID** — like `ap-southeast-2_AbCdEfGhI`
- **Client ID** (under App clients) — a long alphanumeric string

You need both in the frontend on Tuesday.

📸 **Screenshot the pool overview and the app client settings.**

### 6b — Check the password policy

**Authentication** → **Sign-up** → **Password policy**. Note the minimum length and
whether numbers/symbols are required. Your `register.js` currently validates a 6-character
minimum; Cognito's default is 8 with mixed requirements. **We'll align the frontend
validation to whatever Cognito enforces** — mismatched rules produce confusing errors
during a live demo.

📸 **Screenshot the password policy** — it's direct evidence of "proper user authentication."

> **Note on verification codes:** by default Cognito emails a 6-digit code and the account
> stays unconfirmed until it's entered. That's a liability in a 10-minute live demo. In
> Part B we add a tiny **PreSignUp Lambda trigger** that auto-confirms new users, so
> sign-up → login is one smooth step. I'll flag in the report that this is a deliberate
> demo-environment tradeoff and that production would keep verification on — examiners
> like seeing that you know the difference.

---

## ✅ Part A completion checklist

Before moving to Part B, you should have all of these **written down in one note**:

- [ ] Budget alert active, confirmation email clicked
- [ ] `findr-site-XXXXXXXX` created, website hosting on, bucket policy saved
- [ ] **Site bucket website endpoint URL:** `________________________`
- [ ] `findr-uploads-XXXXXXXX` created, fully private, CORS saved
- [ ] `findr-reports` Active + `type-createdAt-index` Active
- [ ] `findr-messages` Active
- [ ] `findr-users` Active
- [ ] **SNS Topic ARN:** `________________________`
- [ ] SNS email subscription **Confirmed**
- [ ] `findr-lambda-policy` + `findr-lambda-role` created
- [ ] **AWS Account ID:** `________________________`
- [ ] **Cognito User Pool ID:** `________________________`
- [ ] **Cognito Client ID:** `________________________`
- [ ] Screenshots saved in `report-screenshots/`

Send me that filled-in list and I'll bake the real values straight into the Lambda
environment variables and the frontend config, so there's no placeholder-hunting later.
