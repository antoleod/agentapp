# UX and Code Audit: Agent Evaluation App

**Date:** 2026-06-10
**Auditor:** Claude Code (claude-sonnet-4-6)
**Scope:** Full codebase review - all HTML, JS, and CSS files

---

## 1. Project Overview

### Stack

- **Frontend:** Vanilla HTML5, CSS3, JavaScript (ES2020+, no bundler, no framework)
- **Auth / Database:** Firebase 10.7.1 (compat SDK) - Firebase Auth (email/password) + Cloud Firestore
- **Fonts:** Google Fonts (Inter) via @import in variables.css
- **Hosting:** Static files, browser-routed (no server-side rendering)

### Purpose

A browser-based tool for evaluating ServiceNow support agents. Evaluators fill a form (ticket number, agent name, date, SLA status, 6 scored criteria, comments), data is saved to Firestore and cached in localStorage, and a Reports page aggregates agent performance. A JavaScript bookmarklet extracts ticket data from ServiceNow and copies it to the clipboard for paste-import.

### Architecture Summary

Multi-page SPA-like structure. Each HTML page loads the Firebase SDK, shared config (firebase-config.js), shared utilities (core.js, sidebar.js, toast.js), and a page-specific script. Authentication and sidebar injection are handled by sidebar.js, which fires a custom appReady event. State is stored in Firestore (primary) with localStorage as a read-through cache. Settings are localStorage-only. No build step, no module system - all scripts share the global namespace.

### File Structure

```
agentapp/
├── index.html                  # Redirect-only to login.html
├── login.html                  # Auth page (standalone)
├── notes                       # ServiceNow bookmarklet source
├── pages/
│   ├── form.html
│   ├── database.html
│   ├── reports.html
│   └── settings.html
├── js/
│   ├── firebase-config.js
│   ├── core.js
│   ├── sidebar.js
│   ├── toast.js
│   └── pages/
│       ├── form.js
│       ├── database.js
│       ├── reports.js
│       └── settings.js
└── css/
    ├── variables.css
    ├── layout.css
    ├── components.css
    ├── form.css
    ├── reports.css
    ├── toast.css
    └── login.css
```

---

## 2. Feature Inventory

| Feature | Status | Notes |
|---|---|---|
| Email/password login | Working | Error messages mapped, loading state handled |
| Guest session | Partial | sessionStorage flag only; no Firebase token |
| Auth redirect on index.html | Working | meta refresh + window.location.replace |
| Auth guard on protected pages | Working | sidebar.js redirects to ../login.html on unauthenticated access |
| Auto-redirect if already logged in | Working | login.html checks onAuthStateChanged |
| Sidebar and navigation | Working | Dynamically built, active link detection works |
| Sign out | **Broken on mobile** | Logout button hidden by CSS on screens < 900px - no alternative |
| Evaluation form | Working | 3 sections, progress bar, required field validation |
| Score pickers (1-5) | Working | Active state, average badge, hidden input sync |
| SLA toggle | Working | Two-state toggle, hidden input sync |
| Progress bar | Working | Tracks required + optional fields |
| ServiceNow paste import | Working | Clipboard API with prompt() fallback |
| Audit panel (post-import summary) | Working | Shows filled/remaining fields |
| Auto-uppercase ticket number | Working | |
| Ticket type badge | Working | Detects INC / RITM / REQ / SCTASK |
| Open ticket in ServiceNow | Working | Uses configured instance or hardcoded fallback |
| Save evaluation to Firestore | Working | ticketNumber as document ID (last-write-wins) |
| Edit saved evaluation | Partial | Reads localStorage cache only - silent fail on cold cache |
| Load saved ticket | Partial | Same localStorage-only limitation |
| Clear form | Working | |
| Database: table view | Working | |
| Database: search/filter | Working | Debounced, searches ticket/agent/LSA |
| Database: export JSON | Working | |
| Database: import JSON | Working | Batch-writes to Firestore |
| Database: delete single row | Working | Confirm dialog |
| Database: delete all | Working | Confirm dialog |
| Reports: stat cards | Working | Total, breaches, average score |
| Reports: agent performance chart | Working | Sorted bar chart |
| Reports: refresh | Partial | Works but destroys button SVG icon on completion |
| Settings: ServiceNow instance URL | Working | Persisted to localStorage |
| Settings: default evaluator name | Working | Pre-fills Evaluated By on form |
| Settings: default login email | **Broken** | Saved but never read back to pre-fill login.html |
| Settings: current user email display | **Broken** | .textContent on input element - always blank |
| Settings: user UID display | **Broken** | Same .textContent bug - always blank |
| Settings: password reset email | Working | Sends Firebase reset email |
| ServiceNow bookmarklet | Partial | Hardcoded SLA name and fallback instance; Spanish alerts |
| localStorage cache | Working | Updated on every Firestore read/write |
| Offline persistence | Working | enablePersistence with synchronizeTabs: true |

