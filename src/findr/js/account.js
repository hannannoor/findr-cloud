/* findr — account settings
   name and password changes go straight to cognito with the access token.
   note it's the ACCESS token here, not the id token - the id token says who
   you are, the access token is what authorises changes to your own account
*/

document.addEventListener("DOMContentLoaded", async () => {
    await loadAccount();

    document.getElementById("name-form").addEventListener("submit", handleName);
    document.getElementById("pw-form").addEventListener("submit", handlePassword);
    document.getElementById("signout-btn").addEventListener("click", () => {
        clearSession();
        showToast("Logged out. See you soon!");
        setTimeout(() => { window.location.href = "index.html"; }, 600);
    });
});

function alertIn(id, type, message) {
    const box = document.getElementById(id);
    box.className = `alert alert-${type}`;
    box.innerHTML = icon(type === "success" ? "check" : "alert") + `<span>${esc(message)}</span>`;
    box.style.display = "flex";
}

async function loadAccount() {
    // pulled live from cognito rather than the token, so email_verified is current
    const acct = await getAccount();

    if (!acct.success) {
        showToast(acct.message || "Couldn't load your account.", "error");
        return;
    }

    document.getElementById("acct-avatar").textContent = (acct.name || "?").charAt(0).toUpperCase();
    document.getElementById("acct-name").textContent = acct.name;
    document.getElementById("acct-email").textContent = acct.email;
    document.getElementById("display-name").value = acct.name;

    const badge = document.getElementById("acct-verify");
    badge.className = `acct-verify ${acct.emailVerified ? "ok" : "bad"}`;
    badge.innerHTML = acct.emailVerified
        ? `${ICONS.checkCircle} Email verified`
        : `${ICONS.alert} Email not verified`;
}

async function handleName(e) {
    e.preventDefault();

    const name = document.getElementById("display-name").value.trim();
    const btn = document.getElementById("name-btn");

    btn.disabled = true;
    btn.textContent = "Saving…";

    const result = await updateDisplayName(name);

    btn.disabled = false;
    btn.textContent = "Save name";

    if (result.success) {
        alertIn("name-alert", "success", "Name updated.");
        showToast("Name updated!");
        document.getElementById("acct-name").textContent = result.name;
        document.getElementById("acct-avatar").textContent = result.name.charAt(0).toUpperCase();
        // navbar avatar comes from the session, which updateDisplayName patched
        const navAvatar = document.querySelector(".profile-avatar");
        if (navAvatar) navAvatar.textContent = result.name.charAt(0).toUpperCase();
    } else {
        alertIn("name-alert", "error", result.message);
    }
}

async function handlePassword(e) {
    e.preventDefault();

    const current = document.getElementById("current-password").value;
    const next = document.getElementById("new-password").value;
    const confirm = document.getElementById("confirm-password").value;
    const btn = document.getElementById("pw-btn");

    if (next !== confirm) {
        alertIn("pw-alert", "error", "The two new passwords don't match.");
        return;
    }
    if (next === current) {
        alertIn("pw-alert", "error", "That's the same as your current password.");
        return;
    }

    btn.disabled = true;
    btn.textContent = "Saving…";

    const result = await changePassword(current, next);

    btn.disabled = false;
    btn.textContent = "Change password";

    if (result.success) {
        alertIn("pw-alert", "success", "Password updated.");
        showToast("Password changed!");
        document.getElementById("pw-form").reset();
    } else {
        alertIn("pw-alert", "error", result.message);
    }
}
