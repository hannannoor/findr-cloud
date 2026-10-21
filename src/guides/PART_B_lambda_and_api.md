# Findr — AWS Setup Guide, Part B: Lambda Functions & API Gateway

**Region: `ap-southeast-2` (Sydney)** · **Account: `958202484887`**

Part A built the foundations. Part B deploys the six Lambda functions and puts an
API in front of them. Budget about 2 hours. At the end you'll have a working
backend you can hit from a browser.

> **Screenshot numbering continues from Part A.** Part A ended around `17-`, so
> Part B starts at `18-`. Every 📸 below gives you the exact filename to use.

---

## Your values (already filled in below — no editing needed)

| Setting | Value |
|---|---|
| Region | `ap-southeast-2` |
| Account ID | `958202484887` |
| Reports table | `findr-reports` |
| Messages table | `findr-messages` |
| Uploads bucket | `findr-uploads-XXXXXXXX` |
| SNS topic ARN | `arn:aws:sns:ap-southeast-2:958202484887:findr-notifications` |
| Cognito User Pool ID | `ap-southeast-2_RPeqoFxCP` |
| Cognito Client ID | `16jogn83v7hms86hgjkk6v00mp` |
| Lambda role | `findr-lambda-role` |

---

## Step 7 — Check Bedrock model access

Do this first because it determines one environment variable.

1. Console search → **Bedrock** → left sidebar → **Model access**.
2. Look for **Amazon Nova Lite**. If it says **Access granted**, you're set.
   If not, click **Modify model access**, tick Nova Lite, and submit. Amazon's own
   models are usually approved instantly.
3. Go to **Model catalog**, click Nova Lite, and copy the **Model ID**. In Sydney
   it will most likely be `apac.amazon.nova-lite-v1:0` — the `apac.` prefix means
   it's a cross-region inference profile, which is normal and expected here.

📸 `18-bedrock-model-access.png` — the Model access page showing Access granted

> **If Bedrock is blocked in your sandbox**, don't panic and don't stop. Every
> function that uses it has an `ENABLE_BEDROCK` flag. Set it to `false` and the
> app runs perfectly on label-based matching instead. You'd lose one of your five
> additional services, still leaving four — comfortably "multiple".

---

## Step 8 — Create the five API Lambda functions

You'll repeat the same six clicks five times. The recipe is identical each time;
only the name, code file, and environment variables change.

### The recipe (do this once per function)

1. Console search → **Lambda** → **Create function**.
2. Select **Author from scratch**.
3. **Function name:** *(from the table below)*
4. **Runtime:** **Python 3.13** (or Python 3.12 — either is fine)
5. **Architecture:** `x86_64`
6. Expand **Change default execution role**:
   - Select **Use an existing role**
   - Choose **`findr-lambda-role`**
   - *This is the important one. If you skip it, Lambda silently creates a brand
     new role with no permissions and every call fails with AccessDenied.*
7. **Create function.**
8. In the **Code** tab, open `lambda_function.py`, select all (`Ctrl+A`), delete,
   and paste the entire contents of the matching `.py` file.
9. Click **Deploy** (or `Ctrl+S`). Wait for "Changes deployed".
10. Go to the **Configuration** tab → **General configuration** → **Edit** →
    set **Memory** and **Timeout** per the table → **Save**.
11. **Configuration** → **Environment variables** → **Edit** → add each key/value
    from the table → **Save**.

### The five functions

| Function name | Paste this file | Memory | Timeout |
|---|---|---|---|
| `findr-reports` | `findr-reports.py` | 256 MB | 15 sec |
| `findr-images` | `findr-images.py` | 512 MB | 60 sec |
| `findr-match` | `findr-match.py` | 512 MB | 60 sec |
| `findr-messages` | `findr-messages.py` | 256 MB | 15 sec |
| `findr-translate` | `findr-translate.py` | 256 MB | 15 sec |

> **Why the timeouts differ:** Lambda's default is 3 seconds. Rekognition plus a
> Bedrock call can take 10–20 seconds, so `findr-images` and `findr-match` need
> real headroom. Leaving them at 3s produces a timeout that looks exactly like a
> code bug and wastes an hour. More memory also means more CPU, so 512 MB actually
> runs *cheaper* on these two — it finishes proportionally faster.

### Environment variables

