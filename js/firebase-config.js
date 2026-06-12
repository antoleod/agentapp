// ─────────────────────────────────────────────────────────────────────────────
// Firebase Configuration
// Get apiKey and appId from: Firebase Console → Project Settings → Your apps
// ─────────────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyAGGYZZu6MSehZVPl1OBfZhFJZnd1phF-c",          // ← paste from Firebase Console
  authDomain:        "agentapp-8ea1c.firebaseapp.com",
  projectId:         "agentapp-8ea1c",
  storageBucket:     "agentapp-8ea1c.firebasestorage.app",
  messagingSenderId: "1042238748559",
  appId:             "1:1042238748559:web:772ec4d883fa6864927dfa",           // ← paste from Firebase Console
};

firebase.initializeApp(firebaseConfig);

window.auth      = firebase.auth();
window.db        = firebase.firestore();
window.functions = firebase.functions();

// Offline persistence — works across page reloads
window.db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
