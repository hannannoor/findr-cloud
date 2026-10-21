# Findr — 5 minute demonstration video

Workflow: **capture silent footage first → edit and trim → record voiceover over the top → add facecam.**
That is the right order. It means you can click slowly and calmly, redo any single clip without redoing the whole thing, and speak cleanly instead of narrating while you hunt for a button.

Final deliverable: one video, **under 5:00**, uploaded to YouTube as **Unlisted**, link on slide 9 of the deck and in the Introduction section of the report.

---

# Part 1 — Setup, 30 minutes before you record

## 1.1 Start the trained model

This is the one thing that cannot be fixed in the edit.

1. AWS console → check the region picker top right says **Asia Pacific (Sydney) ap-southeast-2**. If it says anything else, your project will not appear.
2. Rekognition → **Custom Labels** → your project → the model.
3. Click **Start**. Wait for status **RUNNING**. This takes several minutes.
4. Load the Report Found page on the site and upload any photo to confirm the panel says **FINDR CUSTOM MODEL** and not the offline notice.

**Stop the model the moment you finish recording.** It bills per hour while running.

## 1.2 Windows and accounts

Three browser windows, all signed in before you record.

| Window | Account | Role in the video |
|---|---|---|
| Chrome, normal | `XXXXXXXX@student.tp.edu.sg` | The **finder**. Reports the item. |
| Chrome, incognito | `noorhannan2009@gmail.com` | The **claimant**. Makes the claim. |
| Edge (or Firefox) | `noorhannan125@gmail.com` | The **admin**. Dashboard only. |

Passwords are in `HOW-TO-TEST.txt`. Sign in to all three now so no password is ever typed on camera.

## 1.3 Tabs to pre-open

**In the finder window**, in this order: Home · Browse · Map · Report Found · the email inbox subscribed to the `findr-notifications` SNS topic.

**In a fourth window for AWS**, seven tabs, left to right, all in **ap-southeast-2**:

1. Rekognition → Custom Labels → your model's **evaluation results** page
2. Lambda → Functions list
3. API Gateway → your API → **Resources**
4. DynamoDB → Tables → `findr-reports` → **Explore items**
5. S3 → Buckets list
6. CloudFront → your distribution → **Origins** tab
7. CloudWatch → Log groups → `/aws/lambda/findr-images`

## 1.4 Prepare the item you will claim

Do not create this on camera. It already exists.

Use **Black Wallet — Bus Stop, Main Gate**. Its two private facts are:

- a photo is tucked behind one of the card slots
- one corner of the leather is scuffed pale

You will answer wrongly once, then correctly. Have both answers in your head.

## 1.5 Everything else

- A photo of an **umbrella, phone or jacket** on the desktop for the live upload. Those three labels score 1.000. Do not use a bottle.
- Browser zoom **110%**, window maximised, bookmarks bar hidden (Ctrl+Shift+B), notifications off.
- Close every unrelated tab, and anything personal in the taskbar.
- Recording tool: **OBS Studio**, Display Capture, 1920x1080, 30fps. Do not record the microphone yet.
- Nothing on screen should ever show a password or an AWS access key.

---

# Part 2 — Capture, five separate clips

Record each as its own file. If one goes wrong you redo one clip, not the video.

Move **deliberately**. Land on a screen, pause 2 seconds so it is readable, then move. Dead time is free right now because you will trim it.

---

### Clip A — the website tour  ·  target 45 s of usable footage

| # | Do exactly this | Hold |
|---|---|---|
| 1 | Home page, top of the page. Let the hero and the counters be visible. | 3 s |
| 2 | Scroll slowly to the bottom of Home, then back to top. | 5 s |
| 3 | Click **Browse**. | 3 s |
| 4 | Set the **Category** filter to Wallet. Let the grid update. | 3 s |
| 5 | Reset the filter to All. Set **Status** to Found. | 3 s |
| 6 | Click **Map**. Let the pins load. | 3 s |
| 7 | Click one pin so its popup opens. | 3 s |

---

### Clip B — the live upload, the most important clip  ·  target 60 s