**`findr-reports`**
```
REPORTS_TABLE   = findr-reports
UPLOAD_BUCKET   = findr-uploads-XXXXXXXX
SNS_TOPIC_ARN   = arn:aws:sns:ap-southeast-2:958202484887:findr-notifications
```

**`findr-images`**
```
UPLOAD_BUCKET   = findr-uploads-XXXXXXXX
BEDROCK_MODEL   = apac.amazon.nova-lite-v1:0
ENABLE_BEDROCK  = true
```

**`findr-match`**
```
REPORTS_TABLE   = findr-reports
UPLOAD_BUCKET   = findr-uploads-XXXXXXXX
BEDROCK_MODEL   = apac.amazon.nova-lite-v1:0
ENABLE_BEDROCK  = true
```

**`findr-messages`**
```
MESSAGES_TABLE  = findr-messages
SNS_TOPIC_ARN   = arn:aws:sns:ap-southeast-2:958202484887:findr-notifications
```

**`findr-translate`** — no environment variables needed.

> If Bedrock wasn't granted, set `ENABLE_BEDROCK = false` on both functions that
> use it. Everything else still works.

📸 `19-lambda-functions-list.png` — the Lambda console listing all five
📸 `20-lambda-reports-config.png` — `findr-reports` General configuration (memory + timeout)
📸 `21-lambda-reports-envvars.png` — `findr-reports` environment variables
📸 `22-lambda-images-envvars.png` — `findr-images` environment variables
📸 `23-lambda-execution-role.png` — Configuration → Permissions showing `findr-lambda-role`

---

## Step 9 — Create the Cognito trigger function

Same recipe, but this one is never called by the API.

1. **Create function** → name: `findr-presignup` → Python 3.13 →
   **Use an existing role** → `findr-lambda-role` → Create.
2. Paste `findr-presignup.py` → **Deploy**.
3. Leave memory and timeout at their defaults — it does almost nothing.

### Attach it to Cognito

1. Console search → **Cognito** → your pool (`User pool - jef4xn`).
2. Left sidebar → **Extensions** (under Applications).
3. Find **Add Lambda trigger** (or **Triggers**).
4. Trigger type: **Sign-up**
5. Sign-up trigger: **Pre sign-up trigger**
6. Lambda function: **`findr-presignup`**
7. **Add Lambda trigger** / Save.

📸 `24-cognito-presignup-trigger.png` — the trigger attached

> **What this changes:** without it, a new user gets emailed a 6-digit code and
> can't sign in until they enter it. With it, sign-up flows straight into a usable
> account. Deliberate demo-environment tradeoff — say exactly that in the report,
> and note that production would keep verification enabled.

---

## Step 10 — Smoke-test one Lambda before building the API

Worth two minutes. If a function is broken, you want to know now, not after
wiring up fourteen API methods.

1. Open **`findr-reports`** → **Test** tab.
2. Event name: `testListReports`
3. Replace the event JSON with:

```json
{
  "httpMethod": "GET",
  "path": "/reports",
  "queryStringParameters": null,
  "pathParameters": null,
  "body": null
}
```

4. **Save**, then **Test**.

**Expected:** a green box, `"statusCode": 200`, and a body like
`{"success": true, "reports": [], "total": 0}`. Empty is correct — no reports exist yet.

**If you get an error:**

| Error contains | Meaning | Fix |
|---|---|---|
| `KeyError: 'REPORTS_TABLE'` | Env var missing or misspelled | Recheck Step 8 env vars |
| `AccessDeniedException` | Wrong execution role | Configuration → Permissions → should be `findr-lambda-role` |
| `ResourceNotFoundException` | Table name wrong, or table is in another region | Check DynamoDB is in ap-southeast-2 |
| `Task timed out` | Timeout too low | Raise it in General configuration |

📸 `25-lambda-test-success.png` — the successful test result

---

## Step 11 — Create the REST API

1. Console search → **API Gateway** → **Create API**.
2. Find **REST API** (the plain one — **not** "REST API Private", **not** "HTTP API")
   → **Build**.
3. Choose **New API**.
4. **API name:** `findr-api`
5. **Endpoint type:** **Regional**
6. **Create API.**

📸 `26-api-created.png`

> **Why REST API and not HTTP API:** REST API supports Cognito User Pool
> authorizers natively and has the CORS helper built into the console. HTTP API is
> cheaper but the authorizer setup is fiddlier. At your traffic level the cost
> difference is nil, so we take the easier path.

---

## Step 12 — Create the Cognito authorizer

Do this before creating methods, so it's selectable when you need it.

