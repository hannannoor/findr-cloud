# Findr — Part C: Rekognition Custom Labels

**Region: `ap-southeast-2` (Sydney)** · **Account: `958202484887`**

Training a custom model that classifies items directly into Findr's own categories.

---

# 🛑 READ THIS FIRST — COST PROTOCOL

Custom Labels is the **only** part of this project that can cost real money.

| | How it bills |
|---|---|
| Training | per training-hour (one-off, usually 1–2 hrs for a small dataset) |
| **Inference** | **per hour the model is RUNNING — around $4/hr** |
| Storage | negligible |

**The model runs until you stop it. There is no auto-shutdown, no idle timeout.**

### The three rules

1. **Never start the model unless you're actively using it in the next 10 minutes.**
2. **Stop it the moment you finish.** Not "later". Now.
3. **Check it's stopped before you close your laptop.** Every single time.

### Where to stop it

Rekognition → **Custom Labels** → Projects → your project → **Models** →
select the model → **Stop**. Status must read **STOPPED**.

### Do this now, before anything else

Set a phone alarm labelled **"IS THE REKOGNITION MODEL STOPPED?"** for 30 minutes
after you plan to start testing, and another for tonight. This sounds excessive.
It is not — leaving one running is the single most common way students on sandbox
accounts blow their budget.

> **Why the app doesn't depend on it:** the updated Lambda calls Custom Labels only
> if it's available, and silently falls back to standard Rekognition otherwise. So a
> stopped model means your site still works exactly as it does now, just without the
> custom classification. You lose nothing by keeping it stopped between sessions.

---

## Step 17 — Build the dataset

### Labels

Six categories. These are the most commonly lost items and they're visually distinct,
which is what matters for a classifier.

```
Bottle
Wallet
Phone
Laptop
Bag
Keys
```

> Deliberately not training on **Others**, **Electronics** or **School Materials** —
> they're not visually coherent categories, so a classifier can't learn them, and
> including them would drag your accuracy down. Anything the custom model isn't
> confident about falls back to standard Rekognition. Say this in the report; knowing
> which classes are learnable is a real ML judgement call.

### How many images

**20 per label, minimum 15.** So 120 images total, give or take.

Rekognition's hard minimum is 10 per label, but 10 gives a fragile model. 20 is the
sweet spot between accuracy and how long you'll spend downloading.

### What makes a good training set

Your model will only be as good as the variety in these images. Aim for a spread of:

- **Angles** — front, side, top-down
- **Backgrounds** — desk, floor, grass, in a hand
- **Colours** — don't make every bottle blue, or it'll learn "blue = bottle"
- **Lighting** — bright and dim

**Avoid:** product shots on pure white backgrounds. If every training image is a clean
studio photo, the model learns "white background = this item" and then fails on a real
phone snapshot taken on a canteen table. Search terms like `water bottle on desk` beat
`water bottle png`.

### Folder structure — get this exactly right

Make this on your computer:

```
findr-dataset/
├── Bottle/     (20 images)
├── Wallet/     (20 images)
├── Phone/      (20 images)
├── Laptop/     (20 images)
├── Bag/        (20 images)
└── Keys/       (20 images)
```

**The folder names become the labels**, which means zero manual labelling in the
console. Get the spelling and capitalisation right — they must match exactly what
you want the model to output.

JPEG or PNG only. Under 15MB each. Filenames don't matter.

> **Time-saver:** in Google Images, use Tools → Usage Rights → Creative Commons to
> narrow results, then drag images straight into the right folder. Roughly 30–40
> minutes for all 120.

📸 `55-dataset-folders.png` — your folder structure in File Explorer

---

## Step 18 — Upload the dataset to S3

Custom Labels reads training images from S3.

1. **S3** → **Create bucket**
2. Name: `findr-training-XXXXXXXX`
3. Region: **ap-southeast-2** ← must match, or Rekognition can't read it
4. Leave **Block Public Access fully ON** — this bucket is never public
5. **Create bucket**
6. Open it → **Upload** → **Add folder** → select each of the six category folders
7. **Upload** (120 files takes a couple of minutes)

Your objects should look like `Bottle/img01.jpg`, `Wallet/img07.jpg`, and so on.

📸 `56-training-bucket.png` — the bucket showing the six folders

---

## Step 19 — Create the project and dataset

1. Console search → **Rekognition** → left sidebar → **Custom Labels**
2. If prompted to let Rekognition create a console bucket, **allow it** — it needs
   somewhere to store evaluation results
3. **Projects** → **Create project**
4. Project name: `findr-item-classifier`
5. **Create project**

### Create the dataset

6. Inside the project → **Create dataset**
7. Choose **Start with a single dataset** — Rekognition will split it into training
   and test sets automatically (80/20)
8. Select **Import images from Amazon S3 bucket**
9. **S3 URI:** `s3://findr-training-XXXXXXXX/`
10. ✅ **Tick "Automatically attach labels to images based on the folder name"**
    ← this is the whole reason for the folder structure
11. **Create dataset**

