const TRANSLATIONS = {
  en: {
    // Navigation
    "nav.form":     "Form",
    "nav.database": "Database",
    "nav.reports":  "Reports",
    "nav.settings": "Settings",
    "nav.signout":  "Sign out",
    "nav.guest":    "Guest access",

    // Login
    "login.title":       "Welcome back",
    "login.subtitle":    "Sign in to your account to continue",
    "login.email":       "Email address",
    "login.password":    "Password",
    "login.signin":      "Sign In",
    "login.guest":       "Continue as Guest",
    "login.secured":     "Secured by Firebase Authentication",

    // Form page
    "form.title":        "Evaluation Form",
    "form.subtitle":     "Create or update an agent evaluation",
    "form.paste":        "Paste ServiceNow",
    "form.open_sn":      "Open in ServiceNow",
    "form.clear":        "Clear",
    "form.save":         "Save Evaluation",
    "form.saving":       "Saving…",
    "form.load":         "Load Saved Ticket",
    "form.s1_title":     "Ticket Information",
    "form.s1_sub":       "Main ticket and agent details",
    "form.s2_title":     "Evaluation Scores",
    "form.s2_sub":       "Click a number to score each criterion (1 = Poor, 5 = Excellent)",
    "form.s3_title":     "Notes",
    "form.s3_sub":       "Additional context and evaluator",
    "form.ticket":       "Ticket Number",
    "form.ticket_hint":  "Press Enter or click the icon to open in ServiceNow",
    "form.agent":        "Agent Name",
    "form.date":         "Evaluation Date",
    "form.sla":          "SLA Breach",
    "form.sla_ok":       "✓ Within SLA",
    "form.sla_breach":   "⚠ Breached",
    "form.lsa":          "LSA / Support Area",
    "form.assigned":     "Assigned Technician",
    "form.evaluated_by": "Evaluated By",
    "form.comments":     "Comments",
    "form.req_missing":  "required field missing",
    "form.req_missing_pl": "required fields missing",
    "form.all_complete": "All fields complete — ready to save",
    "form.of_fields":    "of",
    "form.fields_filled":"fields filled",

    // Criteria
    "crit.assetTracking":           "Asset Tracking",
    "crit.assetTracking.hint":      "Asset registration & tracking",
    "crit.planningCompliance":      "Planning Compliance",
    "crit.planningCompliance.hint": "Adherence to schedule",
    "crit.kbCompliance":            "KB Compliance",
    "crit.kbCompliance.hint":       "Knowledge base usage",
    "crit.teamSpirit":              "Team Spirit",
    "crit.teamSpirit.hint":         "Collaboration & attitude",
    "crit.dressCode":               "Dress Code",
    "crit.dressCode.hint":          "Professional appearance",
    "crit.customerOriented":        "Customer Oriented",
    "crit.customerOriented.hint":   "Quality of customer interaction",
    "crit.custom_hint":             "Custom criterion",

    // Database page
    "db.title":         "Database",
    "db.subtitle":      "All saved evaluations",
    "db.search_ph":     "Search ticket, agent, LSA…",
    "db.export_json":   "Export JSON",
    "db.export_csv":    "Export CSV",
    "db.import_json":   "Import JSON",
    "db.delete_all":    "Delete All",
    "db.col_ticket":    "Ticket",
    "db.col_agent":     "Agent",
    "db.col_date":      "Date",
    "db.col_sla":       "SLA",
    "db.col_lsa":       "LSA",
    "db.col_assigned":  "Assigned To",
    "db.col_score":     "Score",
    "db.col_evaluated": "Evaluated By",
    "db.col_actions":   "Actions",
    "db.edit":          "Edit",
    "db.open":          "Open",
    "db.delete":        "Delete",

    // Reports page
    "rep.title":        "Reports",
    "rep.subtitle":     "Performance overview",
    "rep.refresh":      "Refresh",
    "rep.total":        "Total Evaluations",
    "rep.breaches":     "SLA Breaches",
    "rep.avg":          "Average Score",
    "rep.all_time":     "All time",
    "rep.out_of_5":     "Out of 5.00",
    "rep.agent_perf":   "Agent Performance",
    "rep.sorted_by":    "Sorted by average score",

    // Settings page
    "set.title":        "Settings",
    "set.subtitle":     "Configure application preferences",
    "set.app":          "Application",
    "set.sn_url":       "ServiceNow Instance URL",
    "set.default_eval": "Default Evaluated By",
    "set.appearance":   "Appearance",
    "set.theme":        "Theme",
    "set.theme_light":  "Light",
    "set.theme_dark":   "Dark",
    "set.language":     "Language",
    "set.account":      "Account",
    "set.email":        "Email",
    "set.uid":          "User ID",
    "set.login_email":  "Default Login Email",
    "set.reset_pwd":    "Send Password Reset Email",
    "set.save":         "Save Settings",
    "set.criteria":     "Score Criteria",
    "set.criteria_sub": "Show or hide criteria on the evaluation form",
    "set.add_criterion":"Add",
    "set.crit_name":    "Criterion name",
    "set.crit_hint":    "Short description (optional)",
    "set.no_custom":    "No custom criteria yet. Add one below.",
    "set.builtin":      "Built-in",
    "set.custom":       "Custom",
    "set.remove":       "Remove",
    "set.visible":      "Visible",
    "set.hidden":       "Hidden",

    // Common
    "common.loading":   "Loading…",
    "common.eval_label":"evals",
    "common.eval_label1":"eval",
  },

  es: {
    "nav.form":     "Formulario",
    "nav.database": "Base de datos",
    "nav.reports":  "Informes",
    "nav.settings": "Configuración",
    "nav.signout":  "Cerrar sesión",
    "nav.guest":    "Acceso de invitado",

    "login.title":       "Bienvenido",
    "login.subtitle":    "Inicia sesión para continuar",
    "login.email":       "Correo electrónico",
    "login.password":    "Contraseña",
    "login.signin":      "Iniciar sesión",
    "login.guest":       "Continuar como invitado",
    "login.secured":     "Protegido por Firebase Authentication",

    "form.title":        "Formulario de evaluación",
    "form.subtitle":     "Crear o actualizar una evaluación de agente",
    "form.paste":        "Pegar ServiceNow",
    "form.open_sn":      "Abrir en ServiceNow",
    "form.clear":        "Limpiar",
    "form.save":         "Guardar evaluación",
    "form.saving":       "Guardando…",
    "form.load":         "Cargar ticket guardado",
    "form.s1_title":     "Información del ticket",
    "form.s1_sub":       "Datos principales del ticket y agente",
    "form.s2_title":     "Puntuaciones de evaluación",
    "form.s2_sub":       "Haz clic en un número para puntuar cada criterio (1 = Malo, 5 = Excelente)",
    "form.s3_title":     "Notas",
    "form.s3_sub":       "Contexto adicional y evaluador",
    "form.ticket":       "Número de ticket",
    "form.ticket_hint":  "Pulsa Intro o el icono para abrir en ServiceNow",
    "form.agent":        "Nombre del agente",
    "form.date":         "Fecha de evaluación",
    "form.sla":          "Incumplimiento SLA",
    "form.sla_ok":       "✓ Dentro de SLA",
    "form.sla_breach":   "⚠ Incumplido",
    "form.lsa":          "LSA / Área de soporte",
    "form.assigned":     "Técnico asignado",
    "form.evaluated_by": "Evaluado por",
    "form.comments":     "Comentarios",
    "form.req_missing":  "campo obligatorio pendiente",
    "form.req_missing_pl":"campos obligatorios pendientes",
    "form.all_complete": "Todos los campos completos — listo para guardar",
    "form.of_fields":    "de",
    "form.fields_filled":"campos completados",

    "crit.assetTracking":           "Control de activos",
    "crit.assetTracking.hint":      "Registro y seguimiento de activos",
    "crit.planningCompliance":      "Cumplimiento de planificación",
    "crit.planningCompliance.hint": "Adherencia al horario",
    "crit.kbCompliance":            "Cumplimiento de KB",
    "crit.kbCompliance.hint":       "Uso de la base de conocimientos",
    "crit.teamSpirit":              "Espíritu de equipo",
    "crit.teamSpirit.hint":         "Colaboración y actitud",
    "crit.dressCode":               "Código de vestimenta",
    "crit.dressCode.hint":          "Apariencia profesional",
    "crit.customerOriented":        "Orientación al cliente",
    "crit.customerOriented.hint":   "Calidad de la atención al cliente",
    "crit.custom_hint":             "Criterio personalizado",

    "db.title":         "Base de datos",
    "db.subtitle":      "Todas las evaluaciones guardadas",
    "db.search_ph":     "Buscar ticket, agente, LSA…",
    "db.export_json":   "Exportar JSON",
    "db.export_csv":    "Exportar CSV",
    "db.import_json":   "Importar JSON",
    "db.delete_all":    "Eliminar todo",
    "db.col_ticket":    "Ticket",
    "db.col_agent":     "Agente",
    "db.col_date":      "Fecha",
    "db.col_sla":       "SLA",
    "db.col_lsa":       "LSA",
    "db.col_assigned":  "Asignado a",
    "db.col_score":     "Puntuación",
    "db.col_evaluated": "Evaluado por",
    "db.col_actions":   "Acciones",
    "db.edit":          "Editar",
    "db.open":          "Abrir",
    "db.delete":        "Eliminar",

    "rep.title":        "Informes",
    "rep.subtitle":     "Resumen de rendimiento",
    "rep.refresh":      "Actualizar",
    "rep.total":        "Total de evaluaciones",
    "rep.breaches":     "Incumplimientos SLA",
    "rep.avg":          "Puntuación media",
    "rep.all_time":     "Histórico",
    "rep.out_of_5":     "Sobre 5.00",
    "rep.agent_perf":   "Rendimiento por agente",
    "rep.sorted_by":    "Ordenado por puntuación media",

    "set.title":        "Configuración",
    "set.subtitle":     "Preferencias de la aplicación",
    "set.app":          "Aplicación",
    "set.sn_url":       "URL de instancia ServiceNow",
    "set.default_eval": "Evaluado por defecto",
    "set.appearance":   "Apariencia",
    "set.theme":        "Tema",
    "set.theme_light":  "Claro",
    "set.theme_dark":   "Oscuro",
    "set.language":     "Idioma",
    "set.account":      "Cuenta",
    "set.email":        "Correo",
    "set.uid":          "ID de usuario",
    "set.login_email":  "Correo de inicio de sesión por defecto",
    "set.reset_pwd":    "Enviar correo de restablecimiento",
    "set.save":         "Guardar configuración",
    "set.criteria":     "Criterios de puntuación",
    "set.criteria_sub": "Mostrar u ocultar criterios en el formulario",
    "set.add_criterion":"Agregar",
    "set.crit_name":    "Nombre del criterio",
    "set.crit_hint":    "Descripción corta (opcional)",
    "set.no_custom":    "Sin criterios personalizados. Agrega uno abajo.",
    "set.builtin":      "Predeterminado",
    "set.custom":       "Personalizado",
    "set.remove":       "Eliminar",
    "set.visible":      "Visible",
    "set.hidden":       "Oculto",

    "common.loading":    "Cargando…",
    "common.eval_label": "evaluaciones",
    "common.eval_label1":"evaluación",
  },
};

function getLang() {
  try {
    return JSON.parse(localStorage.getItem("agentEvaluationSettingsV1") || "{}").language || "en";
  } catch { return "en"; }
}

function t(key) {
  const lang = getLang();
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
  return dict[key] ?? TRANSLATIONS.en[key] ?? key;
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach(el => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
  // Update html lang attribute
  document.documentElement.lang = getLang();
}

// Apply on DOM ready (runs before appReady)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyI18n);
} else {
  applyI18n();
}
