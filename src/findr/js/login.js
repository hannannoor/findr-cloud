/* ===== findr — Login =====
   normal accounts get tokens straight back. accounts with mfa turned on
   (we use it for admins) get a challenge instead, and cognito emails a code
   that has to come back before any token is issued
*/

let pendingMfa = null;   // { email, session, challengeName }

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("login-form");
    if (form) form.addEventListener("submit", handleLogin);

    const mfaForm = document.getElementById("mfa-form");
    if (mfaForm) mfaForm.addEventListener("submit", handleMfa);

    const cancel = document.getElementById("mfa-cancel");
    if (cancel) cancel.addEventListener("click", resetToLogin);
});

function alertBox(type, message) {
    const box = document.getElementById("login-alert") || document.getElementById("page-alert");
    if (!box) return;
    box.className = `alert alert-${type}`;
    box.innerHTML = icon(type === "success" ? "check" : "alert") + `<span>${esc(message)}</span>`;
    box.style.display = "flex";
}

async function handleLogin(e) {
    e.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const btn = document.getElementById("login-btn");
    const box = document.getElementById("login-alert");

    btn.textContent = "Logging in...";
    btn.disabled = true;
    if (box) box.style.display = "none";

    const result = await loginUser(email, password);

    if (result.success) {
        showToast("Welcome back, " + result.user.name + "!");
        setTimeout(() => { window.location.href = nextPage(); }, 700);
        return;
    }

    // mfa: swap the form for the code entry step
    if (result.mfaRequired) {
        pendingMfa = {
            email: result.email,
            session: result.session,
            challengeName: result.challengeName,
        };
        showMfaStep(result.message, result.challengeName);
        return;
    }

    // signed up but never entered the verification code
    if (/verify your email/i.test(result.message)) {
        showToast("Please verify your email first.", "error");
        setTimeout(() => {
            window.location.href = "verify-email.html?email=" + encodeURIComponent(email);
        }, 1200);
        return;
    }

    alertBox("error", result.message);
    btn.textContent = "Log In";
    btn.disabled = false;
}

function showMfaStep(message, challengeName) {
    document.getElementById("login-form").style.display = "none";
    document.getElementById("mfa-form").style.display = "block";

    document.getElementById("mfa-sub").textContent = message;
    document.getElementById("mfa-hint").textContent =
        challengeName === "SOFTWARE_TOKEN_MFA"
            ? "Open your authenticator app and enter the current code."
            : "Enter the code we just sent you. It expires in a few minutes.";

    document.getElementById("mfa-code").focus();
    alertBox("success", message);
}

function resetToLogin() {
    pendingMfa = null;
    document.getElementById("mfa-form").style.display = "none";
    document.getElementById("login-form").style.display = "block";
    document.getElementById("mfa-code").value = "";
    document.getElementById("password").value = "";

    const btn = document.getElementById("login-btn");
    btn.textContent = "Log In";
    btn.disabled = false;

    const box = document.getElementById("login-alert");
    if (box) box.style.display = "none";
}

async function handleMfa(e) {
    e.preventDefault();
    if (!pendingMfa) return resetToLogin();

    const code = document.getElementById("mfa-code").value.trim();
    const btn = document.getElementById("mfa-btn");

    btn.textContent = "Verifying...";
    btn.disabled = true;

    const result = await respondToMfa(
        pendingMfa.email, code, pendingMfa.session, pendingMfa.challengeName
    );

    if (result.success) {
        showToast("Welcome back, " + result.user.name + "!");
        setTimeout(() => { window.location.href = nextPage(); }, 700);
        return;
    }

    alertBox("error", result.message);
    btn.textContent = "Verify and log in";
    btn.disabled = false;

    // an expired session means starting the login over, not retrying the code
    if (/session|expired/i.test(result.message)) {
        setTimeout(resetToLogin, 1800);
    }
}

/* api.js sends people here as login.html?next=my-reports.html when they click
   a protected page while logged out. this reads it back so they land where
   they were going, and ignores anything that isn't one of our own pages */
function nextPage() {
    const n = new URLSearchParams(location.search).get("next");
    return (n && /^[a-z0-9-]+\.html$/i.test(n)) ? n : "index.html";
}
