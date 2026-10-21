# Findr — Part D: CloudFront (HTTPS + private bucket)

**Region: `ap-southeast-2`** · **Account: `958202484887`**

About 15 minutes of clicking, then 10–15 minutes waiting for the distribution to
deploy. Do the clicking now while the Rekognition model starts.

## What this achieves

| | Before | After |
|---|---|---|
| URL | `http://...s3-website-...` | `https://xxxx.cloudfront.net` |
| Protocol | HTTP only | **HTTPS, enforced** |
| Bucket | Public to the whole internet | **Private — only CloudFront can read it** |
| Delivery | Single region (Sydney) | Cached at edge locations worldwide |

That second and third row are the ones that matter for marks. The Cloud Security
rubric asks for *"correct bucket policies, HTTPS enforced, principle of least
privilege applied"* — this gives you all three in one step.

> **The mechanism is Origin Access Control (OAC).** CloudFront signs every request
> it makes to S3 with its own identity. The bucket policy then allows exactly one
> principal — the CloudFront service — and only for your specific distribution.
> Nobody can reach the bucket directly, even knowing its URL. That's a genuinely
> better answer than a public bucket, and it's the pattern AWS recommends.

---

## Step 25 — Create the distribution

1. Console search → **CloudFront** → **Create distribution**

> CloudFront is global, so there's no region selector. That's normal.

### Origin

2. **Origin domain:** click the box and pick `findr-site-XXXXXXXX.s3.ap-southeast-2.amazonaws.com`
   from the dropdown.

   ⚠️ Pick the plain **S3 bucket** entry, **not** the one ending
   `s3-website-ap-southeast-2.amazonaws.com`. The website endpoint can't use OAC
   and only speaks HTTP, which defeats the point.

3. **Origin access:** select **Origin access control settings (recommended)**
4. Click **Create new OAC** → name it `findr-site-oac` → **Create**
5. A blue banner appears saying you must update the bucket policy. **Leave that
   tab open** — you'll copy the policy from it in Step 26.

### Default cache behaviour

6. **Viewer protocol policy:** **Redirect HTTP to HTTPS** ← this is the HTTPS enforcement
7. **Allowed HTTP methods:** `GET, HEAD`
8. **Cache policy:** `CachingOptimized`

### Settings

9. **Price class:** *Use all edge locations* (best performance; cost is per-request
   and negligible at your volume)
10. **Default root object:** `index.html` ← without this, the bare domain returns an error
11. Leave WAF **off** — it costs money and you don't need it
12. **Create distribution**

📸 `66-cloudfront-origin-oac.png` — the origin settings showing OAC
📸 `67-cloudfront-https-redirect.png` — the viewer protocol policy

---

## Step 26 — Let CloudFront read the bucket

1. On the distribution page there's a banner: **"The S3 bucket policy needs to be
   updated"** → click **Copy policy**
2. Go to **S3** → `findr-site-XXXXXXXX` → **Permissions** → **Bucket policy** → **Edit**
3. **Paste it, replacing everything that's there.**

   The policy you copied allows only the CloudFront service principal, restricted
   to your distribution ARN. Your old public-read statement is gone, which is the
   point — the bucket is now private.

4. **Save changes**

📸 `68-bucket-policy-oac.png` — the new policy. **Put this next to your old public
policy in the report.** Before-and-after is the clearest possible evidence of a
security improvement.

> **Your old S3 website URL will now return 403.** That's correct and expected —
> it means the bucket is genuinely private. From here on, the site is the
> CloudFront URL.

---

## Step 27 — Wait, then test

The distribution shows **Deploying** for 10–15 minutes. Grab a coffee, or go stop
the Rekognition model.

When status reads **Enabled**, copy the **Distribution domain name**:

```
https://xxxxxxxxx.cloudfront.net
```

**Send me that URL** — it goes into the CORS settings.

### Test

1. Open the CloudFront URL → site should load, padlock in the address bar
2. Try `http://` explicitly — it should redirect to `https://`
3. Try your old S3 website URL → should now be **403**. That's a pass, not a failure

📸 `69-cloudfront-site-https.png` — the site loading with the padlock visible
📸 `70-s3-direct-403.png` — the old URL now refused

---

## Step 28 — Tighten CORS to the new domain

Now that a real origin exists, lock the wildcards down. This is the
"principle of least privilege" step, and it's worth doing explicitly so you can
write about it.

### Uploads bucket

**S3** → `findr-uploads-XXXXXXXX` → **Permissions** → **CORS** → **Edit**:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedOrigins": ["https://YOUR-DISTRIBUTION.cloudfront.net"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Replace the domain with yours.

### API Gateway

For each of the 8 resources: select it → **Enable CORS** →
set **Access-Control-Allow-Origin** to your CloudFront URL instead of `*` → Save.

Then **Deploy API** → stage `prod`. *(Nothing takes effect until you deploy.)*

📸 `71-cors-locked-down.png`

> ⚠️ **Do this last, after everything works.** Once CORS is locked to CloudFront,
> opening the site any other way (local file, S3 URL) will fail with CORS errors.
> That's intended, but it will confuse you if you forget.
>
> If you're tight on time tonight, **leave CORS as `*` and do this tomorrow morning.**
> A working site with permissive CORS scores better than a locked-down broken one.

---

## Step 29 — Update Cognito's callback URL

Cognito has that placeholder callback from setup. Tidy it up:

**Cognito** → your pool → **App clients** → `findr-web` → **Login pages** → Edit →
replace the callback URL with your CloudFront URL → Save.

Not strictly required (you're not using the hosted UI) but it's a loose end a
marker might notice.

---

## ✅ Part D checklist

- [ ] Distribution created with OAC
- [ ] Viewer protocol policy = Redirect HTTP to HTTPS
- [ ] Default root object = `index.html`
- [ ] Bucket policy replaced with the OAC one
- [ ] Status **Enabled**
- [ ] **CloudFront URL:** `________________________________`
- [ ] Site loads over HTTPS with a padlock
- [ ] Old S3 website URL returns 403
- [ ] CORS tightened *(optional — can wait until tomorrow)*
- [ ] Screenshots 66–71 saved

---

## What to say about this

> The site is served through CloudFront rather than directly from S3. The bucket has
> no public access at all — its policy grants read access to a single principal, the
> CloudFront service, and only for this distribution. CloudFront enforces HTTPS by
> redirecting any HTTP request, which S3's website endpoint cannot do since it only
> serves over HTTP.
>
> This also means the origin is never exposed: requests can't bypass CloudFront to
> hit S3 directly. Combined with the uploads bucket, which is private and only
> reachable through presigned URLs generated by Lambda, no S3 bucket in the
> application is publicly readable.

That last sentence is the one to say out loud in the demo.
