# basis

A **standalone** starter that shares the **bizdocs** look and runtime, but is
self-contained and lives **outside** the app series.

Use it when you want an app that looks and behaves exactly like an `invoice` /
`reimburse` / `timesheet` page, but ships on its own — its own repo, its own
hosting — without depending on the bizdocs monorepo's shared `../assets/`.

## How it differs from `_template/`

|                     | `_template/` (in-series)        | `basis/` (standalone)              |
| ------------------- | ------------------------------- | ---------------------------------- |
| Shared design/runtime | links `../assets/`            | bundles its **own** `assets/`      |
| Lives               | inside the bizdocs monorepo     | anywhere — copy the folder out     |
| UI source of truth  | the monorepo `assets/`          | its `assets/`, kept in sync (below)|

Everything else — the `<head>`, toolbar, header, footer, boot sequence,
`config.yml` header keys, `kb-*` components — is identical to `_template/`, so a
basis app is **pixel-identical** to the bizdocs apps.

## Layout

```
app/                  (this repo's copy of the bizdocs "basis" standalone starter)
  index.html          self-contained app shell (references ./assets, not ../assets)
  config.yml          standard bizdocs config header + localisation
  assets/
    style.css         ← copy of bizdocs assets/style.css   (keep byte-identical)
    ui.css            ← copy of bizdocs assets/ui.css       (keep byte-identical)
    app.js            ← copy of bizdocs assets/app.js       (keep byte-identical)
    favicon.svg       placeholder — replace with a real icon set per app
    site.webmanifest
  sync.sh             pull bizdocs UI changes into ./assets
  README.md
```

## Keeping it pixel-perfect (drop-in updates)

`assets/style.css`, `assets/ui.css` and `assets/app.js` are **verbatim copies**
of bizdocs' shared files. Because they're byte-identical, a bizdocs UI change
drops straight in — just refresh the three files:

```bash
# from a local bizdocs checkout sitting next to this folder
./sync.sh ../path/to/bizdocs/assets

# or straight from GitHub, no checkout needed
BIZDOCS_REF=main ./sync.sh --from-github

git diff -- assets   # review what changed, then commit
```

`sync.sh` only ever touches those three shared files — your `config.yml`,
`index.html`, favicons and app-specific code are never overwritten.

> Keep the chrome as shipped and route every new app-specific string through
> `config.yml` + `S()`. The moment you hand-edit the shared `assets/` files,
> drop-in sync stops being clean — put app-specific CSS in `index.html`'s inline
> `<style>` instead.

## Build a standalone app from it

1. Copy this `basis/` folder out to its own location/repo.
2. Set the `<title>`, the doc-title `<h1>`, and the `basis-lang` localStorage key.
3. Replace `buildExampleCard()` with your form (built from `kb-*` components) and
   `onDownload()` with your real PDF (use **pdf-lib**).
4. Fill in `config.yml` — keep the header keys, add `ui:` strings to **every**
   language block, route all copy through `S()`.
5. Drop a real favicon / PWA icon set into `assets/`.

## Running locally

The app `fetch()`es `config.yml`, so serve it over HTTP (not `file://`):

```bash
python3 -m http.server 8000
# open http://localhost:8000/app/
```
