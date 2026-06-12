// Already signed in — check session expiry first
window.auth.onAuthStateChanged(user => {
  if (!user) return;
  const expiry = parseInt(localStorage.getItem("sessionExpiresAt") || "0", 10);
  if (expiry && Date.now() > expiry) {
    window.auth.signOut();
    return;
  }
  window.location.href = "pages/form.html";
});

function setLoading(on) {
  const btn = document.getElementById("loginBtn");
  btn.disabled = on;
  btn.innerHTML = on
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .7s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Signing in…`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg> Sign In`;
}

function showError(msg) {
  const el  = document.getElementById("loginError");
  const txt = document.getElementById("loginErrorMsg");
  txt.textContent = msg;
  el.classList.add("visible");
}

function clearError() {
  document.getElementById("loginError").classList.remove("visible");
}

// ── Session duration modal ────────────────────────────────────────────────────
const SESSION_OPTS = [
  { key: "1d",  label: "1 Day",   ms: 1  * 24 * 60 * 60 * 1000 },
  { key: "7d",  label: "7 Days",  ms: 7  * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "30 Days", ms: 30 * 24 * 60 * 60 * 1000 },
];

function getDefaultDuration() {
  const saved = JSON.parse(localStorage.getItem("agentEvaluationSettingsV1") || "{}");
  return saved.sessionDuration || "7d";
}

function showSessionModal(onConfirm) {
  const defKey = getDefaultDuration();
  document.getElementById("sessionModal").hidden = false;
  document.querySelectorAll(".sess-opt").forEach(btn => {
    btn.classList.toggle("sess-opt-active", btn.dataset.sess === defKey);
  });
  document.getElementById("sessionConfirmBtn").onclick = () => {
    const active = document.querySelector(".sess-opt.sess-opt-active");
    const key = active?.dataset.sess || "7d";
    const opt = SESSION_OPTS.find(o => o.key === key) || SESSION_OPTS[1];
    localStorage.setItem("sessionExpiresAt", String(Date.now() + opt.ms));
    document.getElementById("sessionModal").hidden = true;
    onConfirm();
  };
}

document.querySelectorAll(".sess-opt").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".sess-opt").forEach(b => b.classList.remove("sess-opt-active"));
    btn.classList.add("sess-opt-active");
  });
});

document.getElementById("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const pass  = document.getElementById("loginPass").value;
  if (!email || !pass) { showError("Please enter your email and password."); return; }
  clearError();
  setLoading(true);
  try {
    await window.auth.signInWithEmailAndPassword(email, pass);
    setLoading(false);
    showSessionModal(() => { window.location.href = "pages/form.html"; });
  } catch (err) {
    const msgs = {
      "auth/user-not-found":     "No account found with this email.",
      "auth/wrong-password":     "Incorrect password.",
      "auth/invalid-credential": "Incorrect email or password.",
      "auth/invalid-email":      "Invalid email address.",
      "auth/too-many-requests":  "Too many attempts. Try again later.",
    };
    showError(msgs[err.code] || err.message);
    setLoading(false);
  }
});

document.getElementById("guestBtn").addEventListener("click", async () => {
  try {
    await window.auth.signInAnonymously();
    // sidebar.js onAuthStateChanged handles the redirect
  } catch (err) {
    showError("Guest sign-in failed. Please try again.");
  }
});

["loginEmail", "loginPass"].forEach(id =>
  document.getElementById(id).addEventListener("input", clearError)
);

// ── Password show/hide toggle ─────────────────────────────────────────────────
document.getElementById("passToggle").addEventListener("click", () => {
  const input = document.getElementById("loginPass");
  const icon  = document.getElementById("passEyeIcon");
  const show  = input.type === "password";
  input.type  = show ? "text" : "password";
  icon.innerHTML = show
    ? `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
});

// ── Password recovery ─────────────────────────────────────────────────────────
document.getElementById("forgotLink").addEventListener("click", e => {
  e.preventDefault();
  document.getElementById("loginForm").hidden = true;
  document.getElementById("recoveryPanel").hidden = false;
  const email = document.getElementById("loginEmail").value.trim();
  if (email) document.getElementById("recoveryEmail").value = email;
  document.getElementById("recoveryEmail").focus();
});

document.getElementById("backToLogin").addEventListener("click", e => {
  e.preventDefault();
  document.getElementById("recoveryPanel").hidden = true;
  document.getElementById("recoverySuccess").hidden = true;
  document.getElementById("loginForm").hidden = false;
});

document.getElementById("recoveryBtn").addEventListener("click", async () => {
  const email = document.getElementById("recoveryEmail").value.trim();
  if (!email) { document.getElementById("recoveryEmail").focus(); return; }

  const btn = document.getElementById("recoveryBtn");
  btn.disabled = true;
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .7s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Sending…`;

  try {
    await window.auth.sendPasswordResetEmail(email);
  } catch (_) {
    // Silently ignore — always show success to prevent user enumeration
  }

  btn.disabled = false;
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send reset link`;
  document.getElementById("recoveryEmail").value = "";
  document.getElementById("recoverySuccess").hidden = false;
});
