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
    label: "Settings",
    href:  "settings.html",
    icon:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
  },
];

function userInitials(user) {
  if (user.isAnonymous) return "G";
  const email = user.email || "";
  const name  = user.displayName || email.split("@")[0] || "U";
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function userDisplayName(user) {
  if (user.isAnonymous) return "Guest";
  return user.displayName || user.email?.split("@")[0] || "User";
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
      <div class="sidebar-logo">AE</div>
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
          <div class="user-name">${name}</div>
          <div class="user-role">${role}</div>
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

  function doSignOut() {
    window.auth.signOut().catch(() => {}).finally(() => {
      window.location.href = "../login.html";
    });
  }

  document.getElementById("logoutBtn").addEventListener("click", doSignOut);
  document.getElementById("mobileLogoutBtn").addEventListener("click", doSignOut);
}

// Auth guard — supports Firebase Auth and temporary guest session
if (sessionStorage.getItem("guestSession")) {
  window.currentUser = { isAnonymous: true, email: null, displayName: "Guest" };
  buildSidebar(window.currentUser);
  hideLoading();
  setTimeout(() => document.dispatchEvent(new Event("appReady")), 0);
} else {
  window.auth.onAuthStateChanged(user => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    window.currentUser = user;
    buildSidebar(user);
    hideLoading();
    document.dispatchEvent(new Event("appReady"));
  });
}
