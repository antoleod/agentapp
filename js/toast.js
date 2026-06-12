const ICONS = {
  success: "✅",
  error:   "❌",
  warning: "⚠️",
  info:    "ℹ️",
};

function getToastContainer() {
  let c = document.getElementById("toastContainer");
  if (!c) {
    c = document.createElement("div");
    c.id = "toastContainer";
    document.body.appendChild(c);
  }
  return c;
}

function _esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function toast(message, type = "success", duration = 3500) {
  const container = getToastContainer();

  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <span class="toast-icon">${ICONS[type] || ICONS.info}</span>
    <div class="toast-body">
      <div class="toast-title">${capitalize(type)}</div>
      <div class="toast-msg">${_esc(message)}</div>
    </div>
    <button class="toast-close" onclick="dismissToast(this)">×</button>
  `;

  container.appendChild(el);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add("show"));
  });

  const timer = setTimeout(() => dismissToast(el.querySelector(".toast-close")), duration);
  el._timer = timer;
}

function dismissToast(closeBtn) {
  const el = closeBtn.closest(".toast");
  if (!el) return;
  clearTimeout(el._timer);
  el.classList.remove("show");
  setTimeout(() => el.remove(), 300);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
