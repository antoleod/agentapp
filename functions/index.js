const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp }      = require("firebase-admin/app");
const { getFirestore }       = require("firebase-admin/firestore");
const { getAuth }            = require("firebase-admin/auth");

initializeApp();

const db   = getFirestore();
const auth = getAuth();

const ROLES_COLLECTION = "roles";
const VALID_ROLES      = ["admin", "evaluator", "viewer"];

function emailKey(email) {
  return email.toLowerCase().replace(/[@.]/g, "_");
}

async function assertAdmin(uid) {
  const user = await auth.getUser(uid);
  if (!user.email) throw new HttpsError("permission-denied", "No email on account.");
  const snap = await db.collection(ROLES_COLLECTION).doc(emailKey(user.email)).get();
  if (!snap.exists || snap.data().role !== "admin") {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  return user.email;
}

// ── setUserRole ───────────────────────────────────────────────────────────────
// Creates or fully replaces a user's role doc. Sets mustSetPassword: true so
// the invitee is forced to choose a password on first login.
exports.setUserRole = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  const callerEmail = await assertAdmin(request.auth.uid);

  const { email, displayName, role } = request.data;
  if (!email || !role) throw new HttpsError("invalid-argument", "email and role are required.");
  if (!VALID_ROLES.includes(role)) throw new HttpsError("invalid-argument", "Invalid role.");

  await db.collection(ROLES_COLLECTION).doc(emailKey(email)).set({
    email,
    displayName: displayName || email.split("@")[0],
    role,
    addedAt:         new Date().toISOString(),
    addedBy:         callerEmail,
    mustSetPassword: true,
  });

  return { success: true };
});

// ── updateUserRole ────────────────────────────────────────────────────────────
// Changes the role of an existing user. Does NOT touch mustSetPassword.
exports.updateUserRole = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  const callerEmail = await assertAdmin(request.auth.uid);

  const { docId, role } = request.data;
  if (!docId || !role) throw new HttpsError("invalid-argument", "docId and role are required.");
  if (!VALID_ROLES.includes(role)) throw new HttpsError("invalid-argument", "Invalid role.");

  const ref = db.collection(ROLES_COLLECTION).doc(docId);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "User not found.");

  await ref.update({ role, updatedAt: new Date().toISOString(), updatedBy: callerEmail });
  return { success: true };
});

// ── removeUserRole ────────────────────────────────────────────────────────────
exports.removeUserRole = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await assertAdmin(request.auth.uid);

  const { docId } = request.data;
  if (!docId) throw new HttpsError("invalid-argument", "docId is required.");

  await db.collection(ROLES_COLLECTION).doc(docId).delete();
  return { success: true };
});

// ── clearMustSetPassword ──────────────────────────────────────────────────────
// Called by the invitee after they set their password. Verifies the caller owns
// the roles doc before clearing the flag — no client can clear another user's flag.
exports.clearMustSetPassword = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  const user = await auth.getUser(request.auth.uid);
  if (!user.email) throw new HttpsError("failed-precondition", "No email on account.");

  const ref  = db.collection(ROLES_COLLECTION).doc(emailKey(user.email));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "User role record not found.");

  if (snap.data().mustSetPassword) {
    await ref.update({ mustSetPassword: false });
  }
  return { success: true };
});
