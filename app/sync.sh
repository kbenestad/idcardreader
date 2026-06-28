#!/usr/bin/env bash
# =============================================================================
# basis/sync.sh — drop the latest bizdocs UI into this standalone app.
#
# basis bundles its OWN copy of the shared design + runtime (assets/style.css,
# assets/ui.css, assets/app.js) so it can run on its own, outside the bizdocs
# monorepo. Those three files are meant to stay byte-identical to bizdocs'
# shared assets/. Run this after a bizdocs UI change to pull it in.
#
# Usage:
#   ./sync.sh [PATH_TO_BIZDOCS_ASSETS]
#     PATH_TO_BIZDOCS_ASSETS  source assets/ dir (default: ../assets)
#
#   # or sync straight from GitHub (no local checkout needed):
#   BIZDOCS_REF=main ./sync.sh --from-github
#
# It only touches the three shared files; favicons, config.yml and index.html
# are app-specific and never overwritten.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"
DEST="assets"
SHARED=(style.css ui.css app.js)

if [[ "${1:-}" == "--from-github" ]]; then
  REF="${BIZDOCS_REF:-main}"
  BASE="https://raw.githubusercontent.com/kbenestad/bizdocs/${REF}/assets"
  echo "Syncing shared assets from kbenestad/bizdocs@${REF} …"
  for f in "${SHARED[@]}"; do
    curl -fsSL "${BASE}/${f}" -o "${DEST}/${f}"
    echo "  ✓ ${f}"
  done
else
  SRC="${1:-../assets}"
  if [[ ! -d "$SRC" ]]; then
    echo "error: source assets dir not found: $SRC" >&2
    echo "       pass the path to a bizdocs assets/ dir, or use --from-github" >&2
    exit 1
  fi
  echo "Syncing shared assets from ${SRC} …"
  for f in "${SHARED[@]}"; do
    cp "${SRC}/${f}" "${DEST}/${f}"
    echo "  ✓ ${f}"
  done
fi

echo "Done. Shared UI is now in sync with bizdocs."
echo "Review with: git diff -- ${DEST}"
