/* findr — forgotten password
   two steps on one page: ask for a code, then use it to set a new password
*/

let resetEmail = "";

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("request-form").addEventListener("submit", handleRequest);
    document.getElementById("reset-form").addEventListener("submit", handleReset);
    document.getElementById("resend-btn").addEventListener("click", handleRequestAgain);
});

function alertBox(type, message) {
    const box = document.getElementById("page-alert");
    box.className = `alert alert-${type}`;
    box.innerHTML = icon(type === "success" ? "check" : "alert") + `<span>${esc(message)}</span>`;
    box.style.display = "flex";
}

async function handleRequest(e) {
    e.preventDefault();

    const email = document.getElementById("email").value.trim();
    const btn = document.getElementById("request-btn");

    btn.disabled = true;
    btn.textContent = "Sending…";

    const result = await forgotPassword(email);

    if (result.success) {
        resetEmail = email;
        alertBox("success", result.message);
        // swap to step two
        document.getElementById("request-form").style.display = "none";
        document.getElementById("reset-form").style.display = "block";
        document.getElementById("code").focus();
    } else {
        alertBox("error", result.message);
        btn.disabled = false;
        btn.textContent = "Send reset code";
    }
}

async function handleRequestAgain() {
    if (!resetEmail) return;
    const btn = document.getElementById("resend-btn");
    btn.disabled = true;
    btn.textContent = "Sending…";

    const result = await forgotPassword(resetEmail);
    alertBox(result.success ? "success" : "error", result.message);

    setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "Send another code";
    }, 8000);
}

async function handleReset(e) {
    e.preventDefault();

    const code = document.getElementById("code").value.trim();
    const pw = document.getElementById("new-password").value;
    const confirm = document.getElementById("confirm-password").value;
    const btn = document.getElementById("reset-btn");

    if (pw !== confirm) {
        alertBox("error", "The two passwords don't match.");
        return;
    }

    btn.disabled = true;
    btn.textContent = "Saving…";

    const result = await resetPassword(resetEmail, code, pw);

    if (result.success) {
        alertBox("success", "Password changed. Taking you to the login page…");
        showToast("Password updated!");
        setTimeout(() => { window.location.href = "login.html"; }, 1400);
    } else {
        alertBox("error", result.message);
        btn.disabled = false;
        btn.textContent = "Set new password";
    }
}
