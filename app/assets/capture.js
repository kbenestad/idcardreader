/* =============================================================================
 * idcardreader — Shared capture / extraction runtime   (assets/capture.js)
 * -----------------------------------------------------------------------------
 * APP-OWNED (not part of the bizdocs shared layer — sync.sh never touches this).
 * Loaded after app.js and before each file's inline <script>, same classic
 * (non-module) pattern as the shared files, so the names below become globals
 * used by BOTH index.html (extractor) and template.html (builder).
 *
 * It owns everything about turning whatever the user threw at us (camera photo,
 * image upload, scanned PDF) into a clean, oriented, cropped working image, and
 * running extraction (OCR / QR / crop) against a template's regions. It owns NO
 * UI chrome and NO localised strings — those stay in each file.
 *
 * Depends on three CDN libraries loaded in the page <head>:
 *   - PDF.js   (ES module) → exposed by each page as window.pdfjsLib
 *   - Tesseract.js          → global `Tesseract`
 *   - jsQR                  → global `jsQR`
 *
 * Provides (globals):
 *   captureToImage(file)              → { canvas, isPdf, pageCount, pickPage, thumbnails }
 *   attachCropRotate(canvas, host)    → { getResult, rotate, setCropRect, getCropPct, destroy }
 *   cropRegion(canvas, regionPct)     → canvas
 *   ocrField(regionCanvas, lang)      → Promise<string>
 *   decodeQr(regionCanvas)            → string | null
 *   parseQrPayload(raw, qrParseCfg)   → { [key]: string } | null
 *   normaliseDate(raw, calendar)      → 'YYYY-MM-DD' | null
 *   canvasToDataURL(canvas, type, q)  → data: URI
 * ========================================================================== */
"use strict";

/* ── PDF.js availability ─────────────────────────────────────────────────────
 * PDF.js ships as an ES module, so each page imports it in a <script type=
 * "module"> and assigns window.pdfjsLib. That runs deferred; this classic
 * script may execute first. Nothing here uses PDF.js until the user actually
 * loads a PDF (well after load), so we just wait for the global to appear. */
function ensurePdfjs(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) return resolve(window.pdfjsLib);
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (window.pdfjsLib) { clearInterval(iv); resolve(window.pdfjsLib); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error('PDF.js failed to load')); }
    }, 60);
  });
}

/* ── Small canvas helpers ──────────────────────────────────────────────────── */
function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
function canvasToDataURL(canvas, type = 'image/jpeg', quality = 0.9) {
  return canvas.toDataURL(type, quality);
}
function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });
}

/* ── 3.1  Capture → working image ──────────────────────────────────────────── */
/* Returns a uniform shape for any input:
 *   { canvas, isPdf, pageCount, pickPage(n)->Promise<canvas>, thumbnails[] }
 * For a single-page input `canvas` is ready immediately. For a multi-page PDF
 * `canvas` is page 1, `thumbnails` are small data-URI previews, and the CALLER
 * decides which page is front/back via pickPage(n) — we never auto-pick. */
async function captureToImage(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (!isPdf) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImageElement(url);
      const canvas = newCanvas(img.naturalWidth, img.naturalHeight);
      canvas.getContext('2d').drawImage(img, 0, 0);
      return { canvas, isPdf: false, pageCount: 1, pickPage: async () => canvas, thumbnails: [] };
    } finally { URL.revokeObjectURL(url); }
  }

  const pdfjsLib = await ensurePdfjs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pageCount = pdf.numPages;

  async function renderPage(n, scale) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = newCanvas(viewport.width, viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas;
  }
  // Full-res render for working with (cap scale so huge pages stay sane).
  const pickPage = async (n) => {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, 2200 / Math.max(base.width, base.height));
    return renderPage(n, Math.max(1, scale));
  };
  // Small thumbnails so the caller can show a page chooser.
  const thumbnails = [];
  for (let n = 1; n <= pageCount; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = 220 / Math.max(base.width, base.height);
    const thumb = await renderPage(n, scale);
    thumbnails.push({ page: n, dataUrl: thumb.toDataURL('image/jpeg', 0.7) });
  }
  const first = await pickPage(1);
  return { canvas: first, isPdf: true, pageCount, pickPage, thumbnails };
}

/* Document shapes → crop aspect ratio (width / height, landscape). ID-1 card is
 * 85.6×53.98 mm; an ID-3 passport data page is 125×88 mm. A template names one
 * of these so both the builder and extractor crop to the same proportions and
 * region percentages line up. */
