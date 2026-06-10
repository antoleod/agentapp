const NAV_ITEMS = [
  { label: "Form",     href: "form.html" },
  { label: "Database", href: "database.html" },
  { label: "Reports",  href: "reports.html" },
  { label: "Settings", href: "settings.html" }
];

function renderSidebar() {
  const current = window.location.pathname.split("/").pop();

  const navLinks = NAV_ITEMS.map(({ label, href }) => {
    const active = current === href ? "active" : "";
    return `<a class="nav ${active}" href="${href}">${label}</a>`;
  }).join("");

  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.innerHTML = `
    <div class="brand">
      <div class="logo">AE</div>
      <div>
        <h1>Agent Evaluation</h1>
        <p>ServiceNow Evaluation Helper</p>
      </div>
    </div>
    ${navLinks}
    <button id="logoutBtn">Logout</button>
  `;

  document.body.insertBefore(sidebar, document.body.firstChild);

  document.getElementById("logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("aeSession");
    window.location.href = "../login.html";
  });
}

document.addEventListener("DOMContentLoaded", renderSidebar);
