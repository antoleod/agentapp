const NAV_ITEMS = [
  {
    label: "Form",
    href:  "form.html",
    icon:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>`,
  },
  {
    label: "Database",
    href:  "database.html",
    icon:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
  },
  {
    label: "Reports",
    href:  "reports.html",
    icon:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>`,
  },
  {
    label: "Bookmarklet",
    href:  "bookmarklet.html",
    icon:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>`,
  },
  {
    label: "Settings",
    href:  "settings.html",
    icon:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
  },
];

function userInitials(user) {
  if (user.isAnonymous) return "G";
  const name = userDisplayName(user);
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function formatEmailName(email) {
  const local = email.split("@")[0] || "User";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function userDisplayName(user) {
  if (user.isAnonymous) return "Guest";
  if (user.displayName)  return user.displayName;
  if (user.email)        return formatEmailName(user.email);
  return "User";
}

function buildSidebar(user) {
  const current  = window.location.pathname.split("/").pop();

  const navLinks = NAV_ITEMS.map(({ label, href, icon }) => `
    <a class="nav ${current === href ? "active" : ""}" href="${href}">
      <span class="nav-icon">${icon}</span>
      ${label}
    </a>
  `).join("");

  const initials = userInitials(user);
  const name     = userDisplayName(user);
  const role     = user.isAnonymous ? "Guest access" : (user.email || "Authenticated");

  const logoutSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>`;

  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.setAttribute("aria-label", "Main navigation");
  sidebar.innerHTML = `
    <div class="sidebar-brand">
      <img class="sidebar-logo-img" src="../img/logo.svg" alt="Agent Evaluation" width="36" height="36" />
      <div>
        <h1>Agent Eval</h1>
        <p>ServiceNow Helper</p>
      </div>
    </div>

    <nav class="sidebar-nav" aria-label="Pages">
      <span class="nav-label">Navigation</span>
      ${navLinks}
    </nav>

    <div class="sidebar-footer">
      <div class="user-card">
        <div class="user-avatar">${initials}</div>
        <div class="user-info">
          <div class="user-name">${escapeHtml(name)}</div>
          <div class="user-role">${escapeHtml(role)}</div>
        </div>
      </div>
      <button class="logout-btn" id="logoutBtn" aria-label="Sign out">
        ${logoutSvg} Sign out
      </button>
    </div>

    <button class="logout-btn mobile-logout-btn" id="mobileLogoutBtn" aria-label="Sign out">
      ${logoutSvg} Sign out
    </button>
  `;

  const shell = document.querySelector(".shell");
  shell.insertBefore(sidebar, shell.firstChild);

  // Async admin nav injection — only for authenticated (non-guest) users with an email
  if (!user.isAnonymous && user.email) {
    isAdmin(user.email).then(ok => {
      if (!ok) return;
      const nav = sidebar.querySelector(".sidebar-nav");
      if (!nav || nav.querySelector('a[href="admin.html"]')) return;
      const adminLink = document.createElement("a");
      adminLink.className = "nav" + (current === "admin.html" ? " active" : "");
      adminLink.href = "admin.html";
      adminLink.innerHTML = `
        <span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg></span>
        Admin
      `;
      nav.appendChild(adminLink);
    }).catch(() => {});
  }

  function doSignOut() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SEARCH_HISTORY_KEY);
    localStorage.removeItem("sessionExpiresAt");
    window.auth.signOut().catch(() => {}).finally(() => {
      window.location.href = "../login.html";
    });
  }

  document.getElementById("logoutBtn").addEventListener("click", doSignOut);
  document.getElementById("mobileLogoutBtn").addEventListener("click", doSignOut);

  // ── Session lock (Ctrl+Shift+L) ────────────────────────────────────────────
  if (!user.isAnonymous && user.email) {
    document.addEventListener("keydown", e => {
      if (e.ctrlKey && e.shiftKey && e.key === "L") {
        e.preventDefault();
        lockSession(user);
      }
    });
  }
}

