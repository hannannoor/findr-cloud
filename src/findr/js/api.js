/* ===== FINDR — real AWS api layer =====
   part 1 was all fake data in this file. now every function below actually
   talks to api gateway -> lambda -> dynamodb/s3/rekognition/bedrock.

   the function names are all the same as part 1 on purpose, so the page
   scripts didn't need rewriting.
*/

// ===== config =====
const API_BASE_URL = "https://gc6g5y25da.execute-api.ap-southeast-2.amazonaws.com/prod";
const COGNITO_REGION = "ap-southeast-2";
const COGNITO_CLIENT_ID = "16jogn83v7hms86hgjkk6v00mp";
const COGNITO_URL = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;

// amazon location service, used by the map page and the pin drop on the report form
const LOCATION_API_KEY = "REPLACE_WITH_AWS_LOCATION_API_KEY";
const LOCATION_REGION = "ap-southeast-2";
const LOCATION_STYLE = "Standard";     // Standard | Monochrome | Hybrid | Satellite
const LOCATION_COLOR = "Light";        // Light | Dark

const MAP_STYLE_URL =
    `https://maps.geo.${LOCATION_REGION}.amazonaws.com/v2/styles/${LOCATION_STYLE}/descriptor` +
    `?key=${LOCATION_API_KEY}&color-scheme=${LOCATION_COLOR}`;

const SESSION_KEY = "findr_session";

// pages you can't see unless you're logged in
const PROTECTED_PAGES = ["my-reports.html", "messages.html", "report-lost.html", "report-found.html", "admin.html", "account.html"];


/* ================= html escaping =================
   every string below that came from the server or another user gets run
   through this before it goes into innerHTML. without it a report titled
   with an <img onerror=...> payload executes for everyone who loads the
   page, and localStorage (including the cognito tokens) is readable from it */
function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
}


/* ================= session ================= */

function getSession() {
    try {
        const s = JSON.parse(localStorage.getItem(SESSION_KEY));
        if (!s || !s.idToken) return null;
        // tokens last an hour, after that cognito rejects them anyway
        if (s.expiresAt && Date.now() > s.expiresAt) {
            localStorage.removeItem(SESSION_KEY);
            return null;
        }
        return s;
    } catch (e) {
        return null;
    }
}

function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
}

function saveSession(session) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* ignore */ }
}

// the id token is a jwt, middle chunk is base64 json with the user's details
function decodeToken(idToken) {
    try {
        const payload = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(decodeURIComponent(escape(atob(payload))));
    } catch (e) {
        return {};
    }
}

// page scripts still reference DEMO_USER from part 1, now it's the real user
const DEMO_USER = getSession() || { id: "", name: "Guest", email: "", role: "user" };

// kick anyone not logged in off the protected pages
document.addEventListener("DOMContentLoaded", () => {
    const page = window.location.pathname.split("/").pop();
    if (PROTECTED_PAGES.includes(page) && !getSession()) {
        window.location.href = "login.html?next=" + encodeURIComponent(page);
    }
});


/* ================= http helpers ================= */

async function apiFetch(path, options = {}) {
    const session = getSession();
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };

    // api gateway's cognito authorizer checks this header before lambda even runs
    if (session && session.idToken) headers["Authorization"] = session.idToken;

    let response;
    try {
        response = await fetch(API_BASE_URL + path, { ...options, headers });
    } catch (e) {
        console.error("Network error:", e);
        return { success: false, message: "Can't reach the server. Check your connection." };
    }

    // token expired mid-session
    if (response.status === 401) {
        clearSession();
        return { success: false, message: "Your session expired. Please log in again.", expired: true };
    }

    let data;
    try {
        data = await response.json();
    } catch (e) {
        return { success: false, message: "Server returned something unreadable." };
    }

    // if a method has "lambda proxy integration" unticked in api gateway, the
    // entire lambda return dict arrives as the body instead of just the body
    // field. unwrap it so one missed checkbox doesn't break the page
    if (data && typeof data.statusCode === "number" && typeof data.body === "string") {
        console.warn(`${path} came back unwrapped - lambda proxy integration is probably off for this method`);
        try {
            data = JSON.parse(data.body);
        } catch (e) {
            return { success: false, message: "Server returned something unreadable." };
        }
    }

    if (!response.ok && data.success === undefined) {
        return { success: false, message: data.message || `Request failed (${response.status}).` };
    }

    // never let a toast say "undefined" - if the envelope is missing, say so
    if (!data || data.success === undefined) {
        console.error(`Unexpected response shape from ${path}:`, data);
        return { success: false, message: (data && data.message) || "The server sent back an unexpected response." };
    }

    return data;
}