---

## 3. Code Quality

### JavaScript

#### Dead Code

`js/core.js:15-30` defines two constants never referenced anywhere in the codebase:

```js
const scoreOptions = [["1", "1 - Poor"], ...];
const scoreLabels  = { assetTracking: "Asset Tracking", ... };
```

`scoreOptions` was presumably intended for a select-based scorer replaced by the HTML button picker. `scoreLabels` is useful only for a report/export formatter that does not exist. Both are dead code.

#### Hardcoded Magic String - Wrong ServiceNow Instance as Fallback

`js/core.js:102`:

```js
const instance = getSettings().serviceNowInstance || "europarl.service-now.com";
```

If a user has not configured their instance in Settings, every Open in ServiceNow click silently opens europarl.service-now.com - a real external organization's production system. The fallback should be an empty string that prompts the user to configure Settings.

#### createdAt Always Overwritten on Save

`js/pages/form.js:145` - `readForm()` always stamps `createdAt: new Date().toISOString()`. An edit-and-save replaces the original creation timestamp with the edit time, destroying the audit trail. The original `createdAt` must be read from the existing record and preserved when updating.

#### Edit Mode Reads Only localStorage, Not Firestore

`js/pages/form.js:11-13`:

```js
const cached = JSON.parse(localStorage.getItem("agentEvaluationsV2") || "[]");
const item   = cached.find(x => x.ticketNumber === ticket);
if (item) { loadIntoForm(item); ... }
```

If the cache is stale, cleared, or the user is on a different browser, `form.html?edit=INC001` silently loads nothing. There is no Firestore fallback and no error message.

#### Missing auth/invalid-credential Error Code

`login.html:95-100` - The Firebase error code map does not include `auth/invalid-credential`, the code Firebase v10 returns for wrong-password attempts when email enumeration protection is enabled. Affected users see the raw SDK error string.

#### Inline onclick with Unescaped Firestore Data - Stored XSS

`js/pages/database.js:64-65`:

```js
onclick="openServiceNow('${item.ticketNumber}')"
onclick="confirmDelete('${item.ticketNumber}')"
```

A ticket number containing a single quote breaks the handler. A malicious value stored in Firestore constitutes stored XSS executing in every user's browser on the Database page. Fix: use data-ticket attributes with a delegated event listener.

#### Inconsistent Use of STORAGE_KEY Constant

`js/core.js:1` defines `const STORAGE_KEY = "agentEvaluationsV2"`. `js/pages/form.js:11` and `js/pages/form.js:355` hardcode the raw string directly. A key name change in `core.js` silently breaks `form.js`.

#### refreshBtn Icon Destroyed on Refresh

`js/pages/reports.js:9` - `textContent` assignment wipes all child nodes including the SVG icon. After refresh the button shows only the text 'Refresh' with no icon. Fix: wrap the label text in a `<span>` and update only that child node.

#### No Input Validation on JSON Import

`js/pages/database.js:118-129` - Import validates only that the top-level value is an array. Records missing `ticketNumber` produce an undefined Firestore document ID, causing a raw SDK error. Individual records must be validated before the batch is committed.

### CSS

#### .section-title Defined Twice with Conflicting Rules

- `css/components.css:21-28`: font-size 13px, text-transform uppercase, color var(--muted), margin-bottom 16px
- `css/form.css:57-61`: font-size 14px, font-weight 700, color var(--text), margin-bottom 2px

On `form.html` both sheets load and `form.css` wins by order. On `database.html` and `settings.html`, which only load `components.css`, any `.section-title` renders uppercase and muted - unintended. Merge or rename one definition.

#### .score-grid Is Unused Dead CSS

