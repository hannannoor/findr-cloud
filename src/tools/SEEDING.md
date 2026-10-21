# Seeding Findr with demo data

Fills the app with ~30 reports, real Rekognition labels, map pins and chat
threads, then prints a handout for your lecturer.

Runs as a throwaway Lambda, so you need nothing installed locally.
Whole thing takes about 20 minutes, most of which is uploading photos.

---

## Step 1 — Accounts (do this first)

All four handout accounts must exist **and be email-verified** before seeding.
Sign each one up through your own registration page, not the AWS console — that
way you also prove the real sign-up flow works.

| Email | Display name | Role |
|---|---|---|
| `noorhannan125@gmail.com` | Admin Hannan | admin |
| `XXXXXXXX@student.tp.edu.sg` | Hannan Noor | student |
| `noorhannan2009@gmail.com` | Jia Ling Toh | student (claiming account) |
| `dkcheese111@gmail.com` | Arjun Menon | student |

Then make the admin an admin:

> Cognito → User pools → your pool → **Users** →
> `noorhannan125@gmail.com` → **Group memberships** → Add to `admin`

Log in as that account and check the **Admin** link appears in the navbar.
Nothing else grants admin rights.

**Check the display names.** The seeder reads names out of Cognito, so whatever
you typed at sign-up is what your lecturer sees. If one is wrong, fix it on the
Account page or in Cognito (Users → user → edit the `name` attribute) *before*
seeding.

---

## Step 2 — Photos

Your seed photos go in their own folder, **not** loose in `uploads/`. The
images already there belong to real reports, and sharing a key would mean two
reports pointing at one photo — delete either and the picture disappears from
the other.

> S3 → `findr-uploads-XXXXXXXX` → open **`uploads/`** →
> **Create folder** → name it `seed` → open it → **Upload** → drag your photos in

So they end up at `uploads/seed/…`. The seeder only reads that folder and never
touches anything already in `uploads/`.

Filenames don't matter. Titles come from Rekognition.

Two things worth knowing:

- **Variety beats quantity.** Titles are built from Rekognition's top mapped
  label, so 30 photos of bags produce 30 reports called "Black Bag",
  "Navy Bag"... Spread them across wallets, bottles, umbrellas, laptops, keys,
  headphones, books, jackets. That also makes the category filter worth demoing.
- **Upload a couple of spares.** Anything Rekognition can't confidently label is
  skipped, and the log names each skipped file.

---

## Step 3 — Create the Lambda

> Lambda → **Create function**

- Name: `findr-seed`
- Runtime: **Python 3.12**
- Permissions → **Use an existing role** → the same role your other Findr
  functions use

Paste all of `seed_data.py` over the default code → **Deploy**.

---

## Step 4 — Configure it

**Configuration → General configuration → Edit**

- Timeout: **5 min**
- Memory: **512 MB**

**Configuration → Environment variables** — add three, copying the exact values
from your `findr-reports` function:

```
REPORTS_TABLE    findr-reports
MESSAGES_TABLE   findr-messages
UPLOAD_BUCKET    findr-uploads-XXXXXXXX
```

---

## Step 5 — Temporary permissions

The Findr role can't touch Cognito, and the seeder needs to create the filler
accounts.

> IAM → Roles → your Findr role → **Add permissions** →
> **Create inline policy** → **JSON** tab

Paste the contents of `seed-temp-policy.json`, name it `findr-seed-temp`,
create it.

This is temporary. Step 7 removes it.

---

## Step 6 — Run it

Lambda → **Test** tab → create a test event, any name, leave the JSON as `{}` →
**Test**.

Takes 1–2 minutes. Expand **Execution results** and read the log:

```
Using user pool findr-users (ap-southeast-2_XXXXXXX)
Creating filler accounts...
  created aisyah.rahman@students.tp.edu.sg
Found 10 accounts in the pool
Reading photos from s3 and running rekognition...
  uploads/img01.jpg -> Red Bottle / Bottle (Bottle, Water Bottle, Shaker)
  ...
30 photos ready
Wrote 30 reports from 30 distinct photos
Wrote 8 conversations

====================================================================
HANDOUT - give this to your lecturer
====================================================================
```

**Copy the handout section out now.** It contains the claim answer key and you
won't get it back without re-running.

Skim the `->` lines while you're there. If a colour looks wrong, Rekognition
picked the dominant colour and something else in the photo won that. Fix those
few through the app's own edit modal — which gives you a real screenshot too.

---

## Step 7 — Clean up (do not skip)

1. IAM → your Findr role → delete the `findr-seed-temp` inline policy
2. Lambda → delete the `findr-seed` function

If you leave the policy attached, every Findr Lambda keeps the ability to
create Cognito users. That is exactly the sort of thing a marker looking at
least-privilege will pick up on.

---

## Step 8 — Check it worked

- **Browse** — full grid, mixed categories
- **Map** — pins scattered across campus, not stacked on one spot
- Log in as a handout account — **My Reports** and **Messages** both populated
- **Admin** — total count roughly 30

---

## Optional but worth it

The seeder marks everything `Open`. Before your demo, log in as **Jia Ling Toh**
and claim one of the found items using the answer key. That gives you:

- a genuinely Claimed item with a real verification record
- a real SNS notification email
- the "Ownership verified" banner for your screenshots

Better evidence than seeded data, because it went through the actual flow.

---

## Removing the traces of seeding

Every seeded row carries `seeded=True` so it can be cleaned up later. Once
you're happy with the data, strip that marker:

> Set `MODE = "unflag"` at the top → Deploy → Test

This writes a manifest to `s3://findr-uploads-XXXXXXXX/uploads/_seed-manifest.json`
listing exactly what it created, **then** removes the marker from every row. So
nothing in DynamoDB says how the data got there, and you can still undo it.

Then delete the rest by hand:

1. Lambda → delete `findr-seed`
2. IAM → your Findr role → delete the `findr-seed-temp` inline policy
3. CloudWatch → Log groups → delete `/aws/lambda/findr-seed`
4. Don't include `tools/` in your submission zip

Leave the manifest in S3 until you're certain you won't need to purge. It's a
`.json`, so the photo loader ignores it and the app never lists the bucket.

## Wiping the data and starting again

Don't delete rows by hand in DynamoDB — 29 reports plus their message threads,
and it's easy to take out a real one by mistake.

> Set `MODE = "purge"` → **Deploy** → **Test**

That's it. Then set it back to `"seed"`, Deploy, Test to re-seed.

`Deploy` matters: editing the code in the console without deploying leaves the
old version running, so it'll seed again instead of purging.

## Undoing it

> Set `MODE = "purge"` → Deploy → Test

Uses the manifest if there is one, so it works even after `unflag`, and falls
back to the `seeded` marker otherwise. It deletes the manifest afterwards.

Filler Cognito accounts stay — delete those in the console.

**Order matters:** once you've deleted both the manifest and the marker, there's
no automated way to tell seeded rows from real ones, and cleanup becomes manual.

---

## If it fails

| Log message | Cause |
|---|---|
| `AccessDeniedException` on a Cognito call | Step 5 didn't apply, or you edited the wrong role |
| `No usable images under s3://...` | Photos aren't in `uploads/seed/` — check the folder name |
| `WARNING - these handout accounts don't exist yet` | Typo in `HANDOUT_ACCOUNTS`, or the account isn't verified |
| `Could not find the user pool for that client id` | `COGNITO_CLIENT_ID` doesn't match the one in `js/api.js` |
| Task timed out | Raise the timeout, or upload fewer photos |

---

## Before you submit

- Delete the filler Cognito accounts
- Change the handout passwords
- **Don't ship `seed_data.py` in your submission zip** — it contains a plaintext
  demo password and isn't part of the application