// dynamodb calls it reportId, the whole front end calls it id
function normaliseReport(r) {
    if (!r) return r;
    return { ...r, id: r.reportId || r.id };
}


/* ================= auth (cognito) ================= */

async function cognitoCall(action, body) {
    const response = await fetch(COGNITO_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
        },
        body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
        const err = new Error(data.message || "Authentication failed.");
        err.code = (data.__type || "").split("#").pop();
        throw err;
    }
    return data;
}

async function registerUser(name, email, password) {
    if (!name || !email || !password) {
        return { success: false, message: "All fields are required." };
    }

    try {
        await cognitoCall("SignUp", {
            ClientId: COGNITO_CLIENT_ID,
            Username: email,
            Password: password,
            UserAttributes: [
                { Name: "name", Value: name },
                { Name: "email", Value: email },
            ],
        });
        // cognito emails a 6 digit code, the register page collects it next
        return {
            success: true,
            needsVerification: true,
            message: "Account created. Check your email for a verification code.",
            user: { name, email },
        };
    } catch (e) {
        return { success: false, message: friendlyAuthError(e) };
    }
}

async function loginUser(email, password) {
    if (!email || !password) {
        return { success: false, message: "Email and password are required." };
    }

    try {
        const data = await cognitoCall("InitiateAuth", {
            AuthFlow: "USER_PASSWORD_AUTH",
            ClientId: COGNITO_CLIENT_ID,
            AuthParameters: { USERNAME: email, PASSWORD: password },
        });

        // admins have mfa turned on, so cognito answers with a challenge
        // instead of tokens. the code gets emailed and we finish in respondToMfa
        if (data.ChallengeName) {
            return {
                success: false,
                mfaRequired: true,
                challengeName: data.ChallengeName,
                session: data.Session,
                email: email,
                message: mfaPrompt(data.ChallengeName),
            };
        }

        const result = data.AuthenticationResult;
        if (!result) return { success: false, message: "Login failed. Please try again." };

        return { success: true, message: "Login successful!", user: storeSession(result, email) };
    } catch (e) {
        return { success: false, message: friendlyAuthError(e) };
    }
}

/* ---- email verification ---- */

// cognito emails a 6 digit code on sign up, this confirms it
async function confirmSignUp(email, code) {
    try {
        await cognitoCall("ConfirmSignUp", {
            ClientId: COGNITO_CLIENT_ID,
            Username: email,
            ConfirmationCode: String(code).trim(),
        });
        return { success: true, message: "Email verified! You can log in now." };
    } catch (e) {
        return { success: false, message: friendlyAuthError(e) };
    }
}

async function resendCode(email) {
    try {
        await cognitoCall("ResendConfirmationCode", {
            ClientId: COGNITO_CLIENT_ID,
            Username: email,
        });
        return { success: true, message: "New code sent — check your inbox." };
    } catch (e) {
        return { success: false, message: friendlyAuthError(e) };
    }
}


/* ---- forgotten password ---- */

// cognito deliberately doesn't tell you whether the address exists, so this
// looks identical either way. that's on purpose, it stops people fishing for
// which emails are registered
async function forgotPassword(email) {
    try {
        await cognitoCall("ForgotPassword", {
            ClientId: COGNITO_CLIENT_ID,
            Username: email,
        });
        return { success: true, message: "If that email is registered, a reset code is on its way." };
    } catch (e) {
        if (e.code === "UserNotFoundException") {
            return { success: true, message: "If that email is registered, a reset code is on its way." };
        }
        return { success: false, message: friendlyAuthError(e) };
    }
}