`css/components.css:163-168` defines `.score-grid`. It does not appear in any HTML or JS file.

#### .upload Selector Is Dead CSS

`css/components.css:97-101` includes `.upload` in a font-family reset rule. `.upload` does not appear in any HTML or JS file.

#### Google Fonts Import Has No font-display

`css/variables.css:1` - The `@import` has no `display=swap`. The font can block text rendering (FOIT) on slow connections. Append `&display=swap` to the URL.

#### Inlined Styles Throughout HTML

`pages/form.html:24`, `pages/database.html:23`, `pages/reports.html:24,57` use inline style attributes for muted color and font-size overrides. These should be extracted to named utility classes.

### HTML / Accessibility

**Form has no aria-label** - `pages/form.html:48`: the form element has no aria-label or aria-labelledby. Screen readers announce it as a generic unnamed form.

**Score picker buttons lack criterion context** - `pages/form.html:131-213`: Each score button has no aria-label. Screen readers read '1, 2, 3, 4, 5' with no indication of which criterion is being scored. Each button needs aria-label like 'Asset Tracking: score 1'.

**Icon-only button uses title instead of aria-label** - `pages/form.html:71`: searchSnowBtn uses the title attribute but no aria-label. Title is not reliably announced by screen readers and is invisible on touch devices.

**Table has no caption** - `pages/database.html:43`: The evaluations table has no caption element. Screen readers have no programmatic description of the table purpose.

**Loading overlay has no ARIA role** - `pages/form.html:14` and all other pages: the loading div has no role=status or aria-live region. Screen readers receive no notification when auth resolves.

**Most inputs missing name attribute** - Native browser autofill heuristics depend on name in addition to autocomplete, weakening coverage for fields beyond email and password.

---

## 4. Security

### Firebase Config Exposure

`js/firebase-config.js:6,11` - apiKey and appId are placeholder strings. The authDomain, projectId, storageBucket, and messagingSenderId are real production values committed to the repository. For Firebase web apps the API key identifies the project rather than acting as an admin credential. However, Firestore security rules become the sole real access control layer. The rules file is not in this repository and has not been reviewed.

### Auth Guard Coverage

| Page | Guard | Method |
|---|---|---|
| login.html | None (public) | - |
| pages/form.html | Yes | sidebar.js onAuthStateChanged / guestSession check |
| pages/database.html | Yes | Same |
| pages/reports.html | Yes | Same |
| pages/settings.html | Yes | Same |

A user who sets sessionStorage.guestSession = "1" in the browser console bypasses Firebase Auth entirely and gains full access to all four protected pages.

### Guest Mode Risks

`js/sidebar.js:95-100` - Guest mode synthesizes a plain JS object rather than calling auth.signInAnonymously(). Consequences:

1. Firestore writes by guests carry no Firebase auth token. Whether they succeed depends entirely on Firestore security rules.
2. The Delete All button in database.js is fully exposed to guests with no additional guard.
3. All guest records share createdBy: "guest", making it impossible to distinguish actions by different guest users.

The correct fix is to call auth.signInAnonymously() on guest button click, giving guests real ephemeral Firebase tokens that security rules can enforce.

### Stored XSS via innerHTML

`js/pages/database.js:47-70` and `js/pages/reports.js:68` - Firestore string values (ticketNumber, agentName, lsa, assignedTo, evaluatedBy, agent name) are inserted into innerHTML without HTML escaping. Any field containing a script tag or img onerror payload stored in Firestore executes in the browser of every user viewing that page. A minimal escapeHtml() function must be applied to all Firestore values before innerHTML insertion.

### Data Isolation

All evaluations are stored at /evaluations/{ticketNumber} with no per-user namespacing. Two authenticated users evaluating the same ticket number silently overwrite each other. For a single-team deployment this may be acceptable but must be enforced in Firestore rules.

---

## 5. UX / Usability

### Form Flow Issues

**Audit panel unconditionally lists scores as still needed** - `js/pages/form.js:263`: remaining.push("Scores (6 criteria)") runs regardless of whether scores were already set. False urgency on every paste-import.

**Load Saved Ticket gives no hint that a ticket number must be typed first** - `pages/form.html:249`: On empty form shows 'No saved evaluation for this ticket.' with no guidance. Better label: 'Load by Ticket Number'. Or disable the button until the field is non-empty.

