# CLAUDE.md

Guidance for working in this repository. For the design system and
architecture rationale, see [DESIGN.md](DESIGN.md).

## What this is

**bizdocs** is a collection of small, self-contained web apps that help
individuals and small organisations produce common business documents as PDFs.
There are currently three:

| App          | Purpose                                              | PDF engine |
| ------------ | ---------------------------------------------------- | ---------- |
| `invoice/`   | Freelance/consulting invoices (taxes, FX, payment)   | jsPDF      |
| `reimburse/` | Expense reimbursement with attached receipts         | pdf-lib    |
| `timesheet/` | Timesheets by employee type, work codes, signatures  | pdf-lib    |

Each app is **one `index.html`** (all HTML/CSS/JS inline) plus a `config.yml`
and an `assets/` folder of favicons/PWA icons. There is **no build step and no
backend** — the apps run straight from static files in the browser.

## Repository layout

```
assets/            ← SHARED across all apps (referenced as ../assets/…)
  style.css          design tokens / colour scheme + reset + page shell
  ui.css             reusable kb-* UI components
  app.js             shared runtime (DOM helpers, theme, modals, i18n, …)
_template/         CANONICAL STARTER (in-series) — copy this to add an app here
basis/             STANDALONE STARTER — self-contained app that ships outside this repo
invoice/   index.html · config.yml · assets/ (favicons)
reimburse/ index.html · config.yml · assets/ (favicons)
timesheet/ index.html · config.yml · assets/ (favicons)
README.md · LICENSE (Apache-2.0)
```

Two starters, for two cases. **`_template/`** is for a new app that lives *in*
this repo — it links the shared `../assets/`. **`basis/`** is for a standalone
app that ships *outside* this repo — it bundles its own copy of the shared
design/runtime in `basis/assets/`, kept byte-identical to the top-level
`assets/` so a UI change here drops straight in (`basis/sync.sh` refreshes
them). See `basis/README.md`.

Each app links the shared files in its `<head>`:

```html
<link rel="stylesheet" href="../assets/style.css">
<link rel="stylesheet" href="../assets/ui.css">
...
<script src="../assets/app.js"></script>   <!-- before the app's own inline <script> -->
```

## How an app boots

1. A tiny inline pre-paint script in `<head>` reads `localStorage['kb-theme']`
   and sets `data-theme` before first paint (avoids a flash).
2. CDN libraries load: `js-yaml` (all apps), plus `jspdf` (invoice) or
   `pdf-lib` (reimburse, timesheet).
3. `../assets/app.js` loads and defines the shared globals.
4. The app's inline `<script>` runs: `loadYamlConfig()` fetches and parses
   `config.yml`, an adapter normalises the `localisation:` block, and the UI is
   built from config. State persists to `localStorage`.

## Running / previewing locally

The apps `fetch('config.yml')`, so they must be served over HTTP — opening
`index.html` via `file://` will fail.

```bash
python3 -m http.server 8000
# then open http://localhost:8000/invoice/  (or /reimburse/ , /timesheet/)
```

## Verifying a change

There are no automated tests. Verify visually by rendering the app. A headless
Chromium is available in this environment:

```bash
CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
"$CHROME" --headless=new --no-sandbox --disable-gpu \
  --virtual-time-budget=8000 --window-size=1200,1600 \
  --screenshot=out.png "http://localhost:8000/invoice/index.html"
```

`--virtual-time-budget` lets the JS-built UI settle before the screenshot.

**Caveat:** in sandboxed environments the browser often cannot reach the CDNs,
so `js-yaml` fails to load and the app shows a config error. To verify a full
render, vendor `js-yaml` locally for the test only — download it, drop a copy
next to the app, point a throwaway copy of `index.html` at the local file, and
screenshot that. Delete the throwaway files afterwards; never commit them.
(`jspdf`/`pdf-lib` are only needed when generating a PDF, not for initial
render.) Things worth screenshotting after a change: the full form, dark mode,
the About modal, and a non-English language.

## Conventions when editing

- **Reuse the shared layer.** Styling and cross-cutting logic live in
  `assets/`. Don't reintroduce per-app copies of design tokens, `kb-*`
  components, DOM helpers, theme/modal/i18n/format code. If three apps would
  need the same thing, put it in `assets/` and reference it.
- **Same classes/IDs for the same element** across apps, so one change in
  `ui.css` propagates everywhere. App-specific layout (column grids, receipt
  rows, the timesheet grid, the signature pad) stays in that app's inline
  `<style>`.
- **Scope gotcha.** `reimburse` and `timesheet` wrap their main script in an
  IIFE (`(async function(){ … })()`), so their top-level functions are *not*
  globals. `invoice`'s main script is a plain classic script, so its top-level
  declarations *are* globals (and must not collide with names defined in
  `app.js`). Globals from `app.js` are visible inside the IIFEs.
- **localStorage keys.** Theme = `kb-theme`, font scale = `kb-font-scale`
  (shared). Per-app data uses app-specific keys (e.g. `reimb-state`,
  `timesheet-lang`, invoice's `LS_*`).
- **User-facing strings go through localisation**, never hardcoded literals —
  add a key to every language block in that app's `config.yml` `ui:` section
  and look it up via the app's `t()`/`T()`/`S()`. Use `{placeholder}` tokens
  for interpolation.
- **The container is ephemeral.** Only committed, pushed work survives. Commit
  and push when a change is complete.

## Adding a new app

**Copy `_template/`.** It is the canonical shell — the standard `<head>` (with
the pre-paint theme script and correct script order), a JS-built toolbar /
header / footer assembled from the shared helpers, an example card, the boot
sequence, and a pdf-lib download stub — already wired to `../assets/`. Then:

1. Rename the folder; update the `<title>`, the doc-title `<h1>`, and the
   `template-lang` localStorage key.
2. Replace `buildExampleCard()` with your form (built from `kb-*` components),
   and `onDownload()` with your real PDF (use **pdf-lib**).
3. Fill in `config.yml` — keep the header keys and add your `ui:` strings to
   *every* language block, plus any data lists you need.
4. Drop a real favicon / PWA icon set into the new app's `assets/`.

Building from the template rather than hand-assembling the chrome is what keeps
a new app visually identical to the others. See DESIGN.md for the design system.

## Out of scope / known notes

- Two PDF engines coexist (jsPDF in invoice, pdf-lib elsewhere). This is
  intentional for now — the UX is identical. New apps should standardise on
  pdf-lib; see DESIGN.md for the rationale and convergence plan.