| # | Do exactly this | Hold |
|---|---|---|
| 1 | In the finder window, click **Report Found**. | 2 s |
| 2 | Click the photo upload area, pick the umbrella photo from the desktop. | — |
| 3 | **Wait without touching anything** while the analysis runs. | until done |
| 4 | Move the cursor to the **FINDR CUSTOM MODEL** block and leave it there. | 4 s |
| 5 | Move the cursor down to the **AWS REKOGNITION (PRETRAINED)** chips. | 3 s |
| 6 | Scroll so the filled-in **Category** and **Description** are both on screen. | 5 s |
| 7 | Type a location, or pick one on the mini map. | — |
| 8 | Scroll to the **private details** field. Type one fact, slowly. | 5 s |
| 9 | Click **Submit**. Let the success message appear. | 3 s |
| 10 | Click **My Reports** so the new report is visible in the list. | 3 s |

If the panel shows the offline notice, stop. The model is not running. Go back to 1.1.

---

### Clip C — the notification  ·  target 10 s

| # | Do exactly this | Hold |
|---|---|---|
| 1 | Switch to the inbox tab. Refresh until the Findr email arrives. | — |
| 2 | Open it. Scroll so the item name and details are readable. | 6 s |

---

### Clip D — verification, the feature that sets the project apart  ·  target 60 s

Do this in the **incognito** window as the claimant.

| # | Do exactly this | Hold |
|---|---|---|
| 1 | Browse → open **Black Wallet**. | 3 s |
| 2 | Click **This is mine — verify & claim**, then **Start**. | 2 s |
| 3 | Read the two questions on screen. | 4 s |
| 4 | Type a **wrong** answer in each. Something vague like "it is black and quite old". | — |
| 5 | Submit. Let the **Claim not verified** result and the low score appear. | 5 s |
| 6 | Close, then start the claim again. | 2 s |
| 7 | Answer **correctly** in your own words, using the two real facts. | — |
| 8 | Submit. Let **Claim verified** and the score appear. | 5 s |
| 9 | Close. Show the item now marked **Claimed**. | 3 s |
| 10 | Back on the item page, click **Read this in → 中文**, then **தமிழ்**. | 4 s each |

---

### Clip E — the AWS console  ·  target 70 s

Ten seconds per tab. Do not click into anything except where stated. Just land, pause, move on.

| # | Tab | What must be visible | Hold |
|---|---|---|---|
| 1 | Rekognition Custom Labels | The evaluation page: **F1 0.955**, and the per-label table. Scroll once so all eight labels show. | 12 s |
| 2 | Lambda | The list of six `findr-` functions. Click into `findr-images` so the code editor is visible. | 10 s |
| 3 | API Gateway | The resource tree. Then click **Authorizers** in the left menu to show the Cognito authoriser. | 10 s |
| 4 | DynamoDB | `findr-reports` items. Scroll to the report you created in Clip B. | 8 s |
| 5 | S3 | The bucket list. Click `findr-site-XXXXXXXX` → **Permissions** → Block Public Access showing **On**. | 10 s |
| 6 | CloudFront | The distribution's Origins tab, with **Origin access control** visible. | 8 s |
| 7 | CloudWatch | `/aws/lambda/findr-images`, newest log stream open, showing the invocation from Clip B. | 10 s |

If you run short on time in the edit, cut CloudWatch and CloudFront. **Never cut Rekognition or Lambda.**

---

# Part 3 — Edit

1. Drop the clips in order: **A → B → C → D → E**.
2. Trim every pause where nothing happens or you are typing a long string. Speed up typing sections to 2x if your editor allows.
3. Target this shape:

| Section | From | To | Length |
|---|---|---|---|
| Title card (export slide 1 as an image) | 0:00 | 0:08 | 8 s |
| Clip A — website tour | 0:08 | 0:50 | 42 s |
| Clip B — live upload and AI | 0:50 | 1:55 | 65 s |
| Clip C — notification email | 1:55 | 2:07 | 12 s |
| Clip D — verification and translation | 2:07 | 3:15 | 68 s |
| Clip E — AWS console | 3:15 | 4:35 | 80 s |
| Closing card (export slide 9 as an image) | 4:35 | 4:50 | 15 s |

That lands at **4:50** with ten seconds of slack.

4. Add a text caption on screen for each AWS service as it appears. The marker is looking for the service names.
5. No music, or music so quiet you cannot hear it once the voice is in.

**Editor:** Clipchamp is built into Windows 11 and does everything above. CapCut is fine too.

---

# Part 4 — Voiceover script

About 640 words, which is comfortable at a normal speaking pace over 4:50. Record it in one go while watching the edit play, or section by section and line it up after.

Speak slightly slower than feels natural. Leave a breath between sections.

---

**0:00 — Title**

> Hi, I'm Mohammed Hannan Noor, XXXXXXXX, class group PC02. This is Findr, a campus lost and found platform built on AWS.