**Clear button has no confirmation** - `pages/form.html:35`: One mis-click discards a partially filled form with no recovery. A confirm dialog or undo toast should be added.

**createdAt overwritten on edit-save** - Direct UX consequence of B-02: Database view shows the last-edit date as if it were the creation date.

### Missing Feedback States

**Reports refresh destroys the button icon** - `js/pages/reports.js:9,14`: After refresh the button shows only the text Refresh with no icon. See B-04.

**Import JSON has no loading state** - `js/pages/database.js:112-135`: UI appears idle during a Firestore batch import. Users may click import multiple times.

**Delete All has no loading state** - `js/pages/database.js:137-152`: Table remains fully populated and button stays enabled during the async delete.

### Mobile Responsiveness

**Logout inaccessible on screens below 900px** - `css/layout.css:248`: .sidebar-footer { display: none } hides the logout button entirely at the 900px breakpoint. This is the most severe UX issue in the application. Move the logout button outside .sidebar-footer or add a mobile-visible sign-out affordance.

**Database action buttons cramped at 375px** - Three buttons (Edit, Open, Delete) per row in one td with no minimum width. They wrap or overflow on narrow screens.

**Agent chart bar track hidden on mobile** - `css/reports.css:87-90`: The bar column is hidden at 900px. The chart becomes a plain text score list, losing its primary visual communication of relative performance.

### Keyboard Navigation

**Non-standard Enter key override on ticket field** - `js/pages/form.js:344-351`: Enter is captured in the capture phase to open ServiceNow instead of advancing focus. May interfere with screen reader interaction modes.

**No explicit focus-visible styles on score picker buttons** - .sp-btn has a custom hover state but no explicit focus-visible rule, creating inconsistency between mouse and keyboard feedback.

---

## 6. Performance

### Script Loading

Every protected page loads 3 Firebase SDK scripts from gstatic.com synchronously before any page JS can run. They cannot be made async because page scripts depend on firebase being globally available immediately. This adds 200-400ms of CDN round-trips on first load.

### Google Fonts Blocking Render

`css/variables.css:1` - @import inside a CSS file is render-blocking and cannot be preloaded by the HTML parser. Moving the font link to link rel=preconnect and link rel=stylesheet with display=swap in each HTML head before other stylesheets would reduce time to first meaningful text.

### localStorage / Firestore Drift

`js/core.js:57-68` - getData() updates the localStorage cache on a successful Firestore read. The cache is never proactively invalidated. Deletions or updates made on another device are invisible until the next getData() call. The edit flow in form.js reads exclusively from localStorage, so cross-device editing silently fails.

### No Virtualization

`js/pages/database.js:33-71` - renderTable() rebuilds the full tbody innerHTML on every search keystroke (debounced 200ms). Acceptable at current scale but has no headroom for large datasets.

---

## 7. Known Bugs

| # | Bug | File | Line(s) |
|---|---|---|---|
| B-01 | Settings email and UID inputs always blank - .textContent used instead of .value on input elements | `js/pages/settings.js` | 10-11 |
| B-02 | createdAt overwritten on every save - edit-save destroys original timestamp | `js/pages/form.js` | 145 |
| B-03 | Edit mode reads only localStorage - silently shows empty form on cold cache | `js/pages/form.js` | 11-13 |
| B-04 | refreshBtn.textContent destroys SVG icon | `js/pages/reports.js` | 9, 14 |
| B-05 | Inline onclick with raw Firestore data - single quote breaks handler; XSS vector | `js/pages/database.js` | 64-65 |
| B-06 | Logout button hidden on screens < 900px - no sign-out path on mobile | `css/layout.css` | 248 |
| B-07 | Default Login Email setting saved but never read by login.html | `js/pages/settings.js` | 18 |
| B-08 | auth/invalid-credential missing from error map - wrong password shows raw SDK error | `login.html` | 95-100 |
| B-09 | Hardcoded fallback europarl.service-now.com - unconfigured users open external org ServiceNow | `js/core.js` | 102 |
| B-10 | Audit panel unconditionally lists Scores (6 criteria) as still needed | `js/pages/form.js` | 263 |
| B-11 | Guest mode uses synthetic object with no Firebase token - security rules cannot enforce access | `js/sidebar.js` | 95-100 |

---

## 8. Missing Features / Gaps

