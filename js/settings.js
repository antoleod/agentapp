requireSession();

function loadSettingsUI() {
  const s = getSettings();
  document.getElementById("serviceNowInstance").value = s.serviceNowInstance || "";
  document.getElementById("defaultEvaluator").value = s.defaultEvaluator || "";
  document.getElementById("loginUsername").value = s.loginUsername || "";
  document.getElementById("loginPassword").value = s.loginPassword || "";
}

document.addEventListener("DOMContentLoaded", () => {
  loadSettingsUI();

  document.getElementById("saveSettingsBtn").addEventListener("click", () => {
    saveSettings({
      serviceNowInstance: document.getElementById("serviceNowInstance").value.trim(),
      defaultEvaluator: document.getElementById("defaultEvaluator").value.trim(),
      loginUsername: document.getElementById("loginUsername").value.trim(),
      loginPassword: document.getElementById("loginPassword").value
    });
    alert("Settings saved.");
  });
});
