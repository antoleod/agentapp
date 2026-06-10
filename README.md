# Agent Evaluation App

A lightweight, offline-first browser app for evaluating ServiceNow agents.  
No server, no build step, no dependencies — just open `index.html`.

---

## Features

- Login with configurable credentials (default: `admin` / `admin`)
- Evaluation form with 6 scored criteria (1–5), SLA breach tracking, and direct ServiceNow integration
- Database view with search, export/import JSON, and inline edit/delete
- Reports with totals, SLA count, average score, and per-agent bar chart (sorted by score)
- Settings to configure the ServiceNow instance URL, default evaluator name, and login credentials
- Fully offline — all data stored in `localStorage`, session in `sessionStorage`
- Responsive layout — sidebar collapses on mobile

---

## Getting Started

1. Open `index.html` in any modern browser (Chrome, Edge, Firefox).
2. Log in with the default credentials — **username:** `admin` / **password:** `admin`.
3. Go to **Settings** to change credentials and set your ServiceNow instance URL.

---

## Architecture

The app is a single-page application (SPA) with hash-based routing — **no HTML repetition**.

```
agentapp/
│
├── index.html              ← Entry point (redirects to login)
├── login.html              ← Login page (standalone)
├── app.html                ← Single app shell — loaded after login
│
├── js/
│   ├── core.js             ← Shared: data access, settings, session, ServiceNow utils
│   ├── sidebar.js          ← Renders sidebar once; nav links update on hash change
│   ├── router.js           ← Hash router — calls render + init for each page
│   └── pages/
│       ├── form.js         ← renderFormPage() + initFormPage()
│       ├── database.js     ← renderDatabasePage() + initDatabasePage()
│       ├── reports.js      ← renderReportsPage() + initReportsPage()
│       └── settings.js     ← renderSettingsPage() + initSettingsPage()
│
├── css/
│   ├── variables.css       ← Design tokens (colors, radii, shadows) + global reset
│   ├── layout.css          ← Sidebar, app shell, topbar, responsive breakpoints
│   ├── components.css      ← Nav, cards, buttons, forms, inputs, table
│   ├── reports.css         ← Report grid, metric cards, agent bar chart
│   └── login.css           ← Login page overrides
│
├── data/
│   └── data.json           ← Reference / backup data file
│
└── scripts/
    ├── backup-data.ps1
    ├── servicenow-lookup.ps1
    ├── start-app.ps1
    └── startApp.bat
```

### How routing works

Navigation uses URL hashes (`app.html#form`, `app.html#database`, …).

| Hash | Page |
|---|---|
| `#form` | Evaluation Form |
| `#database` | Database |
| `#reports` | Reports |
| `#settings` | Settings |
| _(empty)_ | Defaults to `#form` |

`router.js` maps each hash to a `render*Page()` function (returns HTML string) and an `init*Page()` function (binds events). The sidebar active state updates automatically.

---

## Adding a New Page

1. Create `js/pages/yourpage.js` with two exports:
   ```js
   function renderYourPage() {
     return `<div class="topbar"><h2>Your Page</h2></div> ...`;
   }
   function initYourPage() {
     // bind events here
   }
   ```
2. Add a `<script>` tag for it in `app.html` (before `router.js`).
3. Register the route in `js/router.js`:
   ```js
   yourpage: { title: "Your Page", render: renderYourPage, init: initYourPage },
   ```
4. Add a nav entry in `js/sidebar.js`:
   ```js
   { label: "Your Page", page: "yourpage" },
   ```
5. If you need unique styles, add `css/yourpage.css` and link it in `app.html`.

---

## CSS Architecture

| File | Responsibility |
|---|---|
| `variables.css` | CSS custom properties, `box-sizing` reset, `body` base |
| `layout.css` | Sidebar, `.app` shell, `.topbar`, responsive breakpoints |
| `components.css` | `.nav`, `.card`, buttons, form inputs, table, toolbar |
| `reports.css` | `.report-grid`, `.metric`, `.agent-row`, `.bar` |
| `login.css` | Login page overrides (body centering, `.login-box`) |

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

Scores: **1 (Poor)** → **5 (Excellent)**. Average shown in Database and Reports.

---

## Data

All evaluations are stored in `localStorage` under `agentEvaluationsV2`.  
Use **Export JSON** in Database to back up, and **Import JSON** to restore.  
Session state uses `sessionStorage` — expires when the tab is closed.
