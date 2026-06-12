/* admin.js — User Management page script */

let _allUsers = [];

document.addEventListener("appReady", async () => {
  const user = window.currentUser;

  // Redirect guests immediately
  if (user.isAnonymous || !user.email) {
    toast("Access denied.", "error");
    window.location.href = "form.html";
    return;
  }

  // Guard: only admins may access this page
  const ok = await isAdmin(user.email);
  if (!ok) {
    toast("Access denied.", "error");
    window.location.href = "form.html";
    return;
  }

  await loadUsers();
  bindForm();
  bindSearch();
});

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadUsers() {
  const loading = document.getElementById("usersLoading");
  const empty   = document.getElementById("usersEmpty");
  const table   = document.getElementById("usersTable");

  loading.classList.remove("hidden");
  empty.classList.add("hidden");
  table.classList.add("hidden");

  _allUsers = await listAllRoles();

  loading.classList.add("hidden");

  if (!_allUsers.length) {
    empty.classList.remove("hidden");
    return;
  }

  table.classList.remove("hidden");
  renderRows(_allUsers);
}

async function refreshUsers() {
  _allUsers = await listAllRoles();
  renderRows(_allUsers);
  if (!_allUsers.length) {
    document.getElementById("usersTable").classList.add("hidden");
    document.getElementById("usersEmpty").classList.remove("hidden");
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch { return iso; }
}

function renderRows(users) {
  const tbody  = document.getElementById("usersBody");
  const table  = document.getElementById("usersTable");
  const empty  = document.getElementById("usersEmpty");
  const search = (document.getElementById("userSearch").value || "").toLowerCase();
  const me     = (window.currentUser.email || "").toLowerCase();

  const filtered = search
    ? users.filter(u =>
        (u.email       || "").toLowerCase().includes(search) ||
        (u.displayName || "").toLowerCase().includes(search) ||
        (u.role        || "").toLowerCase().includes(search)
      )
    : users;

  if (!filtered.length) {
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }

  table.classList.remove("hidden");
  empty.classList.add("hidden");

  tbody.innerHTML = filtered.map(u => {
    const isSelf = (u.email || "").toLowerCase() === me;
    return `
      <tr class="user-row">
        <td>
          <div class="user-row-name">${escapeHtml(u.displayName || u.email?.split("@")[0] || "—")}</div>
          <div class="user-row-meta">${escapeHtml(u.email || "—")}</div>
        </td>
        <td>
          <select class="inline-role-select"
                  data-id="${escapeHtml(u.id)}"
                  data-email="${escapeHtml(u.email || "")}"
                  data-current="${escapeHtml(u.role || "")}">
            <option value="admin"     ${u.role === "admin"     ? "selected" : ""}>Admin</option>
            <option value="evaluator" ${u.role === "evaluator" ? "selected" : ""}>Evaluator</option>
            <option value="viewer"    ${u.role === "viewer"    ? "selected" : ""}>Viewer</option>
          </select>
        </td>
        <td>
          <div class="user-row-meta">${formatDate(u.addedAt)}</div>
          ${u.addedBy ? `<div class="user-row-meta" style="font-size:11px;opacity:.7">by ${escapeHtml(u.addedBy)}</div>` : ""}
        </td>
        <td style="text-align:right">
          <button class="btn btn-danger btn-sm remove-btn"
                  data-id="${escapeHtml(u.id)}"
                  data-email="${escapeHtml(u.email || "")}"
                  ${isSelf ? 'disabled title="Cannot remove yourself"' : ""}>
            Remove
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".inline-role-select").forEach(sel => {
    sel.addEventListener("change", onRoleChange);
  });

  tbody.querySelectorAll(".remove-btn").forEach(btn => {
    btn.addEventListener("click", onRemove);
  });
}

// ── Event handlers ────────────────────────────────────────────────────────────

async function onRoleChange(e) {
  const sel      = e.currentTarget;
  const docId    = sel.dataset.id;
  const email    = sel.dataset.email;
  const newRole  = sel.value;
  const prevRole = sel.dataset.current;

  if (newRole === prevRole) return;

  const me = (window.currentUser.email || "").toLowerCase();
  if (email.toLowerCase() === me && newRole !== "admin") {
    if (!confirm("You are about to change your own role. You may lose admin access. Continue?")) {
      sel.value = prevRole;
      return;
    }
  }

  const u = _allUsers.find(x => x.id === docId);
  if (!u) return;

  sel.disabled = true;
  try {
    await setUserRole(u.email, u.displayName, newRole);
    sel.dataset.current = newRole;
    toast(`Role updated to ${newRole}.`, "success");
    await refreshUsers();
  } catch {
    toast("Failed to update role.", "error");
    sel.value = prevRole;
  } finally {
    sel.disabled = false;
  }
}

async function onRemove(e) {
  const btn   = e.currentTarget;
  const docId = btn.dataset.id;
  const email = btn.dataset.email;

  const me = (window.currentUser.email || "").toLowerCase();
  if (email.toLowerCase() === me) {
    toast("You cannot remove your own account.", "warning");
    return;
  }

  if (!confirm(`Remove access for ${email}? They will no longer have an assigned role.`)) return;

  btn.disabled = true;
  try {
    await removeUserRole(docId);
    toast(`Removed ${email}.`, "success");
    await refreshUsers();
  } catch {
    toast("Failed to remove user.", "error");
    btn.disabled = false;
  }
}

// ── Add User form ─────────────────────────────────────────────────────────────

function bindForm() {
  const form = document.getElementById("inviteForm");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const email       = document.getElementById("inviteEmail").value.trim();
    const role        = document.getElementById("inviteRole").value;
    const displayName = document.getElementById("inviteNote").value.trim();
    const btn         = document.getElementById("inviteBtn");

    if (!email) { toast("Please enter an email address.", "warning"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast("Please enter a valid email address.", "warning");
      return;
    }

    btn.disabled = true;
    const origHtml = btn.innerHTML;
    btn.textContent = "Adding…";

    try {
      await setUserRole(email, displayName || null, role);
      toast(`Added ${email} as ${role}.`, "success");
      form.reset();
      document.getElementById("inviteRole").value = "evaluator";
      await refreshUsers();
    } catch (err) {
      toast("Failed to add user." + (err.message ? " " + err.message : ""), "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  });
}

// ── Search ────────────────────────────────────────────────────────────────────

function bindSearch() {
  document.getElementById("userSearch").addEventListener("input", () => {
    renderRows(_allUsers);
  });
}
