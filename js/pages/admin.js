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

const ROLE_META = {
  admin:     { label: "Admin",     perms: ["View all", "Create", "Edit any", "Delete", "Manage users"] },
  evaluator: { label: "Evaluator", perms: ["View all", "Create", "Edit own"] },
  viewer:    { label: "Viewer",    perms: ["View all", "Export"] },
};

function roleBadge(role) {
  const cls = { admin: "role-admin", evaluator: "role-evaluator", viewer: "role-viewer" }[role] || "role-viewer";
  const label = ROLE_META[role]?.label || role || "—";
  return `<span class="role-badge ${cls}">${escapeHtml(label)}</span>`;
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
    const perms  = (ROLE_META[u.role]?.perms || []).map(p => `<span class="perm-chip">${escapeHtml(p)}</span>`).join("");
    const uid    = escapeHtml(u.id);
    const email  = escapeHtml(u.email || "");

    return `
      <tr class="user-row" data-uid="${uid}">
        <td>
          <div class="user-avatar-row">
            <div class="user-avatar-circle">${escapeHtml((u.displayName || u.email || "?")[0].toUpperCase())}</div>
            <div>
              <div class="user-row-name">${escapeHtml(u.displayName || u.email?.split("@")[0] || "—")}${isSelf ? ' <span class="you-chip">you</span>' : ""}</div>
              <div class="user-row-meta">${email}</div>
            </div>
          </div>
        </td>
        <td>
          <div style="display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;align-items:center;gap:8px">
              ${roleBadge(u.role)}
              <select class="inline-role-select"
                      data-id="${uid}"
                      data-email="${email}"
                      data-current="${escapeHtml(u.role || "")}">
                <option value="admin"     ${u.role === "admin"     ? "selected" : ""}>Admin</option>
                <option value="evaluator" ${u.role === "evaluator" ? "selected" : ""}>Evaluator</option>
                <option value="viewer"    ${u.role === "viewer"    ? "selected" : ""}>Viewer</option>
              </select>
            </div>
            <div class="perm-chips">${perms}</div>
          </div>
        </td>
        <td>
          <button class="eval-count-btn btn btn-ghost btn-sm" data-email="${email}" title="Show evaluations">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
            <span class="eval-count-label" id="ecount-${uid}">…</span>
          </button>
        </td>
        <td>
          <div class="user-row-meta">${formatDate(u.addedAt)}</div>
          ${u.addedBy ? `<div class="user-row-meta" style="font-size:11px;opacity:.7">by ${escapeHtml(u.addedBy)}</div>` : ""}
        </td>
        <td style="text-align:right">
          <button class="btn btn-danger btn-sm remove-btn"
                  data-id="${uid}"
                  data-email="${email}"
                  ${isSelf ? 'disabled title="Cannot remove yourself"' : ""}>
            Remove
          </button>
        </td>
      </tr>
      <tr class="eval-expand-row hidden" id="expand-${uid}">
        <td colspan="5" style="padding:0;border-bottom:1px solid var(--border)">
          <div class="eval-expand-body" id="expand-body-${uid}"></div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".inline-role-select").forEach(sel => sel.addEventListener("change", onRoleChange));
  tbody.querySelectorAll(".remove-btn").forEach(btn => btn.addEventListener("click", onRemove));
  tbody.querySelectorAll(".eval-count-btn").forEach(btn => btn.addEventListener("click", onEvalCount));

  // Load eval counts for all users
  filtered.forEach(u => loadEvalCount(u));
}

async function loadEvalCount(u) {
  const el = document.getElementById("ecount-" + u.id);
  if (!el) return;
  try {
    const snap = await window.db.collection(COLLECTION)
      .where("createdBy", "==", u.email || "")
      .get();
    el.textContent = snap.size + " eval" + (snap.size !== 1 ? "s" : "");
    el.closest(".eval-count-btn").dataset.evals = snap.docs.map(d => JSON.stringify({ id: d.id, ...d.data() })).join("|||");
  } catch {
    el.textContent = "—";
  }
}

async function onEvalCount(e) {
  const btn   = e.currentTarget;
  const email = btn.dataset.email;
  const row   = btn.closest("tr");
  const uid   = row.dataset.uid;
  const expRow  = document.getElementById("expand-" + uid);
  const expBody = document.getElementById("expand-body-" + uid);

  // Toggle
  if (!expRow.classList.contains("hidden")) {
    expRow.classList.add("hidden");
    return;
  }

  expBody.innerHTML = `<div style="padding:16px 22px;color:var(--muted);font-size:13px">Loading…</div>`;
  expRow.classList.remove("hidden");

  try {
    const snap = await window.db.collection(COLLECTION)
      .where("createdBy", "==", email)
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();

    if (snap.empty) {
      expBody.innerHTML = `<div style="padding:16px 22px;color:var(--muted);font-size:13px">No evaluations found for this user.</div>`;
      return;
    }

    const rows = snap.docs.map(d => {
      const ev = d.data();
      return `<tr>
        <td style="padding:10px 22px;font-size:13px;font-weight:600">${escapeHtml(ev.ticketNumber || d.id)}</td>
        <td style="padding:10px 22px;font-size:13px;color:var(--text-secondary)">${escapeHtml(ev.agentName || "—")}</td>
        <td style="padding:10px 22px;font-size:13px;color:var(--muted)">${escapeHtml(ev.evaluationDate || "—")}</td>
        <td style="padding:10px 22px;font-size:13px">
          <span style="font-weight:600;color:${(ev.avgScore||0)>=4?"var(--success)":(ev.avgScore||0)>=3?"var(--warning)":"var(--danger)"}">
            ${ev.avgScore ? Number(ev.avgScore).toFixed(2) : "—"}
          </span>
        </td>
        <td style="padding:10px 22px;text-align:right">
          <a href="form.html?edit=${encodeURIComponent(ev.ticketNumber||d.id)}" class="btn btn-ghost btn-sm" style="font-size:12px">Edit</a>
        </td>
      </tr>`;
    }).join("");

    expBody.innerHTML = `
      <div style="padding:10px 22px 6px;font-size:11.5px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">
        Recent evaluations by ${escapeHtml(email)} (last 10)
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="border-bottom:1px solid var(--border)">
            <th style="padding:8px 22px;text-align:left;font-size:11.5px;color:var(--muted);font-weight:600;text-transform:uppercase">Ticket</th>
            <th style="padding:8px 22px;text-align:left;font-size:11.5px;color:var(--muted);font-weight:600;text-transform:uppercase">Agent</th>
            <th style="padding:8px 22px;text-align:left;font-size:11.5px;color:var(--muted);font-weight:600;text-transform:uppercase">Date</th>
            <th style="padding:8px 22px;text-align:left;font-size:11.5px;color:var(--muted);font-weight:600;text-transform:uppercase">Avg</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (err) {
    expBody.innerHTML = `<div style="padding:16px 22px;color:var(--danger);font-size:13px">Error: ${escapeHtml(err.message)}</div>`;
  }
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