If it complains about bucket permissions, it'll show you a policy to paste — copy it,
go to the training bucket's Permissions → Bucket policy → paste → save → retry.

12. Once imported, check the **Labels** panel on the left shows all six with roughly
    20 images each.

📸 `57-dataset-imported.png` — the dataset with labels and image counts

---

## Step 20 — Train

1. **Train model**
2. Choose your project as the training dataset source
3. **Train model** → confirm

**This takes 1–3 hours.** You don't need to sit and watch it. Status goes
`TRAINING_IN_PROGRESS` → `TRAINING_COMPLETED`.

> **You are not billed for inference during training** — only training-hours. This
> step is the cheap part.

**Start this and go do something else** — write your report, take page screenshots,
set up CloudFront. Don't wait around.

📸 `58-training-started.png`

### When it finishes

Open the model and look at the evaluation results:

| Metric | Means |
|---|---|
| **F1 score** | Overall accuracy, 0–1. Above 0.85 is good, above 0.9 is strong |
| **Precision** | When it says "Bottle", how often it's right |
| **Recall** | Of all the bottles, how many it found |

There's also a per-label breakdown. If one category scored badly, that's worth a
sentence in your report — it usually means those training images weren't varied enough.

📸 `59-model-evaluation.png` — the metrics page. **This is your single best screenshot
for the report.** It's direct evidence you trained and evaluated a model.

📸 `60-per-label-performance.png` — the per-label table

---

## Step 21 — Get the model ARN

1. On the model page, find **Use model**
2. Copy the **Model ARN**. It looks like:

```
arn:aws:rekognition:ap-southeast-2:958202484887:project/findr-item-classifier/version/findr-item-classifier.2026-08-12T10.30.00/1234567890123
```

**Send it to me** and paste it into the `findr-images` Lambda as an environment
variable named `CUSTOM_MODEL_ARN`.

---

## Step 22 — Add the IAM permission

Your Lambda role needs one more action.

1. **IAM** → **Policies** → `findr-lambda-policy` → **Edit**
2. In the `AnalyseImagesWithRekognition` statement, add `"rekognition:DetectCustomLabels"`
   to the Action list
3. **Save changes**

📸 `61-iam-custom-labels-permission.png`

---

## Step 23 — Start the model (only when testing)

1. Model page → **Start model**
2. **Inference units: 1** ← never more than 1
3. **Start**

Takes about 5 minutes to reach `RUNNING`.

# 🛑 THE MOMENT IT'S RUNNING, YOU ARE BEING BILLED

Test what you need to. Then:

1. Model page → **Stop model**
2. Wait for status **STOPPED**
3. **Refresh the page and confirm it says STOPPED**

📸 `62-model-running.png` — during your test
📸 `63-model-stopped.png` — proof you stopped it. Put this in the report; cost-aware
operation is a genuinely good thing to demonstrate.

---

## Step 24 — Test it

With the model running and `CUSTOM_MODEL_ARN` set on the Lambda:

1. Open your site → Report Lost Item
2. Upload a photo of one of your six categories
3. You should see **both**:
   - Standard Rekognition labels (as before)
   - A **"Findr Custom Model"** chip with your category and confidence

Then upload something *not* in the six — a chair, a plant. The custom model should
either stay quiet or report low confidence, and standard Rekognition carries on as
normal. That's the fallback working, and it's worth demonstrating.

📸 `64-custom-label-in-app.png` — both label sets showing on the form

**Then stop the model.**

---

## What to say about this in the report and presentation

You'll be asked why you trained a model when the pre-trained one already works. Have
this ready:

> Standard Rekognition returns general-purpose labels — a photo of a rucksack might
> come back as "Bag", "Accessory", "Luggage" — which then need mapping onto Findr's
> categories in code, using a lookup table that breaks whenever Rekognition returns
> something unanticipated. The custom model outputs Findr's taxonomy directly, so
> there's no mapping layer to maintain.
>
> The two run together rather than one replacing the other: standard Rekognition still
> provides the descriptive labels used for search and matching, while the custom model
> provides the category. If the custom model isn't running, the application falls back
> to the mapping approach automatically, so the feature degrades rather than fails.
>
> Custom Labels bills per running hour rather than per request, so the model is only
> started when needed. That's a deliberate cost decision, not a limitation.

That last paragraph in particular — showing you understand the *operational* cost model,
not just the API — is the kind of thing that separates an A from a B.

---

## ✅ Part C checklist

- [ ] 120 images sorted into 6 correctly-named folders
- [ ] Uploaded to `findr-training-XXXXXXXX`
- [ ] Project `findr-item-classifier` created
- [ ] Dataset imported with auto-labelling
- [ ] Training completed
- [ ] F1 score noted: `________`
- [ ] Model ARN copied
- [ ] `rekognition:DetectCustomLabels` added to the IAM policy
- [ ] `CUSTOM_MODEL_ARN` set on `findr-images`
- [ ] Tested in the app
- [ ] **MODEL STOPPED** ✋
- [ ] Screenshots 55–64 saved