// ── Lock screen ───────────────────────────────────────────────────────────────
function lockSession(user) {
  if (document.getElementById("lockOverlay")) return; // already locked

  const name   = userDisplayName(user);
  const initials = userInitials(user);
  const email  = user.email || "";

  const overlay = document.createElement("div");
  overlay.id    = "lockOverlay";
  overlay.innerHTML = `
    <div class="lock-card">
      <div class="lock-icon-wrap">
        <div class="lock-avatar">${escapeHtml(initials)}</div>
        <div class="lock-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
        </div>
      </div>
      <div class="lock-name">${escapeHtml(name)}</div>
      <div class="lock-email">${escapeHtml(email)}</div>

      <div id="lockError" class="lock-error" hidden></div>

      <div class="lock-input-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
        <input id="lockPass" type="password" placeholder="Enter your password" autocomplete="current-password" />
        <button type="button" id="lockPassToggle" aria-label="Show">
          <svg id="lockEyeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      </div>

      <button type="button" id="lockUnlockBtn" class="lock-unlock-btn">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
        Unlock
      </button>

      <button type="button" id="lockSignOutBtn" class="lock-signout-btn">Sign out instead</button>
    </div>
  `;

  // Inject CSS once
  if (!document.getElementById("lockOverlayStyles")) {
    const style = document.createElement("style");
    style.id = "lockOverlayStyles";
    style.textContent = `
      #lockOverlay {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(15,23,42,.75);
        backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        animation: lockFadeIn .2s ease;
      }
      @keyframes lockFadeIn { from { opacity:0 } to { opacity:1 } }

      .lock-card {
        background: var(--panel); border: 1px solid var(--border);
        border-radius: 20px; padding: 36px 32px 28px;
        width: 100%; max-width: 340px; text-align: center;
        box-shadow: 0 24px 64px rgba(0,0,0,.25);
        animation: lockSlide .22s cubic-bezier(.34,1.56,.64,1);
      }
      @keyframes lockSlide { from { transform:translateY(24px);opacity:0 } to { transform:translateY(0);opacity:1 } }

      .lock-icon-wrap { position:relative; display:inline-block; margin-bottom:14px; }

      .lock-avatar {
        width:60px; height:60px; border-radius:50%;
        background:var(--primary-light); color:var(--primary);
        border:2px solid var(--primary-border);
        font-size:20px; font-weight:700;
        display:grid; place-items:center;
      }

      .lock-badge {
        position:absolute; bottom:-4px; right:-4px;
        width:22px; height:22px; border-radius:50%;
        background:var(--panel); border:2px solid var(--border);
        display:grid; place-items:center;
      }
      .lock-badge svg { width:11px; height:11px; color:var(--muted); }

      .lock-name { font-size:16px; font-weight:700; color:var(--text); }
      .lock-email { font-size:12.5px; color:var(--muted); margin-top:3px; margin-bottom:20px; }

      .lock-error {
        font-size:13px; color:var(--danger); background:var(--danger-light);
        border:1px solid var(--danger-border); border-radius:8px;
        padding:9px 14px; margin-bottom:14px; text-align:left;
        animation: lockShake .3s cubic-bezier(.4,0,.2,1);
      }
      @keyframes lockShake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }

      .lock-input-wrap {
        position:relative; display:flex; align-items:center;
        border:1.5px solid var(--border); border-radius:10px;
        background:var(--bg); margin-bottom:12px;
        transition:border-color .15s, box-shadow .15s;
      }
      .lock-input-wrap:focus-within {
        border-color:var(--primary);
        box-shadow:0 0 0 3px var(--primary-border);
      }
      .lock-input-wrap > svg { width:15px;height:15px;color:var(--muted);flex-shrink:0;margin-left:12px; }
      .lock-input-wrap input {
        flex:1; border:none; background:transparent; color:var(--text);
        font:14px var(--font-family); padding:11px 8px; outline:none;
      }
      .lock-input-wrap button {
        background:none; border:none; cursor:pointer; color:var(--muted);
        padding:8px 10px; display:grid; place-items:center; border-radius:8px;
      }
      .lock-input-wrap button svg { width:15px;height:15px; }

      .lock-unlock-btn {
        width:100%; padding:12px; border-radius:10px;
        background:var(--primary); color:#fff; border:none;
        font:600 14px var(--font-family); cursor:pointer;
        display:flex; align-items:center; justify-content:center; gap:7px;
        transition:background .15s, box-shadow .15s, transform .1s;
        margin-bottom:10px;
      }
      .lock-unlock-btn:hover:not(:disabled) {
        background:var(--primary-hover);
        box-shadow:0 4px 14px rgba(37,99,235,.3);
        transform:translateY(-1px);
      }
      .lock-unlock-btn:disabled { opacity:.6; cursor:not-allowed; }

      .lock-signout-btn {
        background:none; border:none; cursor:pointer;
        font-size:13px; color:var(--muted); text-decoration:underline;
        transition:color .15s;
      }
      .lock-signout-btn:hover { color:var(--danger); }

      .lock-shortcut-hint {
        margin-top:16px; font-size:11.5px; color:var(--muted);
        display:flex; align-items:center; justify-content:center; gap:5px;
      }
      .lock-shortcut-hint kbd {
        background:var(--bg); border:1px solid var(--border);
        border-radius:4px; padding:1px 5px; font-size:11px;
        font-family:monospace;
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);

  const passInput    = overlay.querySelector("#lockPass");
  const unlockBtn    = overlay.querySelector("#lockUnlockBtn");
  const signOutBtn   = overlay.querySelector("#lockSignOutBtn");
  const errorEl      = overlay.querySelector("#lockError");
  const passToggle   = overlay.querySelector("#lockPassToggle");
  const eyeIcon      = overlay.querySelector("#lockEyeIcon");

  passInput.focus();

  passToggle.addEventListener("click", () => {
    const show = passInput.type === "password";
    passInput.type = show ? "text" : "password";
    eyeIcon.innerHTML = show
      ? `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  });

  async function tryUnlock() {
    const pass = passInput.value;
    if (!pass) { passInput.focus(); return; }

    unlockBtn.disabled = true;
    unlockBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .7s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Verifying…`;

    try {
      await window.auth.signInWithEmailAndPassword(email, pass);
      overlay.style.animation = "lockFadeIn .15s ease reverse";
      setTimeout(() => overlay.remove(), 140);
    } catch (err) {
      const msgs = {
        "auth/wrong-password":     "Incorrect password.",
        "auth/invalid-credential": "Incorrect password.",
        "auth/too-many-requests":  "Too many attempts. Try again later.",
      };
      errorEl.textContent = msgs[err.code] || "Incorrect password.";
      errorEl.hidden = false;
      passInput.value = "";
      passInput.focus();
    } finally {
      unlockBtn.disabled = false;
      unlockBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg> Unlock`;
    }
  }

  unlockBtn.addEventListener("click", tryUnlock);
  passInput.addEventListener("keydown", e => { if (e.key === "Enter") tryUnlock(); });

  signOutBtn.addEventListener("click", () => {
    overlay.remove();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SEARCH_HISTORY_KEY);
    localStorage.removeItem("sessionExpiresAt");
    window.auth.signOut().finally(() => { window.location.href = "../login.html"; });
  });
}

