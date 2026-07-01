# idcardreader

A no-backend, no-build web tool that extracts structured fields (text, dates,
photo, QR) from photos or scans of ID documents, using per-document
**templates**. It shares the **bizdocs** look and runtime but is self-contained
(it bundles its own `assets/`) and ships on its own — e.g. at
`apps.capthailand.org/idcardreader`.

It is **two pages in one folder**, sharing the same chrome and `assets/`:

| Page            | Who uses it     | What it does                                                        |
| --------------- | --------------- | ------------------------------------------------------------------ |
| `index.html`    | daily use       | the **extractor** — capture a card, review fields, download records |
| `template.html` | setup, once     | the **builder** — calibrate where each field sits, export a template |

Everything runs in the browser; nothing is uploaded to a server.

## Layout

```
index.html        the extractor (daily-use tool)
template.html     the template builder (setup-time tool)
config.yml        bizdocs config header + localisation (shared by both pages)
assets/
  style.css       ← byte-identical bizdocs shared file (kept in sync via sync.sh)
  ui.css          ← byte-identical bizdocs shared file
  app.js          ← byte-identical bizdocs shared file
  capture.js      ← APP-OWNED: capture / PDF render / crop-rotate / OCR / QR / dates
  favicon.svg, site.webmanifest
templates/
  manifest.json   hand-maintained list of available template files
  thai-id-card.yaml   one file per document type (a calibration example)
sync.sh, README.md
```

`sync.sh` refreshes the three shared files from bizdocs; it never touches
`capture.js`, `config.yml`, the HTML pages or `templates/`.

## How the extractor works (`index.html`)

1. **Pick a document type** (loaded from `templates/manifest.json`).
2. **Capture** the front (and back, if the template has one): upload a photo,
   scan, or PDF. Multi-page PDFs show a page picker — you choose which page is
   which side. Then rotate/crop to a clean working image.
3. **Extract** — each template region is cropped and read: OCR (text/date),
   QR decode + payload parse (qr), or kept as a photo crop.
4. **Review** every field. Each row shows the cropped region, the value (which
   you can edit), and a per-field **Reviewed ✓/✗** marker (defaults to ✓).
   Where an OCR value and a QR-derived value **disagree**, both are shown with
   neither pre-selected — you must pick one (or type a third) to resolve it.
5. **Generate** (enabled after you confirm the review, and only with no
   unresolved conflicts) an **HTML** record — a standalone file that
   **re-checks the expiry against today's date every time it is opened**, and
   wraps **every value in a one-click Copy button** for fast copy-out into a
   case file.

## Templates (`template.html` → `templates/*.yaml`)

A template stores, as **percentages of the image** (so it's resolution-
independent), where each field sits, its type (`text`/`date`/`photo`/`qr`),
date calendar (`gregorian`/`buddhist`), optional `qr-parse` (how to split a QR
string) and `qr-key` links, and which field drives the expiry banner.

Because static hosting can't list a folder, the extractor reads
`templates/manifest.json`. To add a template: build it, download `{slug}.yaml`
**and** the updated `manifest.json` the builder offers, then drop both into
`templates/`.

> Calibrate regions, QR delimiters/keys and Buddhist-calendar dates against a
> **real** sample card — the shipped `thai-id-card.yaml` coordinates and QR
> structure are placeholders, not verified values.

## Running locally

Both pages `fetch()` `config.yml` and `templates/`, so serve over HTTP:

```bash
python3 -m http.server 8000
# open http://localhost:8000/app/  (extractor) or .../app/template.html
```

The extraction libraries (PDF.js, Tesseract.js, jsQR) load from CDN, so the
page needs internet at runtime; OCR language data downloads on first use and is
then cached by the browser.