async function resetPassword(email, code, newPassword) {
    try {
        await cognitoCall("ConfirmForgotPassword", {
            ClientId: COGNITO_CLIENT_ID,
            Username: email,
            ConfirmationCode: String(code).trim(),
            Password: newPassword,
        });
        return { success: true, message: "Password changed. Log in with your new one." };
    } catch (e) {
        return { success: false, message: friendlyAuthError(e) };
    }
}


/* ---- account settings (needs to be logged in) ---- */

// these use the ACCESS token, not the id token. the id token says who you are,
// the access token is what authorises changes to your own account
async function changePassword(currentPassword, newPassword) {
    const session = getSession();
    if (!session) return { success: false, message: "You must be signed in." };

    try {
        await cognitoCall("ChangePassword", {
            AccessToken: session.accessToken,
            PreviousPassword: currentPassword,
            ProposedPassword: newPassword,
        });
        return { success: true, message: "Password updated." };
    } catch (e) {
        return { success: false, message: friendlyAuthError(e) };
    }
}

async function updateDisplayName(name) {
    const session = getSession();
    if (!session) return { success: false, message: "You must be signed in." };

    const clean = String(name).trim();
    if (clean.length < 2) return { success: false, message: "Please enter your name." };

    try {
        await cognitoCall("UpdateUserAttributes", {
            AccessToken: session.accessToken,
            UserAttributes: [{ Name: "name", Value: clean }],
        });

        // the stored id token still carries the old name until the next login,
        // so patch the local session too and the navbar updates straight away
        session.name = clean;
        saveSession(session);

        return { success: true, message: "Name updated.", name: clean };
    } catch (e) {
        return { success: false, message: friendlyAuthError(e) };
    }
}

// pulls attributes straight from cognito, so email_verified is current rather
// than whatever the token said when it was issued
async function getAccount() {
    const session = getSession();
    if (!session) return { success: false, message: "You must be signed in." };

    try {
        const data = await cognitoCall("GetUser", { AccessToken: session.accessToken });
        const attrs = {};
        (data.UserAttributes || []).forEach(a => { attrs[a.Name] = a.Value; });
        return {
            success: true,
            name: attrs.name || session.name,
            email: attrs.email || session.email,
            emailVerified: attrs.email_verified === "true",
        };
    } catch (e) {
        return { success: false, message: friendlyAuthError(e) };
    }
}


function mfaPrompt(challenge) {
    if (challenge === "EMAIL_OTP") return "We've emailed you a verification code.";
    if (challenge === "SMS_MFA") return "We've texted you a verification code.";
    if (challenge === "SOFTWARE_TOKEN_MFA") return "Enter the code from your authenticator app.";
    return "Additional verification required.";
}

// turns a cognito AuthenticationResult into our stored session
function storeSession(result, fallbackEmail) {
    const claims = decodeToken(result.IdToken);
    const groups = claims["cognito:groups"] || [];
    const session = {
        id: claims.sub,
        name: claims.name || claims.email || "User",
        email: claims.email || fallbackEmail,
        role: groups.includes("admin") ? "admin" : "user",
        idToken: result.IdToken,
        accessToken: result.AccessToken,
        expiresAt: Date.now() + (result.ExpiresIn || 3600) * 1000,
    };
    saveSession(session);
    return session;
}