const IDC_ASPECTS = { 'id-card': 85.6 / 53.98, 'passport': 125 / 88 };
function aspectRatioFor(key) { return IDC_ASPECTS[key] || null; }

/* ── 3.2  Crop / rotate UI ─────────────────────────────────────────────────── */
/* Hand-rolled (no Cropper.js dependency — simple enough not to justify one).
 * Renders the working image into `host` with rotate buttons (90° steps plus
 * fine 1° nudges to straighten a tilted card) and a draggable/resizable crop
 * rectangle. The "Use this image" button is built by
 * the CALLER, which calls getResult() to obtain the cropped+rotated canvas.
 *
 * opts:
 *   aspect        number (w/h) → the crop is LOCKED to this ratio: only corner
 *                 handles, all preserving the ratio. null → free crop with
 *                 corner handles that preserve the *current* ratio and edge
 *                 handles that resize a single dimension.
 *   allowOverflow true → the crop may extend beyond the image (for photos that
 *                 cut off part of the card); missing area is filled white in
 *                 getResult(). */
function attachCropRotate(sourceCanvas, host, opts = {}) {
  host.innerHTML = '';
  host.classList.add('idc-cropper');

  const aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : null;   // w/h, or null
  const allowOverflow = !!opts.allowOverflow;
  // Accept array (alignmentRegions) or legacy single object (alignmentRegion), max 2.
  const alignmentRegions = (opts.alignmentRegions || (opts.alignmentRegion ? [opts.alignmentRegion] : [])).filter(Boolean).slice(0, 2);
  let rotation = 0;                 // degrees (90° steps + fine 1° nudges)
  // crop rectangle in *display* pixels, relative to the shown image
  let crop = null;

  const stage = document.createElement('div');
  stage.className = 'idc-stage';
  const imgCanvas = document.createElement('canvas');
  imgCanvas.className = 'idc-stage__img';
  const box = document.createElement('div');
  box.className = 'idc-crop';
  // Corners always; edges only in free (unlocked-ratio) mode.
  const handles = aspect ? ['nw', 'ne', 'sw', 'se'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  handles.forEach(pos => {
    const h = document.createElement('div');
    h.className = 'idc-crop__h idc-crop__h--' + pos;
    h.dataset.handle = pos;
    box.appendChild(h);
  });
  alignmentRegions.forEach((ar, idx) => {
    const guide = document.createElement('div');
    guide.className = 'idc-align-guide' + (idx === 1 ? ' idc-align-guide--2' : '');
    Object.assign(guide.style, {
      left: ar.x + '%', top: ar.y + '%',
      width: ar.w + '%', height: ar.h + '%',
    });
    if (ar.label) {
      const tag = document.createElement('div');
      tag.className = 'idc-align-guide__tag';
      tag.textContent = ar.label;
      guide.appendChild(tag);
    }
    box.appendChild(guide);
  });
  // Overlay mask: dark outside the crop, transparent inside. Placed between the
  // image and the crop box so it stays inside .idc-stage (doesn't bleed onto buttons).
  const mask = document.createElement('div');
  mask.className = 'idc-crop-mask';
  // Remove the old box-shadow approach — the mask replaces it.
  box.style.boxShadow = 'none';
  stage.append(imgCanvas, mask, box);

  const tools = document.createElement('div');
  tools.className = 'idc-croptools';
  const btnL = document.createElement('button');
  btnL.type = 'button'; btnL.className = 'kb-btn kb-btn--ghost kb-btn--sm'; btnL.title = 'Rotate left';
  btnL.textContent = '⟲ 90°';
  const btnR = document.createElement('button');
  btnR.type = 'button'; btnR.className = 'kb-btn kb-btn--ghost kb-btn--sm'; btnR.title = 'Rotate right';
  btnR.textContent = '⟳ 90°';
  // Fine rotation: nudge by 1° to straighten a slightly-tilted card.
  const btnL1 = document.createElement('button');
  btnL1.type = 'button'; btnL1.className = 'kb-btn kb-btn--ghost kb-btn--sm'; btnL1.title = 'Rotate left 1°';
  btnL1.textContent = '⟲ 1°';
  const btnR1 = document.createElement('button');
  btnR1.type = 'button'; btnR1.className = 'kb-btn kb-btn--ghost kb-btn--sm'; btnR1.title = 'Rotate right 1°';
  btnR1.textContent = '⟳ 1°';
  const angleOut = document.createElement('span');
  angleOut.className = 'idc-croptools__angle';
  const btnReset = document.createElement('button');
  btnReset.type = 'button'; btnReset.className = 'kb-btn kb-btn--ghost kb-btn--sm'; btnReset.title = 'Reset crop';
  btnReset.textContent = '⤢';
  tools.append(btnL, btnR, btnL1, btnR1, angleOut, btnReset);

  // Show the current rotation normalised to (-180°, 180°].
  function updateAngle() {
    let r = ((rotation % 360) + 360) % 360;
    if (r > 180) r -= 360;
    angleOut.textContent = (r > 0 ? '+' : '') + r + '°';
  }

  host.append(tools, stage);

  // Rotated source → an off-screen canvas at the current rotation. Handles
  // arbitrary angles (90° steps + fine 1° nudges): the canvas grows to the
  // rotated bounding box, so nothing is clipped. The corner triangles left bare
  // by a non-orthogonal rotation are filled white (matching getResult's fill).
  function rotatedSource() {
    const r = ((rotation % 360) + 360) % 360;
    if (r === 0) return sourceCanvas;
    const rad = r * Math.PI / 180;
    const sw = sourceCanvas.width, sh = sourceCanvas.height;
    const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    const w = Math.round(sw * cos + sh * sin);
    const h = Math.round(sw * sin + sh * cos);
    const c = newCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rad);
    ctx.drawImage(sourceCanvas, -sw / 2, -sh / 2);
    return c;
  }

  let displayScale = 1;   // display px / source px
  function initCrop() {
    const W = imgCanvas.width, H = imgCanvas.height;
    if (aspect) {                       // largest rect of `aspect`, centred
      let w = W, h = w / aspect;
      if (h > H) { h = H; w = h * aspect; }
      crop = { x: (W - w) / 2, y: (H - h) / 2, w, h };
    } else {
      crop = { x: 0, y: 0, w: W, h: H };
    }
  }
  function paint() {
    const src = rotatedSource();
    const maxW = Math.max(240, host.clientWidth || 640);
    displayScale = Math.min(1, maxW / src.width);
    imgCanvas.width = Math.round(src.width * displayScale);
    imgCanvas.height = Math.round(src.height * displayScale);
    imgCanvas.getContext('2d').drawImage(src, 0, 0, imgCanvas.width, imgCanvas.height);
    if (!crop) initCrop();
    clampCrop();
    drawBox();
    updateAngle();
  }
  function clampCrop() {
    const W = imgCanvas.width, H = imgCanvas.height;
    if (allowOverflow) {
      // Allow the crop past the image edges (cards cut off in a photo), but keep
      // it from running away entirely.
      crop.w = Math.max(20, Math.min(crop.w, 3 * W));
      crop.h = Math.max(20, Math.min(crop.h, 3 * H));
      crop.x = Math.max(-W, Math.min(crop.x, 2 * W));
      crop.y = Math.max(-H, Math.min(crop.y, 2 * H));
    } else {
      crop.w = Math.max(20, Math.min(crop.w, W));
      crop.h = Math.max(20, Math.min(crop.h, H));
      crop.x = Math.max(0, Math.min(crop.x, W - crop.w));
      crop.y = Math.max(0, Math.min(crop.y, H - crop.h));
    }
  }
  function drawBox() {
    box.style.left = crop.x + 'px';
    box.style.top = crop.y + 'px';
    box.style.width = crop.w + 'px';
    box.style.height = crop.h + 'px';
    // Clip the mask so the crop area punches through (evenodd: outer rect filled,
    // inner rect subtracts — dark outside the crop, transparent inside).
    const W = imgCanvas.offsetWidth || imgCanvas.width;
    const H = imgCanvas.offsetHeight || imgCanvas.height;
    const x = crop.x, y = crop.y, w = crop.w, h = crop.h;
    mask.style.clipPath =
      `polygon(evenodd, 0px 0px, ${W}px 0px, ${W}px ${H}px, 0px ${H}px,` +
      ` ${x}px ${y}px, ${x}px ${y + h}px, ${x + w}px ${y + h}px, ${x + w}px ${y}px)`;
  }

  // Pointer drag: move the box, resize from an edge (single dimension), or
  // resize from a corner (keeps the aspect ratio — the fixed one if locked,
  // else the crop's ratio at grab time).
  let drag = null;
  function onDown(e) {
    const handle = e.target.dataset && e.target.dataset.handle;
    const rect = stage.getBoundingClientRect();
    let mode = handle ? 'resize' : (e.target === box ? 'move' : null);
    // In free mode a click on empty stage starts a brand-new rectangle; in
    // aspect-locked mode the box stays the locked shape, so ignore empty clicks.
    if (!mode && !aspect) {
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      crop = { x, y, w: 1, h: 1 };
      drag = { mode: 'resize', handle: 'se', ratio: null, startX: e.clientX, startY: e.clientY, orig: { ...crop }, rect };
    } else if (mode) {
      const isCorner = handle && handle.length === 2;
      drag = {
        mode, handle, rect, startX: e.clientX, startY: e.clientY, orig: { ...crop },
        ratio: isCorner ? (aspect || crop.w / crop.h) : null,
      };
    } else { drag = null; return; }
    box.setPointerCapture && box.setPointerCapture(e.pointerId);
    e.preventDefault();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    const o = drag.orig;
    if (drag.mode === 'move') {
      crop.x = o.x + dx; crop.y = o.y + dy;
    } else if (drag.ratio) {
      // Corner: keep the ratio. Width is driven by horizontal drag (signed per
      // corner), height derived; the opposite corner stays anchored.
      const hd = drag.handle, sx = hd.includes('e') ? 1 : -1;
      let w = Math.max(20, o.w + sx * dx);
      let h = w / drag.ratio;
      const x = hd.includes('e') ? o.x : o.x + o.w - w;
      const y = hd.includes('s') ? o.y : o.y + o.h - h;
      crop = { x, y, w, h };
    } else {
      // Edge: resize one dimension only.
      let x = o.x, y = o.y, w = o.w, h = o.h;
      const hd = drag.handle;
      if (hd === 'w') { x = o.x + dx; w = o.w - dx; }
      if (hd === 'e') { w = o.w + dx; }
      if (hd === 'n') { y = o.y + dy; h = o.h - dy; }
      if (hd === 's') { h = o.h + dy; }
      if (w < 0) { x += w; w = -w; }
      if (h < 0) { y += h; h = -h; }
      crop = { x, y, w, h };
    }
    clampCrop(); drawBox();
  }
  function onUp() {
    drag = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
  box.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointerdown', onDown);

  btnL.addEventListener('click', () => { rotation -= 90; crop = null; paint(); });
  btnR.addEventListener('click', () => { rotation += 90; crop = null; paint(); });
  // Fine nudges keep the crop so straightening doesn't reset the framing.
  btnL1.addEventListener('click', () => { rotation -= 1; paint(); });
  btnR1.addEventListener('click', () => { rotation += 1; paint(); });
  btnReset.addEventListener('click', () => { crop = null; paint(); });
  const onResize = () => paint();
  window.addEventListener('resize', onResize);

  paint();

  return {
    rotate(deg) { rotation += deg; crop = null; paint(); },
    setCropRect(rectPct) {   // {x,y,w,h} in % of the displayed image
      crop = {
        x: rectPct.x / 100 * imgCanvas.width,
        y: rectPct.y / 100 * imgCanvas.height,
        w: rectPct.w / 100 * imgCanvas.width,
        h: rectPct.h / 100 * imgCanvas.height,
      };
      clampCrop(); drawBox();
    },
    getCropPct() {
      return {
        x: crop.x / imgCanvas.width * 100, y: crop.y / imgCanvas.height * 100,
        w: crop.w / imgCanvas.width * 100, h: crop.h / imgCanvas.height * 100,
      };
    },
    // Final, full-resolution cropped + rotated canvas. When the crop extends
    // past the image, the missing area is filled white (drawImage clips the
    // source/destination proportionally, so the visible part stays aligned).
    getResult() {
      const src = rotatedSource();
      const sx = crop.x / displayScale, sy = crop.y / displayScale;
      const sw = crop.w / displayScale, sh = crop.h / displayScale;
      const out = newCanvas(sw, sh);
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
      return out;
    },
    destroy() { window.removeEventListener('resize', onResize); },
  };
}

/* ── 3.3  Region extraction ────────────────────────────────────────────────── */
/* Template regions are percentages of the working image (resolution-independent
 * — phone photos and scans differ wildly in pixel size). */
function cropRegion(canvas, regionPct) {
  const x = regionPct.x / 100 * canvas.width;
  const y = regionPct.y / 100 * canvas.height;
  const w = regionPct.w / 100 * canvas.width;
  const h = regionPct.h / 100 * canvas.height;
  const out = newCanvas(w, h);
  out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  return out;
}

/* OCR one region with Tesseract.js. `lang` is a Tesseract language code (e.g.
 * 'eng', 'tha', 'eng+tha'); the trained data downloads on first use and is
 * cached by the browser. Returns trimmed text ('' on failure — never throws so
 * one bad field can't abort the whole extraction). */
async function ocrField(regionCanvas, lang = 'eng') {
  try {
    if (typeof Tesseract === 'undefined') throw new Error('Tesseract.js not loaded');
    const { data } = await Tesseract.recognize(regionCanvas, lang);
    return (data && data.text ? data.text : '').replace(/\s+/g, ' ').trim();
  } catch (e) {
    console.warn('ocrField failed:', e);
    return '';
  }
}

/* Decode a QR code from a region. Returns the raw string, or null if none. */
function decodeQr(regionCanvas) {
  try {
    if (typeof jsQR === 'undefined') throw new Error('jsQR not loaded');
    const ctx = regionCanvas.getContext('2d');
    const img = ctx.getImageData(0, 0, regionCanvas.width, regionCanvas.height);
    const res = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    return res && res.data ? res.data : null;
  } catch (e) {
    console.warn('decodeQr failed:', e);
    return null;
  }
}

/* ── 3.4  QR payload parsing ───────────────────────────────────────────────── */
/* Split a decoded QR string into named sub-values per a side's `qr-parse`
 * config. Returns null if there's no config (caller then treats the QR as a
 * raw reference string, not structured data). */
function parseQrPayload(rawString, qrParseConfig) {
  if (!qrParseConfig || !rawString) return null;
  const delim = qrParseConfig.delimiter != null ? String(qrParseConfig.delimiter) : '|';
  const keys = Array.isArray(qrParseConfig.keys) ? qrParseConfig.keys : [];
  if (!keys.length) return null;
  const parts = delim === '' ? [rawString] : rawString.split(delim);
  const out = {};
  keys.forEach((k, i) => { out[k] = (parts[i] != null ? String(parts[i]).trim() : ''); });
  return out;
}

/* ── 3.5  Date normalisation ───────────────────────────────────────────────── */
/* Parse a raw date string into an ISO 'YYYY-MM-DD'. Buddhist-calendar years are
 * Gregorian + 543, so we subtract 543. Returns null (never throws) on anything
 * unparseable — the field then keeps its raw text for the human to fix. */
const _MONTHS = {
  // English (full + 3-letter)
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  // Thai month names (full)
  'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4, 'พฤษภาคม': 5, 'มิถุนายน': 6,
  'กรกฎาคม': 7, 'สิงหาคม': 8, 'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12,
  // Thai month abbreviations
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
};
// Map Thai digits → ASCII so OCR'd ๐-๙ parse like 0-9.
function _asciiDigits(s) {
  return s.replace(/[๐-๙]/g, d => String(d.charCodeAt(0) - 0x0E50));
}
function normaliseDate(rawString, calendar = 'gregorian') {
  if (!rawString) return null;
  const adjust = (y) => calendar === 'buddhist' ? y - 543 : y;
  const valid = (y, m, d) => {
    if (!(y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    const pad = n => String(n).padStart(2, '0');
    return `${y}-${pad(m)}-${pad(d)}`;
  };
  const s = _asciiDigits(String(rawString)).trim();

  // ISO-ish: 2024-01-31 or 2024/01/31
  let m = s.match(/(\d{4})[\-/.](\d{1,2})[\-/.](\d{1,2})/);
  if (m) return valid(adjust(+m[1]), +m[2], +m[3]);

  // D MonthName YYYY  (English or Thai month word, optional surrounding punctuation)
  m = s.match(/(\d{1,2})\s*([^\d\s]+)\.?\s*(\d{2,4})/);
  if (m) {
    // Strip any leading/trailing punctuation (e.g. 01-JAN-18 gives m[2]='-JAN-')
    const monthStr = m[2].replace(/[^a-zA-Z฀-๿]/g, '');
    const mon = _MONTHS[monthStr.toLowerCase()] || _MONTHS[monthStr];
    if (mon) { let y = +m[3]; if (y < 100) y += 2000; return valid(adjust(y), mon, +m[1]); }
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (day-first; common on ID cards)
  m = s.match(/(\d{1,2})[\-/.](\d{1,2})[\-/.](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return valid(adjust(y), +m[2], +m[1]); }

  return null;
}
