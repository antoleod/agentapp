document.addEventListener("appReady", () => {
  const s = getSettings();
  document.getElementById("serviceNowInstance").value = s.serviceNowInstance || "";
  document.getElementById("defaultEvaluator").value   = s.defaultEvaluator   || "";
  document.getElementById("loginEmail").value         = s.loginEmail         || "";

  // Show current user info
  const user = window.currentUser;
  if (user && !user.isAnonymous) {
    document.getElementById("currentUserEmail").textContent = user.email || "—";
    document.getElementById("currentUid").textContent       = user.uid;
  } else {
    document.getElementById("userInfoSection").style.display = "none";
  }

  document.getElementById("saveSettingsBtn").addEventListener("click", () => {
    saveSettings({
      serviceNowInstance: document.getElementById("serviceNowInstance").value.trim(),
      defaultEvaluator:   document.getElementById("defaultEvaluator").value.trim(),
      loginEmail:         document.getElementById("loginEmail").value.trim(),
    });
    toast("Settings saved.", "success");
  });

  document.getElementById("changePasswordBtn")?.addEventListener("click", async () => {
    const user = window.currentUser;
    if (!user || user.isAnonymous) { toast("Not available for guest.", "warning"); return; }
    try {
      await window.auth.sendPasswordResetEmail(user.email);
      toast("Password reset email sent to " + user.email, "info");
    } catch (err) {
      toast("Error: " + err.message, "error");
    }
  });
});