// second half of an mfa login - send back the code cognito emailed
async function respondToMfa(email, code, session, challengeName) {
    const answerKey = {
        EMAIL_OTP: "EMAIL_OTP_CODE",
        SMS_MFA: "SMS_MFA_CODE",
        SOFTWARE_TOKEN_MFA: "SOFTWARE_TOKEN_MFA_CODE",
    }[challengeName] || "EMAIL_OTP_CODE";

    try {
        const data = await cognitoCall("RespondToAuthChallenge", {
            ClientId: COGNITO_CLIENT_ID,
            ChallengeName: challengeName,
            Session: session,
            ChallengeResponses: {
                USERNAME: email,
                [answerKey]: String(code).trim(),
            },
        });

        const result = data.AuthenticationResult;
        if (!result) return { success: false, message: "Verification failed. Please try again." };

        return { success: true, message: "Verified — logging you in.", user: storeSession(result, email) };
    } catch (e) {
        return { success: false, message: friendlyAuthError(e) };
    }
}


function friendlyAuthError(e) {
    const map = {
        UsernameExistsException: "An account with this email already exists.",
        NotAuthorizedException: "Incorrect email or password.",
        UserNotFoundException: "Incorrect email or password.",
        InvalidPasswordException: "Password doesn't meet the requirements — try a longer one with a number and a capital letter.",
        InvalidParameterException: "Please check your details and try again.",
        UserNotConfirmedException: "Please verify your email address first.",
        CodeMismatchException: "That code isn't right — check it and try again.",
        ExpiredCodeException: "That code has expired. Request a new one.",
        AliasExistsException: "That email is already verified on another account.",
        TooManyRequestsException: "Too many attempts. Wait a moment and try again.",
        LimitExceededException: "Too many attempts. Wait a moment and try again.",
    };
    return map[e.code] || e.message || "Something went wrong. Please try again.";
}

function logout() {
    clearSession();
    window.location.href = "index.html";
}


/* ================= reports (crud) ================= */

async function getReports(filters = {}) {
    const params = new URLSearchParams();
    if (filters.type) params.append("type", filters.type);
    if (filters.category) params.append("category", filters.category);
    if (filters.status) params.append("status", filters.status);
    if (filters.search) params.append("search", filters.search);

    const qs = params.toString();
    const data = await apiFetch("/reports" + (qs ? "?" + qs : ""));

    if (data.success && data.reports) {
        data.reports = data.reports.map(normaliseReport);
    }
    return data;
}

/* /reports is public, so the lambda can't tell the caller owns a row and
   never returns secretDetails there. this route has the cognito authorizer on
   it, so the owner gets their own private details back for the edit form */
async function getMyReports() {
    const data = await apiFetch("/reports/mine");
    if (data.success && data.reports) {
        data.reports = data.reports.map(normaliseReport);
    }
    return data;
}

async function getReportById(reportId) {
    const data = await apiFetch(`/reports/${encodeURIComponent(reportId)}`);
    if (data.success && data.report) data.report = normaliseReport(data.report);
    return data;
}

async function submitReport(reportData) {
    const body = {
        type: reportData.type,
        title: reportData.title,
        description: reportData.description,
        category: reportData.category,
        location: reportData.location,
        date: reportData.date,
        rekognitionLabels: reportData.rekognitionLabels || [],
        detectedText: lastDetectedText,
        // whatever image they analysed just before submitting
        imageKey: reportData.imageKey || lastUploadedKey || "",
    };
    if (reportData.lat != null) body.lat = reportData.lat;
    if (reportData.lng != null) body.lng = reportData.lng;
    if (reportData.secretDetails) body.secretDetails = reportData.secretDetails;

    const data = await apiFetch("/reports", { method: "POST", body: JSON.stringify(body) });

    if (data.success && data.report) {
        data.report = normaliseReport(data.report);
        lastUploadedKey = null;
        lastDetectedText = [];
    }
    return data;
}

async function updateReport(reportId, fields) {
    const data = await apiFetch(`/reports/${encodeURIComponent(reportId)}`, {
        method: "PUT",
        body: JSON.stringify(fields),
    });
    if (data.success && data.report) data.report = normaliseReport(data.report);
    return data;
}

async function updateReportStatus(reportId, newStatus) {
    return await updateReport(reportId, { status: newStatus });
}

async function deleteReport(reportId) {
    return await apiFetch(`/reports/${encodeURIComponent(reportId)}`, { method: "DELETE" });
}


