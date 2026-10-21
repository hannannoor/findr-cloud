# Findr — Part H: Email MFA for admin logins (Amazon SES)

Cognito refuses to send MFA codes through its default email sender. The error you saw:

> *Can't enable email MFA with email sending in Send email with Cognito configuration.*

is Cognito saying **"give me SES first."** The default sender is rate-limited to 50 emails a
day and isn't considered reliable enough for a security factor, so AWS blocks it.

Fixing it takes about 10 minutes and adds **Amazon SES** to your service list — which is
worth marks on its own, so this is not wasted effort.

---

## Step 43 — Verify an email identity in SES

SES starts every new account in the **sandbox**, where you can only send *to* addresses
you've proved you own. For this project that's fine — you're only emailing yourself.

1. Console → **Amazon SES** (make sure you're in **ap-southeast-2**, same region as the pool)
2. Left menu → **Identities** → **Create identity**
3. Identity type: **Email address**
4. Email address: your own real inbox (the one on your admin Cognito account)
5. **Create identity**
6. Check that inbox → click the AWS verification link
7. Back in SES, the identity should now show **Verified** ✅

📸 `85-ses-verified-identity.png`

> If you want the code to arrive at a *different* address than the sender, verify that one
> too. In the sandbox both ends must be verified. One address doing both jobs is simplest.

---

## Step 44 — Point the user pool at SES

1. **Cognito** → your user pool → **Messaging** tab (older console: **Message templates**)
2. Find **Email** → **Edit**
3. Email provider: **Send email with Amazon SES**
4. SES Region: **ap-southeast-2**
5. FROM email address: pick the identity you just verified
6. FROM sender name: `Findr`
7. Reply-to: same address
8. Configuration set: leave blank
9. **Save changes**

📸 `86-cognito-ses-email.png`

> This also upgrades your **sign-up verification emails** and **password reset codes** to go
> through SES instead of the 50/day default. Mention that in the report — one config change
> improved three flows.

---

## Step 45 — Now enable MFA

1. **Cognito** → your pool → **Sign-in** tab → **Multi-factor authentication** → **Edit**
2. MFA enforcement: **Optional MFA** ← important
3. MFA methods: tick **Email message**
4. **Save changes**

The error should be gone now.

📸 `87-cognito-mfa-email.png`

### Why Optional and not Required

Required MFA would force *every* student to set up a second factor to report a lost water
bottle — bad UX for zero security benefit. Optional means MFA is off by default, and you
turn it on **per user**, so only admin accounts carry it. That's the actual design decision
worth writing up: **the strength of the auth is proportional to the blast radius of the
account.**

---

## Step 46 — Turn MFA on for your admin account only

1. **Cognito** → your pool → **Users** → click your admin account
2. **Multi-factor authentication (MFA)** section → **Edit** (or **Set preference**)
3. Tick **Email message** → **Save**

📸 `88-admin-mfa-enabled.png`

Do **not** do this for your normal test account — you want to be able to demo both paths in
the video: normal user logs straight in, admin gets challenged.

---

## Step 47 — Test it

1. Log out completely
2. Log in as your **normal** account → straight through, no code. ✅
3. Log out, log in as your **admin** account →
   - Cognito replies with a challenge instead of tokens
   - The login page swaps to the code panel with the ✉️ badge
   - A 6-digit code lands in your inbox
   - Enter it → you're in, and **Admin** appears in the navbar

📸 `89-mfa-code-prompt.png` — the code entry screen
📸 `90-mfa-email.png` — the email with the code (blur the code itself)

### If it doesn't work

| Symptom | Cause |
|---|---|
| Still logs straight in as admin | MFA preference not set on that specific user (Step 46) |
| "Email MFA is not available" | Pool is on the **Lite** feature plan — email MFA needs **Essentials**. Pool → **Settings**/overview → upgrade the feature plan, or fall back to Authenticator apps |
| No email arrives | SES identity not verified, or wrong region in Step 44 |
| Code rejected | Codes expire in ~3 min — hit resend |

---

## No code changes needed

`api.js` already handles this. `login()` checks for a challenge instead of tokens:

```javascript
if (data.ChallengeName) {
    return { success: false, mfaRequired: true, challengeName: data.ChallengeName,
             session: data.Session, email: email, message: mfaPrompt(data.ChallengeName) };
}
```

and `respondToMfa()` maps the challenge name to the right response key —
`EMAIL_OTP` → `EMAIL_OTP_CODE`, `SMS_MFA` → `SMS_MFA_CODE`,
`SOFTWARE_TOKEN_MFA` → `SOFTWARE_TOKEN_MFA_CODE`. So whichever method you end up on, the
frontend behaves identically. That's deliberate and worth one line in the report.

---

## Fallback: Authenticator apps (if SES gives you trouble)

If SES fights you or the feature plan blocks email MFA, tick **Authenticator apps** in
Step 45 instead. Everything else is identical, except:

- First admin login shows a QR code to scan with Google Authenticator / Microsoft Authenticator
- Codes come from the phone app instead of email

It's arguably *stronger* security (no email interception) and costs nothing to set up. The
only reason to prefer email is that you wanted the email code specifically.

---

## Cost

SES: **62,000 emails/month free** when sent from Lambda/EC2, otherwise $0.10 per 1,000.
You'll send maybe 30 emails across this whole project. Effectively free.

---

## ⏰ Where you actually are

It's **Thursday**. Code zip is due **Friday 1700**. Report and slides are due **Monday 0900**
and both are still at **zero** — that's 30% of the subject sitting untouched.

After this MFA step, stop building. The remaining list:

1. Deploy the four pending Lambdas (`findr-images`, `findr-reports`, `findr-verify`, `findr-messages`)
2. Repaste the trimmed IAM policy, delete `/verify/face` + `/verify/upload-url`, Deploy API
3. Remove the `findr-presignup` trigger, create the `admin` group, delete `findr-users`
4. Upload frontend to S3, invalidate CloudFront `/*`
5. Screenshots + phone check
6. **Zip and submit**
7. **Report + slides + video**