**Bookmarklet is non-portable** - `notes` lines 11, 88, 91: SLA filter name ITEC-SUP PS hardcoded. Alert strings in Spanish. Fallback instance is europarl.service-now.com. Cannot be used by any other team without editing the source. Settings page has no SLA filter name field.

**No pagination, date filtering, or column sorting on Database table** - All records rendered at once with only text search. Sorting by date, agent, or score covers the most common review workflows.

**No per-agent drill-down from Reports** - Clicking an agent row does nothing. No path from the Reports chart to individual evaluations for that agent.

**JSON-only export** - Most downstream workflows use Excel or Google Sheets. CSV export would be high-value and low-effort.

**No per-user data isolation** - All authenticated users share /evaluations/{ticketNumber}. Two users evaluating the same ticket number silently overwrite each other.

**scoreLabels and scoreOptions defined but unused** - `js/core.js:15-30`: Suggests a planned export feature never built. Implement or remove.

**No dark mode** - The design token system in variables.css is well-suited for a prefers-color-scheme: dark override but none exists.

---

## 9. Prioritized Action Plan

| Priority | Issue | File | Effort |
|---|---|---|---|
| P0 | B-06: Logout button CSS-hidden on mobile - users cannot sign out | `css/layout.css:248` | S |
| P0 | B-05: Stored XSS via inline onclick with raw Firestore data | `js/pages/database.js:64-65` | S |
| P0 | B-11: Guest mode bypasses Firebase Auth - replace with signInAnonymously() | `js/sidebar.js:95-100`, `login.html:106-109` | M |
| P1 | B-01: Settings email/UID always blank - change .textContent to .value | `js/pages/settings.js:10-11` | XS |
| P1 | B-02: createdAt overwritten on edit - preserve original timestamp | `js/pages/form.js:145` | S |
| P1 | B-03: Edit mode ignores Firestore - add async fallback on cache miss | `js/pages/form.js:11-13` | M |
| P1 | B-04: refreshBtn loses SVG - wrap label in span, update text node only | `js/pages/reports.js:9,14` | XS |
| P1 | B-09: Remove hardcoded fallback instance - prompt to configure Settings | `js/core.js:102` | S |
| P1 | XSS in Firestore values via innerHTML - add escapeHtml() to all innerHTML insertions | `js/pages/reports.js:68`, `js/pages/database.js:47-70` | S |
| P1 | B-08: Add auth/invalid-credential to login error map | `login.html:95-100` | XS |
| P2 | B-07: Implement pre-fill from Default Login Email in login.html or remove field | `js/pages/settings.js:18`, `login.html` | S |
| P2 | B-10: Audit panel - check whether scores differ from default before listing as needed | `js/pages/form.js:263` | S |
| P2 | CSS: .section-title double-defined with conflicting rules - merge or rename | `css/components.css:21-28`, `css/form.css:57-61` | XS |
| P2 | Dead code: remove scoreOptions, scoreLabels or implement their use | `js/core.js:15-30` | XS |
| P2 | Dead CSS: remove .score-grid and .upload rules | `css/components.css:163-168`, `css/components.css:97-101` | XS |
| P2 | Use STORAGE_KEY constant in form.js instead of hardcoded string | `js/pages/form.js:11,355` | XS |
| P2 | A11y: add aria-label with criterion name to all score picker buttons | `pages/form.html:131-213` | S |
| P2 | A11y: replace title with aria-label on searchSnowBtn | `pages/form.html:71` | XS |
| P2 | A11y: add role=status / aria-live to loading overlay | All page HTML files | XS |
| P2 | A11y: add caption to database table | `pages/database.html:43` | XS |
| P2 | A11y: add aria-label to form#evaluationForm | `pages/form.html:48` | XS |
| P2 | Perf: move Google Fonts to link in HTML head with display=swap | `css/variables.css:1`, all HTML heads | S |
| P2 | UX: add confirmation to Clear button | `pages/form.html:35`, `js/pages/form.js:363` | XS |
| P2 | UX: add loading states to Import JSON and Delete All | `js/pages/database.js:112-152` | S |
| P2 | Missing: CSV export from Database page | `js/pages/database.js` | M |
| P2 | Missing: bookmarklet SLA filter name configurable via Settings | `notes`, `pages/settings.html` | M |
