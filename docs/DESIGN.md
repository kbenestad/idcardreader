# DESIGN.md

Design system and architecture notes for **bizdocs**. For day-to-day working
instructions, see [CLAUDE.md](CLAUDE.md).

## Principles

- **Single-file apps, no build, no backend.** Each app is one `index.html` that
  runs from static hosting. State lives in the browser (`localStorage`);
  nothing is sent to a server.
- **Config-driven.** Branding, currencies, accounts, work codes, tax types,
  products and all UI copy come from a per-app `config.yml`. Code reads config;
  it does not hardcode an organisation's specifics.
- **One shared design, many apps.** Everything visual and cross-cutting is
  factored into `assets/` and reused, so the apps look and behave like one
  product family. The same class/ID vocabulary means a single change
  propagates to every app.

## The shared layer (`assets/`)

Three files, referenced by every app as `../assets/…`:

### `style.css` — colour scheme & foundation
The single source of truth for the **colour scheme**. Defines:
- Design tokens as CSS custom properties on `:root`: accent, surfaces, text,
  status colours (danger/warning/success/info), radii, shadows, and a
  typography scale (`--fs-*`) driven by `--font-scale`.
- **Dark mode** in two forms: automatic via `@media (prefers-color-scheme:
  dark)`, and forced via `:root[data-theme="dark"]`. A pre-paint inline script
  in each app sets `data-theme` from `localStorage['kb-theme']` before first
  paint.
- Reset, base typography, and the page shell (`.kb-wrap`).

Change a colour here and it changes everywhere. Accent can also be overridden
per app via `accent-colour` in `config.yml` (applied by `applyAccent()`).

### `ui.css` — reusable components
The `kb-*` component library: toolbar (`.kb-toolbar`, `.kb-seg`, `.kb-iconbtn`,
`.kb-sz-label`), header/brand (`.kb-header`, `.kb-brand`, `.kb-doctitle`),
cards (`.kb-card`, `.kb-card__title`), form grids/fields (`.kb-grid`,
`.kb-field`, `.kb-label`), inputs (`.kb-input/.kb-select/.kb-textarea` with
`.num`, `.is-error`, `.is-warn`), buttons (`.kb-btn` + `--primary/--ghost/
--soft/--dashed/--danger/--lg/--sm/--block`, `.kb-circbtn`), notes/banners
(`.kb-note--error/--warning/--success/--info`), totals (`.kb-totals`), chips
(`.kb-chip`), the modal (`.kb-overlay`, `.kb-modal`, `.kb-modal__hdr/__body/
__footer`), loading/error states, and the footer (`.kb-footer`, `.kb-mark`).

App-specific layout is **not** here — it stays in each app's inline `<style>`
(invoice's line-item/tax column grids and FX/payment blocks; reimburse's item
blocks, receipt rows and currency dropdown; timesheet's entry-row grid, code
legend and signature pad).

### `app.js` — shared runtime
Cross-cutting JavaScript, loaded just before each app's own inline script. It
is a classic (non-module) script, so the names below are globals visible to the
app script — including inside the IIFE-wrapped scripts of reimburse/timesheet.

| Area        | API |
| ----------- | --- |
| DOM         | `$`, `$$`, `el(tag, attrs, children)`, `uid()` |
| Markdown    | `markdown(md)` — minimal MD→HTML for About boxes; preserves HTML entities |
| Brand/icons | `KB_BRAND_SVG`, `KB_FOOTER_MARK_SVG`, `KB_ICON` |
| Theme       | `currentTheme()`, `toggleTheme()`, `updateThemeIcon()`, `makeThemeButton()`, `makeAboutButton(onClick)`; key `KB_THEME_KEY = 'kb-theme'` |
| Modals      | `kbModal(opts)` and `kbConfirm` / `kbAlert` / `kbAbout` |
| Config      | `loadYamlConfig(url)`, `applyAccent(cfg)` |
| Numbers     | `formatAmount(n, {fallback, locale})`, `parseAmount(s)` |
| Dates       | `formatDate(iso, pattern, full, short)`, `MONTHS_FULL`, `MONTHS_SHORT` |
| Font scale  | `currentScale()`, `setFontScale()`, `bumpFontScale(dir)`, `initFontScale()`, `makeSizeControl()`; key `KB_SCALE_KEY = 'kb-font-scale'` |
| i18n        | `buildLangTable(loc)`, `lookupString(table, key, lang, defLang, vars)`, `pdfOutputLang(cfg, uiLang)` |

## Localisation

Every `config.yml` carries a unified `localisation:` block:

```yaml
localisation:
  default-language: en
  languages:
    - { code: en, name: English }
    - { code: de, name: Deutsch }
    # …
  en:
    ui:       { key: "English text", … }   # UI strings
    about:    { title: …, content: …, button: … }
    # app-specific maps (products / uom / tax-types / currencies / holidays / codes …)
  de:
    ui:       { key: "Deutscher Text", … }
    # …
```

