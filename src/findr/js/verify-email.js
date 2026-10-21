/* findr — verify email
   cognito emails a 6 digit code on sign up. nothing works until it's entered,
   which is the point - it proves the address is real and reachable
*/

document.addEventListener("DOMContentLoaded", () => {
    // register.html sends the address across so they don't retype it
    const params = new URLSearchParams(window.location.search);
    const email = params.get("email");
    if (email) {
        document.getElementById("email").value = email;
        document.getElementById("code").focus();
    }

    document.getElementById("verify-form").addEventListener("submit", handleVerify);
    document.getElementById("resend-btn").addEventListener("click", handleResend);
});

function alertBox(type, message) {
    const box = document.getElementById("page-alert");
    box.className = `alert alert-${type}`;
    box.innerHTML = icon(type === "success" ? "check" : "alert") + `<span>${esc(message)}</span>`;
    box.style.display = "flex";
}

async function handleVerify(e) {
    e.preventDefault();

    const email = document.getElementById("email").value.trim();
    const code = document.getElementById("code").value.trim();
    const btn = document.getElementById("verify-btn");

    btn.disabled = true;
    btn.textContent = "Verifying…";

    const result = await confirmSignUp(email, code);

    if (result.success) {
        alertBox("success", "Email verified! Taking you to the login page…");
        showToast("Email verified!");
        setTimeout(() => { window.location.href = "login.html"; }, 1400);
    } else {
        alertBox("error", result.message);
        btn.disabled = false;
        btn.textContent = "Verify email";
    }
}

async function handleResend() {
    const email = document.getElementById("email").value.trim();
    if (!email) {
        alertBox("error", "Enter your email address first.");
        return;
    }

    const btn = document.getElementById("resend-btn");
    btn.disabled = true;
    btn.textContent = "Sending…";

    const result = await resendCode(email);
    alertBox(result.success ? "success" : "error", result.message);

    // cognito rate limits these, so don't let them spam the button
    setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "Didn't get it? Send a new code";
    }, 8000);
}