**0:08 — Website tour**

> Lost property on campus fails in two ways. Someone who loses a water bottle in the library has no way of knowing that one was handed in at the canteen three days ago. And when an item is valuable, anyone who reads the listing can describe it convincingly enough to be handed it, so the finder has no way of telling a real owner from someone who just read the notice.
>
> Findr fixes both. Every report is searchable and filterable, so items are actually discoverable. And here on the map, every report with a location is plotted using Amazon Location Service, with each marker showing the item's own photograph rather than a generic pin, because location is usually the strongest clue somebody has.

**0:50 — The live upload**

> This is the part I spent the most time on. I'm reporting a found item, and all I'm going to give it is a photograph.
>
> Two models look at that image. This top block is my own model: a Rekognition Custom Labels classifier I trained on 398 images across the eight categories a campus lost property counter actually files items under. It scored an F1 of 0.955, with an average precision of 0.976.
>
> Underneath, kept deliberately separate, are the labels from Amazon's pretrained model. Those are useful as supporting detail, but they don't know my categories. During testing the pretrained model called a set of keys a weapon, and a bottle a mason jar, which is exactly why I trained my own.
>
> The category has been filled in from my model's classification, and this description was drafted by Amazon Bedrock, which receives the actual image plus my model's answer and is told to treat that answer as correct.
>
> Down here I add a private detail. This never appears on the public listing. It's the basis of the ownership check in a moment.

**1:55 — Notification**

> When the report is submitted, Amazon SNS emails a notification. Reporting an item is more important than the email about it, so if this ever fails it's logged and the report still goes through.

**2:07 — Verification**

> Now the ownership check. I'm a different user, claiming a wallet somebody else handed in.
>
> Amazon Bedrock has turned the finder's private facts into questions. Notice that neither question gives away its own fact. They ask about the condition, and about what's inside, leaving me to supply the actual detail.
>
> First I'll answer vaguely, the way somebody who had only read the listing would. It scores zero and refuses the claim.
>
> Now the real answers, in my own words rather than copied wording. It scores above the sixty percent threshold, the claim is approved, and the item flips to Claimed. The finder is emailed either way, including the score, so a human can still override the decision.
>
> Any listing can also be read in Chinese, Malay or Tamil. Amazon Comprehend detects the source language automatically, so nobody has to tell the platform what language a report was written in.

**3:15 — AWS console**

> Here's what sits behind it. This is the trained model and its evaluation results: eight labels, 398 images, an F1 of 0.955.
>
> Six Lambda functions hold all the logic. They sit behind an API Gateway REST API, where every protected method uses a Cognito authoriser, so the token is validated before any of my code runs.
>
> Reports go into DynamoDB. The site bucket in S3 has Block Public Access on and is readable only through CloudFront using Origin Access Control, so the storage is never exposed directly.
>
> And CloudWatch has the logs from the request I made two minutes ago.

**4:35 — Close**

> Fifteen AWS services, nothing running while the site is idle. The next thing I'd build is automatic matching on submission, so Findr contacts people instead of waiting to be searched. Thanks for watching.

---

# Part 5 — Facecam

- Bottom right corner, small, roughly a fifth of the screen width. Round or rounded-square mask looks tidier than a raw rectangle.
- Only show it during the **title** and the **closing**, or keep it small throughout. Do not let it cover any UI you are demonstrating.
- Look at the camera, not the preview.
- Plain background, light on your face, nothing personal visible behind you.

---

# Part 6 — Upload

1. Export 1080p.
2. Check the length is **under 5:00**.
3. YouTube → Upload → visibility **Unlisted**. Not Private, or the marker cannot open it.
4. Open the link in a private window to confirm it plays without signing in.
5. Paste the link onto **slide 9** of the deck and into the **Introduction** section of the report.
6. **Stop the Custom Labels model.**

---

# If something goes wrong on the day

| Problem | What to do |
|---|---|
| Custom model shows the offline notice | It is stopped, or you are in the wrong region. Start it, wait for RUNNING, re-record Clip B. |
| Rekognition project list is empty | Region picker is not on ap-southeast-2. |
| Bedrock description comes back blank | The call failed and fell back. Just re-upload; the app is designed not to block on it. |
| Verification passes when you answer wrongly | Your wrong answer was too close to the truth. Say something entirely unrelated. |
| Admin link missing on the admin account | The token predates the group. Sign out and back in. |
| A change to the site is not showing | CloudFront is serving a cached copy. Invalidate `/*` and wait a minute. |