1. In `findr-api`, left sidebar → **Authorizers** → **Create authorizer**.
2. **Authorizer name:** `findr-cognito-auth`
3. **Authorizer type:** **Cognito**
4. **Cognito user pool:** select `ap-southeast-2_RPeqoFxCP`
5. **Token source:** `Authorization` ← type exactly this, case-sensitive
6. **Create authorizer.**

📸 `27-cognito-authorizer.png`

> **What this does:** API Gateway now validates the JWT on every protected route
> *before* your Lambda runs — checking the signature, expiry, and that it came from
> your pool. Invalid tokens get a 401 without ever reaching your code. The verified
> claims are then handed to Lambda, which is why `get_user()` can trust them.
> This is a strong point to make in the security section of your report.

---

## Step 13 — Build the resource tree

This is the longest part. You're creating this structure:

```
/
├── reports                      GET (open)    POST (auth)
│   └── {id}                     GET (open)    PUT (auth)   DELETE (auth)
├── images
│   ├── upload-url               POST (auth)
│   └── analyse                  POST (auth)
├── match                        POST (auth)
├── messages                     GET (auth)    POST (auth)
│   └── {conversationId}         GET (auth)
└── translate                    POST (open)
```

### How to create a resource

**Resources** → select the parent → **Create resource** → type the name → **Create**.

### How to create a method

1. Select the resource → **Create method**
2. **Method type:** pick from the table
3. **Integration type:** **Lambda**
4. ✅ **Lambda proxy integration** ← **TICK THIS. Every single method.**
5. **Lambda function:** pick from the table (region `ap-southeast-2`)
6. **Authorization:**
   - For **(auth)** rows → select **`findr-cognito-auth`**
   - For **(open)** rows → leave as **None**
7. **Create method**
8. If asked for permission to invoke the function, **accept**.

> **Lambda proxy integration is the one that matters.** With it ticked, API Gateway
> passes the whole request through — `httpMethod`, `path`, `pathParameters`, `body`,
> and the authorizer claims — exactly the shape the code expects. Untick it and
> you'd have to hand-write mapping templates for every method. If something returns
> a bizarre `Internal server error` later, this is the first thing to check.

### Every resource and method

| Path | Resource name to type | Method | Lambda | Auth |
|---|---|---|---|---|
| `/reports` | `reports` | GET | `findr-reports` | None |
| `/reports` | — | POST | `findr-reports` | `findr-cognito-auth` |
| `/reports/{id}` | `{id}` | GET | `findr-reports` | None |
| `/reports/{id}` | — | PUT | `findr-reports` | `findr-cognito-auth` |
| `/reports/{id}` | — | DELETE | `findr-reports` | `findr-cognito-auth` |
| `/images` | `images` | *(no method)* | — | — |
| `/images/upload-url` | `upload-url` | POST | `findr-images` | `findr-cognito-auth` |
| `/images/analyse` | `analyse` | POST | `findr-images` | `findr-cognito-auth` |
| `/match` | `match` | POST | `findr-match` | `findr-cognito-auth` |
| `/messages` | `messages` | GET | `findr-messages` | `findr-cognito-auth` |
| `/messages` | — | POST | `findr-messages` | `findr-cognito-auth` |
| `/messages/{conversationId}` | `{conversationId}` | GET | `findr-messages` | `findr-cognito-auth` |
| `/translate` | `translate` | POST | `findr-translate` | None |

> **Type the braces literally** — `{id}` and `{conversationId}`, including the curly
> brackets. That's how API Gateway marks a path parameter. The names must match
> exactly, because the Lambda code reads `pathParameters["id"]` and
> `pathParameters["conversationId"]`.

📸 `28-api-resource-tree.png` — the full tree in the left panel
📸 `29-api-method-with-auth.png` — the POST /reports method showing the Cognito authorizer

---

## Step 14 — Enable CORS

Your website is served from an S3 domain and the API lives on an
`execute-api` domain. Different origins, so the browser blocks requests unless
the API explicitly permits them.

**For each of these resources:** `/reports`, `/reports/{id}`, `/images/upload-url`,
`/images/analyse`, `/match`, `/messages`, `/messages/{conversationId}`, `/translate`

1. Select the resource → **Enable CORS**
2. Tick **Default 4XX** and **Default 5XX** gateway responses
3. Tick every method shown for that resource, plus **OPTIONS**
4. **Access-Control-Allow-Headers:** leave the default — it must include
   `Authorization` and `Content-Type`
