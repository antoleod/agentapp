# Agent Evaluation App

A lightweight, browser-based tool for evaluating ServiceNow agents. No server or database required — all data lives in the browser's `localStorage`.

---

## Features

- **Login** with username/password (credentials configurable from Settings)
- **Evaluation form** with 6 scored criteria (1–5), SLA breach tracking, and ServiceNow integration
- **Database** view with search, export/import JSON, and edit/delete per record
- **Reports** with totals, SLA breach count, average score, and per-agent bar chart
- **Settings** to configure the ServiceNow instance URL, default evaluator name, and login credentials
- Fully **offline** — no network required after loading
- **Responsive** layout (sidebar collapses on mobile)

---

## Project Structure

```
agentapp/
├── index.html              ← Entry point (redirects to login)
├── login.html              ← Login page
│
├── pages/                  ← One HTML file per section
│   ├── form.html
│   ├── database.html
│   ├── reports.html
│   └── settings.html
│
├── js/                     ← Modular JavaScript
│   ├── core.js             ← Shared: data, settings, session, ServiceNow utils
│   ├── sidebar.js          ← Sidebar injected into every page (single source of truth)
│   ├── form.js             ← Evaluation form logic
│   ├── database.js         ← Database table, search, export/import
│   ├── reports.js          ← Metrics and agent bar chart
│   └── settings.js         ← Settings load/save
│
├── css/                    ← Modular CSS
│   ├── variables.css       ← Design tokens (colors, radii, shadows) + reset
│   ├── layout.css          ← Sidebar, app shell, topbar, responsive breakpoints
│   ├── components.css      ← Nav, cards, buttons, forms, inputs, table
│   ├── reports.css         ← Report grid, metric cards, agent bar chart
│   └── login.css           ← Login page overrides
│
├── data/
│   └── data.json           ← Reference/backup data file
│
└── scripts/
    ├── backup-data.ps1     ← PowerShell: export localStorage to file
    ├── servicenow-lookup.ps1
    ├── start-app.ps1       ← PowerShell: open app in default browser
    └── startApp.bat        ← Windows shortcut to launch
```

---

## Getting Started

1. Open `index.html` in any modern browser (Chrome, Edge, Firefox).
2. Log in with the default credentials:
   - **Username:** `admin`
   - **Password:** `admin`
3. Go to **Settings** to change credentials and configure your ServiceNow instance URL.

> No installation, no build step, no dependencies.

---

## Adding a New Page

1. Create `pages/yourpage.html` — copy any existing page as a template.
2. Create `js/yourpage.js` with `requireSession()` at the top.
3. Add an entry to the `NAV_ITEMS` array in `js/sidebar.js`:
   ```js
   { label: "Your Page", href: "yourpage.html" }
   ```
   The sidebar updates automatically across all pages.
4. If the page needs unique styles, create `css/yourpage.css` and link it only in that page's `<head>`.

---

## CSS Architecture

| File | Responsibility |
|---|---|
| `variables.css` | CSS custom properties (colors, radii, shadows), box-sizing reset, body base |
| `layout.css` | Sidebar, `.app` shell, `.topbar`, responsive breakpoints |
| `components.css` | `.nav`, `.card`, buttons, form inputs, table, toolbar |
| `reports.css` | `.report-grid`, `.metric`, `.agent-row`, `.bar` |
| `login.css` | Login page body override, `.login-box`, `.login-error` |

Each page links only the CSS files it actually uses.

---

## Score Criteria

| Field | Description |
|---|---|
| Asset Tracking | Correct asset registration and tracking |
| Planning Compliance | Adherence to planning and scheduling |
| KB Compliance | Knowledge Base article usage and creation |
| Team Spirit | Collaboration and team attitude |
| Dress Code | Professional appearance compliance |
| Customer Oriented | Quality of customer interaction |

Scores range from **1 (Poor)** to **5 (Excellent)**. The average is shown in the Database and Reports views.

---

## Data

All evaluations are stored in `localStorage` under the key `agentEvaluationsV2`. Use the **Export JSON** button in the Database page to back up data, and **Import JSON** to restore it.

Session state uses `sessionStorage` and expires when the browser tab is closed.