/* ================= images: s3 upload + rekognition ================= */

let lastUploadedKey = null;
let lastDetectedText = [];

/* three steps:
   1. ask lambda for a presigned url
   2. PUT the file straight to s3 with it (never goes through our backend)
   3. tell lambda to run rekognition on the object it just landed in
*/
async function analyseImage(imageFile) {
    if (!imageFile) return { success: false, message: "No image selected." };

    if (imageFile.size > 5 * 1024 * 1024) {
        return { success: false, message: "Image is too large — please use one under 5MB." };
    }

    const presign = await apiFetch("/images/upload-url", {
        method: "POST",
        body: JSON.stringify({ contentType: imageFile.type, fileName: imageFile.name }),
    });
    if (!presign.success) return presign;

    try {
        const put = await fetch(presign.uploadUrl, {
            method: "PUT",
            body: imageFile,
            headers: { "Content-Type": imageFile.type },
        });
        if (!put.ok) throw new Error("S3 rejected the upload (" + put.status + ")");
    } catch (e) {
        console.error("Upload failed:", e);
        return { success: false, message: "Couldn't upload the image. Please try again." };
    }

    const result = await apiFetch("/images/analyse", {
        method: "POST",
        body: JSON.stringify({ key: presign.key }),
    });

    if (result.success) {
        lastUploadedKey = presign.key;
        lastDetectedText = result.detectedText || [];
    }
    return result;
}


/* ================= ai matching ================= */

/* part 1 did this in the browser with exact label overlap, so "silver flask"
   never matched "metal water bottle". now a lambda shortlists on labels then
   bedrock re-ranks on what the words actually mean.
   note this is async now — callers need to await it */
async function findMatches(labels, extra = {}) {
    const data = await apiFetch("/match", {
        method: "POST",
        body: JSON.stringify({
            type: extra.type || "lost",
            title: extra.title || "",
            description: extra.description || "",
            category: extra.category || "",
            location: extra.location || "",
            labels: labels || [],
        }),
    });

    if (!data.success) return [];

    // reshape to what the match cards already expect
    return (data.matches || []).map(m => ({
        report: normaliseReport(m.report),
        percent: m.score,
        reason: m.reason || "",
    }));
}


/* ================= ownership verification ================= */

/* claiming a found item: bedrock builds questions from the private details the
   finder recorded, then marks the answers against them. those details never
   reach the browser, so reading the listing isn't enough to pass */

async function verifyStart(reportId) {
    return await apiFetch("/verify/start", {
        method: "POST",
        body: JSON.stringify({ reportId }),
    });
}

async function verifyQuestions(reportId) {
    return await apiFetch("/verify/questions", {
        method: "POST",
        body: JSON.stringify({ reportId }),
    });
}

async function verifyAnswers(reportId, questions, answers) {
    return await apiFetch("/verify/answers", {
        method: "POST",
        body: JSON.stringify({ reportId, questions, answers }),
    });
}


/* ================= translate ================= */

async function translateReport(title, text, target, extras = []) {
    return await apiFetch("/translate", {
        method: "POST",
        body: JSON.stringify({ title, text, target, extras }),
    });
}


/* ================= messages ================= */

let cachedConversations = [];

async function getConversations() {
    const data = await apiFetch("/messages");
    if (!data.success) return data;

    // the list endpoint only gives the last message, so pull each thread's
    // messages too. fine at this scale, all in parallel
    const full = await Promise.all(
        (data.conversations || []).map(async (c) => {
            const thread = await apiFetch(`/messages?conversationId=${encodeURIComponent(c.id)}`);
            return { ...c, messages: thread.success ? thread.messages : [] };
        })
    );

    cachedConversations = full;
    return { success: true, conversations: full };
}