5. **Access-Control-Allow-Origin:** `*` for now
6. **Save**

📸 `30-cors-enabled.png` — the CORS settings on `/reports`

> **Why `*` for now and not later:** we tighten this to your CloudFront domain on
> Wednesday. Do it now and you'll be debugging CORS errors on a domain that doesn't
> exist yet. Do mention the tightening in your report — going from `*` to a specific
> origin is a textbook least-privilege improvement and it's cheap marks.
>
> **Why the 4XX/5XX boxes matter:** without them, error responses come back
> *without* CORS headers, so the browser hides the real error and shows a confusing
> CORS message instead. You end up debugging the wrong problem entirely.

---

## Step 15 — Deploy the API

Nothing you've built is live until you deploy. This catches everyone at least once.

1. Top right → **Deploy API**
2. **Stage:** *New stage*
3. **Stage name:** `prod`
4. **Deploy**
5. **Copy the Invoke URL.** It looks like:
   `https://abc123xyz.execute-api.ap-southeast-2.amazonaws.com/prod`

**Send me that URL** — it goes straight into the frontend config.

📸 `31-api-deployed-invoke-url.png` — the stage page showing the Invoke URL

> **Remember this for the rest of the week:** any change to a resource, method, or
> CORS setting requires a fresh **Deploy API** before it takes effect. Symptom of
> forgetting: you fix something, and the old behaviour stubbornly persists.

---

## Step 16 — Test it

### Test 1 — list reports (open route)

Paste your Invoke URL + `/reports` straight into a browser tab:

```
https://YOUR-API-ID.execute-api.ap-southeast-2.amazonaws.com/prod/reports
```

**Expected:** `{"success": true, "reports": [], "total": 0}`

That single response proves the whole chain works: API Gateway → Lambda →
DynamoDB → back again.

### Test 2 — translate (open route)

Open a terminal (PowerShell is fine):

```powershell
curl -X POST "https://YOUR-API-ID.execute-api.ap-southeast-2.amazonaws.com/prod/translate" -H "Content-Type: application/json" -d "{\"text\":\"Blue water bottle found at the library\",\"target\":\"zh\"}"
```

**Expected:** JSON containing Chinese text. That's Amazon Translate working.

### Test 3 — protected route rejects anonymous callers

```
https://YOUR-API-ID.execute-api.ap-southeast-2.amazonaws.com/prod/messages
```

**Expected:** `{"message":"Unauthorized"}` with status 401.

This is a **pass**, not a failure — it proves the Cognito authorizer is doing its
job. Screenshot it; it's excellent evidence for the security section.

📸 `32-api-test-reports.png` — the `/reports` response in the browser
📸 `33-api-test-translate.png` — the translate response
📸 `34-api-test-unauthorized.png` — the 401 on `/messages`

### If a test fails

| Symptom | Likely cause |
|---|---|
| `{"message":"Missing Authentication Token"}` | Wrong path, or you forgot to Deploy |
| `Internal server error` | Lambda proxy integration not ticked, or the function errored — check CloudWatch |
| `{"message":"Unauthorized"}` on an open route | Authorizer attached where it shouldn't be |
| CORS error in browser console | Enable CORS not run on that resource, or not redeployed |

**Reading the logs:** Lambda → the function → **Monitor** → **View CloudWatch logs**
→ newest log stream. Every function prints its errors there. This is also a good
screenshot for the CloudWatch part of your report — `35-cloudwatch-logs.png`.

---

## ✅ Part B completion checklist

- [ ] Bedrock model access checked; model ID noted
- [ ] All 5 API Lambdas created with `findr-lambda-role`
- [ ] Memory and timeout set on each
- [ ] Environment variables set on all 4 that need them
- [ ] `findr-presignup` created and attached to Cognito
- [ ] `findr-reports` test event returns 200
- [ ] `findr-api` REST API created
- [ ] Cognito authorizer created
- [ ] All 13 methods created, all with Lambda proxy ticked
- [ ] CORS enabled on all 8 resources
- [ ] Deployed to `prod`
- [ ] **Invoke URL:** `____________________________________`
- [ ] `/reports` returns `{"success": true, ...}`
- [ ] `/translate` returns Chinese
- [ ] `/messages` returns 401
- [ ] Screenshots 18–35 saved

Send me the **Invoke URL** and I'll rewire the frontend to it.
