# CLAUDE.md

**idcardreader** is a standalone web app (template-based extraction of ID card
fields) built on the **bizdocs** standalone starter. It ships on its own — no
build step, no backend, runs from static files in the browser.

## Repository layout

```
app/    the application — self-contained bizdocs "basis" standalone app
        (index.html · config.yml · assets/{style.css,ui.css,app.js,favicons}
         · sync.sh · README.md). References its own ./assets, not ../assets.
docs/   design + working docs:
          CLAUDE.md   detailed working guidance (bizdocs conventions)
          DESIGN.md   design system + architecture rationale
```

`app/` is this repo's copy of the bizdocs **`basis/`** standalone starter — when
the docs in `docs/` say `basis/`, that is `app/` here.

## Running locally

The app `fetch()`es `config.yml`, so serve over HTTP (not `file://`):

```bash
python3 -m http.server 8000   # then open http://localhost:8000/app/
```

## Working guidance — read these

The full conventions (shared `assets/` layer, `kb-*` components, localisation,
theme/text-size, PDF engine choice, how to build the app from the starter) live
in `docs/`. They are imported below so they load with this file.

@docs/CLAUDE.md
@docs/DESIGN.md