Each app's adapter (`normaliseI18n` in invoice, `normaliseConfig` in
reimburse/timesheet) calls the shared `buildLangTable()` to flatten
`localisation[lang].ui` into a `{ key: { lang: value } }` table, then layers on
its own data-specific maps. Lookups (`t()` / `T()` / `S()`) delegate to
`lookupString()`, which falls back `lang → default → key` and interpolates
`{placeholder}` tokens. `pdfOutputLang()` decides whether the generated PDF
follows the UI language or the config default (`output-language` setting).

**Rule:** no user-facing English in code. Add a key to every language block and
look it up. Use `{token}` placeholders for values (e.g. currency).

## Theme & text size

- **Theme** is a single attribute (`data-theme`) plus the `kb-theme` storage
  key, toggled by `toggleTheme()`. All theme buttons carry `.kb-theme-btn` so
  their icons stay in sync.
- **Text size** is unified onto the `--font-scale` token (the `--fs-*` tokens
  are `calc(... * var(--font-scale))`). The A−/A+ control is built by
  `makeSizeControl()`, clamps to 0.5–1.5, and persists under `kb-font-scale`.
  (Invoice formerly used CSS `zoom` on its form; it now uses `--font-scale`
  like the others.)

## Modals

One modal structure across all apps: `.kb-overlay` > `.kb-modal` with
`.kb-modal__hdr` / `__body` / `__footer`. Built dynamically by `kbModal()` and
its wrappers (`kbConfirm`, `kbAlert`, `kbAbout`), which return Promises and
handle backdrop-click / Escape dismissal. About content is rendered through
`markdown()`.

## PDF generation — the one deliberate divergence

Invoice uses **jsPDF**; reimburse and timesheet use **pdf-lib**. This is the
one place the apps are not unified, for a concrete reason:

- **jsPDF** is convenient for *generating* a layout from scratch (invoice).
- **pdf-lib** can load, embed and append existing PDF/image bytes, which
  reimburse (receipt attachments) and timesheet (signature image) require, and
  jsPDF cannot do cleanly.

This is acceptable because the **user-facing UX is identical** — a Download
button that produces a PDF. The engine is an implementation detail.

**Convergence target: pdf-lib.** It is effectively a superset — it can do both
the from-scratch drawing invoice needs and the embed/append the others need.
When this is reconciled, invoice's jsPDF layout should be reimplemented against
pdf-lib so all apps share one engine. This is real work (pdf-lib is a
lower-level drawing API) and should be done deliberately, not as a drive-by;
there is no UX regression risk since the output stays a PDF download. **New apps
should use pdf-lib from the start.**

## Conventions for new apps

**Start from `_template/`.** It is a complete, working reference app — the
canonical shell that wires up the shared toolbar, header, theme, text-size
control, language switch, About modal, footer and boot sequence. Copy it and
replace the marked app-specific parts; do **not** hand-assemble the chrome, or
it will drift from the other apps. The template is verified to render identically
to the existing three (light/dark, all languages).

What it already establishes, and you should preserve:

1. The exact `<head>`: pre-paint theme script, CDN libs, then the three shared
   `../assets/` references (`app.js` before the inline script).
2. The chrome assembly: `kb-toolbar` (language · spacer · `makeSizeControl()` ·
   `makeThemeButton()` · `makeAboutButton()`), the `kb-header` brand lockup, and
   the `kb-footer`.
3. The boot order: `loadYamlConfig → normaliseConfig (buildLangTable) →
   applyAccent → initFontScale → applyLang → render`.
4. The `config.yml` header keys: `organization`, `logo`, `logo-maxwidth`,
   `tagline`, `page-size`, `output-language`, `font-*`, `font-size`,
   `accent-colour`, then the `localisation:` block.

Then: build your form from `kb-*` components, route every string through the
lookup (`S()`), use **pdf-lib** for output, and keep only genuinely
app-specific layout in the app's inline `<style>` — everything shareable goes in
`assets/`.

### Standalone apps — `basis/`

`_template/` is for apps that live *in* this repo and link `../assets/`. For an
app that must ship **outside** the repo (its own repo/hosting, no access to the
shared `../assets/`), start from **`basis/`** instead. It is the same canonical
shell, with one difference: it **bundles its own copy** of the shared
design/runtime in `basis/assets/` and references it locally (`assets/…` rather
than `../assets/…`), so the folder is self-contained.

The trade-off of self-containment is that the shared files are duplicated, so
they must be kept in sync. `basis/assets/{style.css,ui.css,app.js}` are
byte-identical copies of the top-level `assets/`; `basis/sync.sh` refreshes them
from a local checkout or from GitHub. The rule that keeps drop-in sync clean is
the same as everywhere else: **never hand-edit the shared files** — app-specific
CSS goes in the inline `<style>`, app-specific copy goes through `config.yml` +
`S()`. See `basis/README.md`.
