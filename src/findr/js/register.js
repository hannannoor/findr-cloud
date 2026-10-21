/* ===== findr — Register page: cognito sign up + email confirmation ===== */

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("register-form");
    if (form) form.addEventListener("submit", handleRegister);
});

async function handleRegister(e) {
    e.preventDefault();

    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirm-password").value;
    const btn = document.getElementById("register-btn");
    const alertBox = document.getElementById("register-alert");
    const confirmGroup = document.getElementById("confirm-password").parentElement;

    alertBox.style.display = "none";
    confirmGroup.classList.remove("error");

    if (password !== confirmPassword) {
        confirmGroup.classList.add("error");
        return;
    }

    btn.textContent = "Creating account...";
    btn.disabled = true;

    const result = await registerUser(name, email, password);

    if (result.success) {
        alertBox.className = "alert alert-success";
        alertBox.innerHTML = icon("check") + "<span>Account created! Check your email for a verification code…</span>";
        alertBox.style.display = "flex";
        showToast("Verification code sent to your email");
        // carry the address across so they don't have to type it again
        setTimeout(() => {
            window.location.href = "verify-email.html?email=" + encodeURIComponent(email);
        }, 1500);
    } else {
        alertBox.className = "alert alert-error";
        alertBox.innerHTML = icon("alert") + "<span>" + result.message + "</span>";
        alertBox.style.display = "flex";
        btn.textContent = "Create Account";
        btn.disabled = false;
    }
}