// Auth guard — supports Firebase Auth and sessionStorage guest session
let _sidebarBuilt = false;
if (sessionStorage.getItem("guestSession")) {
  _sidebarBuilt = true;
  window.currentUser = { isAnonymous: true, email: null, displayName: "Guest" };
  buildSidebar(window.currentUser);
  hideLoading();
  setTimeout(() => document.dispatchEvent(new Event("appReady")), 0);
} else {
  let _authResolved = false;
  const _authTimeout = setTimeout(() => {
    if (!_authResolved) window.location.href = "../login.html";
  }, 10000);

  window.auth.onAuthStateChanged(user => {
    _authResolved = true;
    clearTimeout(_authTimeout);
    if (_sidebarBuilt) return;
    if (!user) {
      window.location.href = "../login.html";
      return;
    }

    // Session expiry check
    const expiry = parseInt(localStorage.getItem("sessionExpiresAt") || "0", 10);
    if (expiry && Date.now() > expiry) {
      localStorage.removeItem("sessionExpiresAt");
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SEARCH_HISTORY_KEY);
      window.auth.signOut().finally(() => {
        window.location.href = "../login.html";
      });
      return;
    }

    _sidebarBuilt = true;
    window.currentUser = user;
    buildSidebar(user);
    hideLoading();
    document.dispatchEvent(new Event("appReady"));
  });
}