async function sendMessage(conversationId, text) {
    // conversation id is "userA#userB#reportId", so we can work out
    // who we're talking to without another lookup
    const parts = String(conversationId).split("#");
    const me = getSession();
    if (!me) return { success: false, message: "You must be signed in." };

    const otherUserId = parts.find(p => p !== me.id && p !== parts[2]) || parts[0];
    const reportId = parts[2] || "";

    const cached = cachedConversations.find(c => c.id === conversationId);

    const data = await apiFetch("/messages", {
        method: "POST",
        body: JSON.stringify({
            toUserId: otherUserId,
            toName: cached ? cached.otherUser.name : "User",
            reportId: reportId,
            reportTitle: cached ? cached.reportTitle : "",
            text: text,
        }),
    });

    // push it into the cached thread so the page can re-render straight away
    if (data.success && cached) {
        cached.messages.push(data.sent);
        cached.lastMessage = text;
        cached.lastMessageTime = data.sent.time;
    }
    return data;
}

// start a brand new conversation from an item page
async function startConversation(toUserId, toName, reportId, reportTitle, text) {
    return await apiFetch("/messages", {
        method: "POST",
        body: JSON.stringify({ toUserId, toName, reportId, reportTitle, text }),
    });
}


/* ================= ui helpers (unchanged from part 1) ================= */

function showToast(message, type = "success") {
    let container = document.querySelector(".toast-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    const ic = (typeof icon === "function") ? icon(type === "success" ? "check" : "alert") : "";
    toast.innerHTML = `${ic}<span>${esc(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(120%)";
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
}

function timeAgo(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return "Just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    if (diff < 604800) return Math.floor(diff / 86400) + "d ago";
    return formatDate(dateStr);
}

function getStatusBadge(status) {
    const cls = String(status || "Open").toLowerCase().replace(/[^a-z]/g, "");
    return `<span class="badge badge-${cls}"><span class="dot"></span>${esc(status)}</span>`;
}

function getTypeBadge(type) {
    const safe = String(type || "").toLowerCase().replace(/[^a-z]/g, "");
    const label = safe.charAt(0).toUpperCase() + safe.slice(1);
    return `<span class="badge badge-${safe}"><span class="dot"></span>${esc(label)}</span>`;
}

function zoneOf(location) {
    const l = (location || "").toLowerCase();
    if (l.includes("library")) return "library";
    if (l.includes("canteen")) return "canteen";
    if (l.includes("lecture")) return "lecture";
    if (l.includes("study")) return "study";
    if (l.includes("sports")) return "sports";
    if (l.includes("bus") || l.includes("gate")) return "gate";
    return "other";
}

function reportCardHTML(report) {
    const labels = (report.rekognitionLabels || []).slice(0, 3)
        .map(l => `<span class="chip">${(typeof icon === "function") ? icon("tag") : ""}${esc(l)}</span>`).join("");
    const pinIco = (typeof icon === "function") ? icon("pin") : "";
    const calIco = (typeof icon === "function") ? icon("calendar") : "";
    return `
        <a href="item-details.html?id=${encodeURIComponent(report.id)}" class="card fade-up">
            <div class="card-media">
                <img src="${esc(report.imageUrl)}" alt="${esc(report.title)}"
                     onerror="this.src='https://placehold.co/400x300/eef3f8/94a3b8?text=No+Image'">
                <span class="type-flag">${getTypeBadge(report.type)}</span>
                <span class="status-flag">${getStatusBadge(report.status)}</span>
            </div>
            <div class="card-body">
                <h4 class="card-title">${esc(report.title)}</h4>
                <p class="card-text">${esc(report.description)}</p>
                <div class="card-meta">
                    <span>${pinIco} ${esc(report.location)}</span>
                    <span>${calIco} ${formatDate(report.date)}</span>
                </div>
                <div class="card-labels">${labels}</div>
            </div>
        </a>`;
}

// mobile menu toggle
document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.querySelector(".menu-toggle");
    if (toggle) {
        toggle.addEventListener("click", () => {
            document.querySelector(".navbar-links")?.classList.toggle("open");
            document.querySelector(".navbar-auth")?.classList.toggle("open");
        });
    }
});
