/*
 * RTEC PHC Field Reporting — client-side PDF generation.
 *
 * Uses pdf-lib (vendored in vendor/pdf-lib.min.js, cached offline by the
 * service worker) to build the report entirely on-device — no server, no
 * "screenshot a screen" step. Implements the playbook's output rule
 * directly: Page 1 always; embedded-photo finding pages appended only
 * when findings exist. The technician SOP is never rendered, per the
 * playbook's explicit requirement.
 *
 * The letterhead (logo + address + contact) is sourced from RTEC's real
 * branding assets and PHCI Visit Report PDF (OneDrive: Plant Health Care
 * Department/SOPs/PHCI Reporting/RTEC PHCI client visit report.pdf and
 * Documents/rtec email logo.jpg) — see config.js. Photo handling itself
 * follows the original build playbook (embedded finding pages).
 */
(function () {
  'use strict';

  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

  const PAGE_WIDTH = 612; // US Letter, points
  const PAGE_HEIGHT = 792;
  const MARGIN = 50;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

  const NAVY = rgb(0x12 / 255, 0x3a / 255, 0x5c / 255);
  const LEAF = rgb(0x5b / 255, 0x8c / 255, 0x5a / 255);
  const INK = rgb(0.18, 0.2, 0.22);
  const MUTED = rgb(0.44, 0.47, 0.5);
  const LINE = rgb(0.86, 0.89, 0.91);
  const ALERT_BORDER = rgb(0.82, 0.55, 0.2);
  const PRIORITY_COLORS = {
    Routine: LEAF,
    Prompt: rgb(0.85, 0.58, 0.16),
    Immediate: rgb(0.72, 0.19, 0.16),
  };

  const FINDING_LABEL_WIDTH = 120;
  const FINDING_TEXT_SIZE = 10;

  // Letterhead logo sizes (points). Page 1 gets the full mark; later pages
  // get a smaller running-header version so multi-finding reports don't
  // repeat a heavy block on every page.
  const LOGO_HEIGHT_FIRST = 72;
  const LOGO_HEIGHT_LATER = 28;

  /** Greedy word-wrap using actual glyph widths for the given font/size. */
  function wrapText(text, font, size, maxWidth) {
    const paragraphs = String(text || '').split(/\r?\n/);
    const lines = [];
    paragraphs.forEach((para) => {
      if (para.trim() === '') {
        lines.push('');
        return;
      }
      const words = para.split(/\s+/).filter(Boolean);
      let current = '';
      words.forEach((word) => {
        const trial = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(trial, size) > maxWidth && current) {
          lines.push(current);
          current = word;
        } else {
          current = trial;
        }
      });
      if (current) lines.push(current);
    });
    return lines;
  }

  /** Fetches the RTEC logo and returns raw bytes, or null if unavailable. */
  async function loadLogoBytes() {
    try {
      const res = await fetch('assets/logo.jpg');
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      // fall through to the inline fallback below
    }
    // Artifact/browser-preview builds have no assets/ path to fetch — the
    // preview's build step injects this global with the same image inline.
    if (window.PHC_LOGO_DATA_URI) {
      try {
        const base64 = window.PHC_LOGO_DATA_URI.split(',')[1];
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      } catch (err) {
        return null;
      }
    }
    return null;
  }

  /**
   * Tracks the current page and y-cursor, starting new pages automatically
   * as content overflows. Every finished page gets a footer stamped on it
   * once the final page count is known (see finish()).
   *
   * Section continuity: when content overflows mid-section onto a new
   * page, the section's accent bar + title is redrawn at the top of the
   * new page (as "<title> (continued)") so the visual thread doesn't just
   * stop. section() itself always draws a fresh, non-"continued" heading —
   * see the skipContinuation argument to newPage().
   */
  class ReportWriter {
    constructor(doc, fonts, logo) {
      this.doc = doc;
      this.fonts = fonts;
      this.logo = logo; // { image, width, height } or null
      this.pages = [];
      this.page = null;
      this.y = 0;
      this.currentSection = null;
      this.newPage(true);
    }

    newPage(skipContinuation) {
      const isFirst = this.pages.length === 0;
      this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.pages.push(this.page);
      this.y = PAGE_HEIGHT - MARGIN;
      this.drawLetterhead(isFirst);
      if (!skipContinuation && this.currentSection) {
        this.drawSectionBand(`${this.currentSection} (continued)`);
      }
    }

    /**
     * Full letterhead (logo + address + contact) on page 1; a compact
     * running header on later pages so multi-finding reports don't repeat
     * a heavy block on every page.
     */
    drawLetterhead(isFirstPage) {
      const cfg = window.PHC_CONFIG.company;
      const logoH = isFirstPage ? LOGO_HEIGHT_FIRST : LOGO_HEIGHT_LATER;

      if (isFirstPage) {
        let textX = MARGIN;
        if (this.logo) {
          const w = this.logo.width * (logoH / this.logo.height);
          this.page.drawImage(this.logo.image, { x: MARGIN, y: this.y - logoH, width: w, height: logoH });
          textX = MARGIN + w + 18;
        } else {
          this.page.drawText(cfg.name, { x: MARGIN, y: this.y - 14, size: 14, font: this.fonts.bold, color: NAVY });
        }
        this.page.drawText(cfg.address, {
          x: textX,
          y: this.y - logoH + 24,
          size: 8.5,
          font: this.fonts.regular,
          color: MUTED,
        });
        this.page.drawText(cfg.contact, {
          x: textX,
          y: this.y - logoH + 12,
          size: 8.5,
          font: this.fonts.regular,
          color: MUTED,
        });
        this.y -= logoH + 14;
      } else {
        if (this.logo) {
          const w = this.logo.width * (logoH / this.logo.height);
          this.page.drawImage(this.logo.image, { x: MARGIN, y: this.y - logoH, width: w, height: logoH });
        } else {
          this.page.drawText(cfg.name, { x: MARGIN, y: this.y - logoH + 8, size: 10, font: this.fonts.bold, color: NAVY });
        }
        this.y -= logoH + 8;
      }

      this.page.drawLine({
        start: { x: MARGIN, y: this.y },
        end: { x: PAGE_WIDTH - MARGIN, y: this.y },
        thickness: 1,
        color: LEAF,
      });
      this.y -= 20;
    }

    ensureSpace(height) {
      if (this.y - height < MARGIN + 24) this.newPage();
    }

    hr(gap = 10) {
      this.ensureSpace(gap + 1);
      this.y -= gap;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y },
        end: { x: PAGE_WIDTH - MARGIN, y: this.y },
        thickness: 0.75,
        color: LINE,
      });
      this.y -= gap;
    }

    text(str, { size = 10, font, color = INK, x = MARGIN, lineGap = 4 } = {}) {
      const f = font || this.fonts.regular;
      this.ensureSpace(size + lineGap);
      this.page.drawText(String(str), { x, y: this.y, size, font: f, color });
      this.y -= size + lineGap;
    }

    /** Wraps `str` to the content width and draws each line via text(). */
    wrappedText(str, opts = {}) {
      const size = opts.size || 10;
      const font = opts.font || this.fonts.regular;
      wrapText(str, font, size, CONTENT_WIDTH).forEach((line) => this.text(line, Object.assign({}, opts, { size, font })));
    }

    paragraph(label, value, { size = 10, labelWidth = 150 } = {}) {
      const bodyFont = this.fonts.regular;
      const labelFont = this.fonts.bold;
      const lines = wrapText(value || '—', bodyFont, size, CONTENT_WIDTH - labelWidth);
      const blockHeight = Math.max(lines.length, 1) * (size + 5);
      this.ensureSpace(blockHeight);

      this.page.drawText(label, { x: MARGIN, y: this.y, size, font: labelFont, color: MUTED });
      let ly = this.y;
      lines.forEach((line) => {
        this.page.drawText(line, { x: MARGIN + labelWidth, y: ly, size, font: bodyFont, color: INK });
        ly -= size + 5;
      });
      this.y = Math.min(this.y - (size + 5), ly);
    }

    /** A label on its own line, followed by a full-width wrapped block below it. */
    fullText(label, value, { size = 10 } = {}) {
      if (label) {
        this.ensureSpace(size + 6);
        this.page.drawText(label, { x: MARGIN, y: this.y, size, font: this.fonts.bold, color: MUTED });
        this.y -= size + 8;
      }
      const lines = wrapText(value || '—', this.fonts.regular, size, CONTENT_WIDTH);
      const blockHeight = Math.max(lines.length, 1) * (size + 5);
      this.ensureSpace(blockHeight);
      lines.forEach((line) => {
        this.page.drawText(line, { x: MARGIN, y: this.y, size, font: this.fonts.regular, color: INK });
        this.y -= size + 5;
      });
    }

    /**
     * A two-column table: a header row, then one row per data row, each
     * cell independently word-wrapped. Used for the Plants/Areas ↔
     * Ornamental Pests/Conditions pairing so the two line up for scanning
     * at a glance rather than reading as one run-on paragraph.
     */
    table(columns, rows) {
      const size = 9.5;
      const xs = [];
      let x = MARGIN;
      columns.forEach((c) => {
        xs.push(x);
        x += c.width;
      });

      this.ensureSpace(size + 14);
      columns.forEach((c, i) => {
        this.page.drawText(c.label, { x: xs[i], y: this.y, size, font: this.fonts.bold, color: NAVY });
      });
      this.y -= size + 6;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y },
        end: { x: MARGIN + CONTENT_WIDTH, y: this.y },
        thickness: 0.75,
        color: LINE,
      });
      this.y -= 10;

      rows.forEach((row, rowIndex) => {
        const wrapped = row.map((cell, i) => wrapText(cell || '—', this.fonts.regular, size, columns[i].width - 12));
        const lineCount = Math.max(...wrapped.map((w) => w.length), 1);
        const rowHeight = lineCount * (size + 4);
        this.ensureSpace(rowHeight + 10);

        wrapped.forEach((lines, i) => {
          let ly = this.y;
          lines.forEach((line) => {
            this.page.drawText(line, { x: xs[i], y: ly, size, font: this.fonts.regular, color: INK });
            ly -= size + 4;
          });
        });
        this.y -= rowHeight + 6;

        if (rowIndex < rows.length - 1) {
          this.page.drawLine({
            start: { x: MARGIN, y: this.y },
            end: { x: MARGIN + CONTENT_WIDTH, y: this.y },
            thickness: 0.5,
            color: LINE,
          });
        }
        this.y -= 8;
      });
    }

    /**
     * A section heading: a small leaf-green accent tab, bold navy title,
     * and an actual leaf-green COLOR BAR spanning the full content width
     * beneath it (not a thin grey hairline — the earlier "the color bars
     * don't carry across the page" report was about the bar never
     * spanning the page width at all, not about page breaks).
     */
    section(str) {
      const size = 12;
      if (this.y - (size + 20) < MARGIN + 24) this.newPage(true);
      this.currentSection = str;
      this.drawSectionBand(str);
    }

    drawSectionBand(str) {
      const size = 12;
      this.y -= 6;
      this.page.drawRectangle({ x: MARGIN, y: this.y - size + 2, width: 4, height: size, color: LEAF });
      this.page.drawText(str, { x: MARGIN + 12, y: this.y, size, font: this.fonts.bold, color: NAVY });
      this.y -= 10;
      this.page.drawRectangle({ x: MARGIN, y: this.y - 2, width: CONTENT_WIDTH, height: 2.5, color: LEAF });
      this.y -= 16;
    }

    /** A small filled dot + label — used for the priority chip on finding pages. */
    chip(label, color) {
      const size = 10;
      const radius = 4;
      this.ensureSpace(size + 6);
      this.page.drawEllipse({
        x: MARGIN + radius,
        y: this.y + size / 2 - 2,
        xScale: radius,
        yScale: radius,
        color,
      });
      this.page.drawText(label, { x: MARGIN + radius * 2 + 6, y: this.y, size, font: this.fonts.bold, color: INK });
      this.y -= size + 10;
    }

    /** Draws the footer on every page once the final page count is known. */
    finish(reportId) {
      const total = this.pages.length;
      const cfg = window.PHC_CONFIG.company;
      this.pages.forEach((p, i) => {
        p.drawText(cfg.legalName, { x: MARGIN, y: 26, size: 7.5, font: this.fonts.regular, color: MUTED });
        p.drawText(`${reportId}  ·  Page ${i + 1} of ${total}`, {
          x: MARGIN,
          y: 16,
          size: 7.5,
          font: this.fonts.regular,
          color: MUTED,
        });
      });
    }
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  async function blobBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** Decodes a photo file into an <img> element (no orientation handling yet — see getOrientedPhotoSource). */
  async function decodePhotoImage(blob) {
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('image decode failed'));
        el.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Reads the EXIF Orientation tag (APP1 segment) directly from JPEG bytes.
   * Returns 1 ("normal") if absent or unparseable. This does not depend on
   * — and is not affected by — whatever orientation handling the browser's
   * own image decoder does.
   */
  function readExifOrientation(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    if (view.getUint16(0, false) !== 0xffd8) return 1;
    const length = view.byteLength;
    let offset = 2;
    while (offset < length - 1) {
      const marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xffe1) {
        if (view.getUint32(offset + 2, false) !== 0x45786966) return 1; // "Exif"
        const tiffOffset = offset + 8;
        const little = view.getUint16(tiffOffset, false) === 0x4949;
        const ifd0Offset = tiffOffset + view.getUint32(tiffOffset + 4, little);
        const tagCount = view.getUint16(ifd0Offset, little);
        for (let i = 0; i < tagCount; i++) {
          const entryOffset = ifd0Offset + 2 + i * 12;
          if (view.getUint16(entryOffset, little) === 0x0112) {
            return view.getUint16(entryOffset + 8, little);
          }
        }
        return 1;
      } else if ((marker & 0xff00) !== 0xff00) {
        break;
      } else {
        offset += view.getUint16(offset, false);
      }
    }
    return 1;
  }

  /**
   * Canvas transform for each of the 8 EXIF orientation values, given the
   * RAW (undecoded-orientation) source bitmap's width/height. Verified
   * against Pillow's own orientation transforms for all 8 values.
   */
  function orientedCanvasFor(orientation, srcW, srcH) {
    const canvas = document.createElement('canvas');
    const swapped = orientation >= 5 && orientation <= 8;
    canvas.width = swapped ? srcH : srcW;
    canvas.height = swapped ? srcW : srcH;
    const ctx = canvas.getContext('2d');
    switch (orientation) {
      case 2: ctx.transform(-1, 0, 0, 1, srcW, 0); break;
      case 3: ctx.transform(-1, 0, 0, -1, srcW, srcH); break;
      case 4: ctx.transform(1, 0, 0, -1, 0, srcH); break;
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
      case 6: ctx.transform(0, 1, -1, 0, srcH, 0); break;
      case 7: ctx.transform(0, -1, -1, 0, srcH, srcW); break;
      case 8: ctx.transform(0, -1, 1, 0, 0, srcW); break;
      default: break; // 1: identity, no transform needed
    }
    return canvas;
  }

  // A tiny (4x2px) synthetic JPEG, tagged with EXIF Orientation=6, baked in
  // once at build time — used only to detect, at runtime, whether this
  // browser's <img> decode already applies EXIF rotation to what canvas
  // drawImage() sees. Chrome does; WebKit/Safari has a long-documented
  // history of rotating the on-screen <img> (which is why in-app previews
  // always looked right) while NOT rotating the same image when it's the
  // source of a canvas drawImage() call — exactly the gap that let a
  // "fixed" (and Chrome-verified) version of this code still ship sideways
  // photos in the field. Detecting this directly, once per session, is
  // more robust than assuming either behavior.
  const EXIF_PROBE_JPEG_B64 =
    '/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAACAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDn6KKK8Y/ST//Z';

  let cachedBrowserAutoRotates = null;

  /** Feature-detects (once per session) whether this engine's <img> decode's orientation survives into canvas drawImage(). */
  async function browserAutoRotatesForCanvas() {
    if (cachedBrowserAutoRotates !== null) return cachedBrowserAutoRotates;
    try {
      const bin = atob(EXIF_PROBE_JPEG_B64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const img = await decodePhotoImage(new Blob([bytes], { type: 'image/jpeg' }));
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      // Source is 4x2 tagged Orientation=6 (rotate 90°): if drawImage() carried
      // the rotation through, the canvas content (and img.naturalWidth itself)
      // ends up portrait (2 wide x 4 tall); if not, it stays 4x2 as stored.
      cachedBrowserAutoRotates = img.naturalWidth === 2 && img.naturalHeight === 4;
    } catch (err) {
      cachedBrowserAutoRotates = true; // decode failed — fall back to the original (Chrome-verified) assumption
    }
    return cachedBrowserAutoRotates;
  }

  /**
   * Resolves a finding photo to whatever should actually be drawn into the
   * PDF: the browser-decoded <img> as-is when this engine's canvas draws
   * already carry its EXIF rotation (verified per-session via the probe
   * above), or — when they don't — a canvas we've rotated ourselves from
   * the EXIF Orientation tag we read directly out of the file's bytes.
   */
  async function getOrientedPhotoSource(blob) {
    const img = await decodePhotoImage(blob);
    const arrayBuffer = await blob.arrayBuffer();
    const orientation = readExifOrientation(arrayBuffer);
    if (orientation === 1 || (await browserAutoRotatesForCanvas())) {
      return { source: img, width: img.naturalWidth, height: img.naturalHeight };
    }
    const canvas = orientedCanvasFor(orientation, img.naturalWidth, img.naturalHeight);
    canvas.getContext('2d').drawImage(img, 0, 0);
    return { source: canvas, width: canvas.width, height: canvas.height };
  }

  /** Re-encodes an oriented photo source ({source, width, height}) as JPEG, downscaled to maxDimension on its longest side, at the given quality. */
  function encodePhotoJpeg(oriented, maxDimension, quality) {
    const scale = Math.min(1, maxDimension / Math.max(oriented.width, oriented.height));
    const w = Math.max(1, Math.round(oriented.width * scale));
    const h = Math.max(1, Math.round(oriented.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(oriented.source, 0, 0, w, h);
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas encode failed'))), 'image/jpeg', quality);
    });
  }

  /** Embeds an oriented photo source, scaled (never upscaled) to fit within a bounding box, re-encoded at the given size/quality budget. */
  async function embedFitted(doc, orientedSource, photoSettings, maxWidth, maxHeight) {
    const jpegBlob = await encodePhotoJpeg(orientedSource, photoSettings.maxDimension, photoSettings.quality);
    const bytes = await blobBytes(jpegBlob);
    const image = await doc.embedJpg(bytes);
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    return { image, width: image.width * scale, height: image.height * scale };
  }

  // Successive quality/size budgets tried, largest first, until the whole
  // PDF fits under MAX_PDF_BYTES. Kept as a fixed ladder (rather than a
  // binary search) since each step is cheap and reports rarely need more
  // than the first one or two.
  const PHOTO_SIZE_STEPS = [
    { maxDimension: 1600, quality: 0.78 },
    { maxDimension: 1400, quality: 0.7 },
    { maxDimension: 1200, quality: 0.62 },
    { maxDimension: 1000, quality: 0.55 },
    { maxDimension: 850, quality: 0.48 },
    { maxDimension: 700, quality: 0.4 },
    { maxDimension: 550, quality: 0.35 },
  ];
  const MAX_PDF_BYTES = 2 * 1000 * 1000; // 2.0 MB deliverable ceiling

  /** Renders one plant/area entry's conditions as a single cell string. */
  function conditionsCell(entry) {
    const parts = [];
    if (entry.conditions && entry.conditions.length) parts.push(entry.conditions.join(', '));
    if (entry.otherSpecify && entry.otherSpecify.trim()) parts.push(entry.otherSpecify.trim());
    return parts.join(' — ') || '—';
  }

  /**
   * Estimated height (points) the four finding text fields will take when
   * drawn via paragraph() at FINDING_TEXT_SIZE/FINDING_LABEL_WIDTH — used
   * to size the photo so it and its text both fit on one page together,
   * rather than a fixed photo size that ignores how much text comes with it.
   */
  function estimateFindingTextHeight(fonts, finding) {
    const fields = [finding.plantArea, finding.location, finding.observation, finding.recommendation];
    return fields.reduce((total, value) => {
      const lines = wrapText(value || '—', fonts.regular, FINDING_TEXT_SIZE, CONTENT_WIDTH - FINDING_LABEL_WIDTH);
      return total + Math.max(lines.length, 1) * (FINDING_TEXT_SIZE + 5);
    }, 0);
  }

  /**
   * Builds the report PDF for a visit and its findings.
   * @returns {Promise<Uint8Array>}
   */
  async function generateReportPdf(visit, findings) {
    const reportId = window.PhcLogic.reportId(visit);
    const findingList = findings || [];

    // Decode (and thereby orientation-correct) every finding photo exactly
    // once. Each size attempt below re-encodes from this same oriented
    // source rather than re-decoding the original file each time.
    const decodedPhotos = new Map();
    for (const finding of findingList) {
      if (!finding.photoBlob) continue;
      try {
        decodedPhotos.set(finding, await getOrientedPhotoSource(finding.photoBlob));
      } catch (err) {
        decodedPhotos.set(finding, null);
      }
    }

    /** Builds the full PDF at a given photo size/quality budget. */
    async function buildDocument(photoSettings) {
      const doc = await PDFDocument.create();
      doc.setTitle(`${reportId} — ${visit.visitType}`);
      doc.setProducer('RTEC PHC Field Reporting (offline)');

      const fonts = {
        regular: await doc.embedFont(StandardFonts.Helvetica),
        bold: await doc.embedFont(StandardFonts.HelveticaBold),
      };

      let logo = null;
      const logoBytes = await loadLogoBytes();
      if (logoBytes) {
        try {
          const image = await doc.embedJpg(logoBytes);
          logo = { image, width: image.width, height: image.height };
        } catch (err) {
          logo = null; // fall back to text letterhead
        }
      }

      const w = new ReportWriter(doc, fonts, logo);
      const cfg = window.PHC_CONFIG;

      // ---------------------------------------------------------------
      // Page 1 — visit summary (the playbook's established Page 1 logic)
      // ---------------------------------------------------------------
      w.text(cfg.reportTitle, { size: 17, font: fonts.bold, color: NAVY });
      w.text(`${reportId}  ·  ${visit.visitType}  ·  Generated ${formatDateTime(new Date().toISOString())}`, {
        size: 8.5,
        color: MUTED,
      });
      w.y -= 6;

      // No general arborist-notification note at the top of the report —
      // that context now lives on the specific finding that triggered it
      // (see the finding loop below), which is more precise than a blanket
      // statement at the top when only one of several findings needs it.

      w.section('Visit Information');
      w.paragraph('SingleOps Visit ID', visit.singleOpsVisitId);
      w.paragraph('Client', visit.clientName);
      w.paragraph('Property Address', visit.propertyAddress);
      w.paragraph('Technician', visit.technician);
      w.paragraph('Visit Date/Time', formatDateTime(visit.visitDateTime));

      w.section('Services Performed');
      w.paragraph('Services', (visit.servicesPerformed || []).join(', '));

      w.section('Plants, Conditions, and Materials');
      const entries = visit.plantEntries || [];
      if (entries.length > 0) {
        w.table(
          [
            { label: 'Plant / Area', width: CONTENT_WIDTH * 0.36 },
            { label: 'Ornamental Pests / Conditions', width: CONTENT_WIDTH * 0.64 },
          ],
          entries.map((e) => [e.plantArea, conditionsCell(e)])
        );
      } else {
        w.text('No plants/areas recorded.', { size: 10, color: MUTED });
      }

      w.section('Treatment Details');
      w.fullText(null, visit.treatmentDetails);

      w.section('Follow-Up Notes and Recommendations');
      w.fullText(null, visit.followUpNotes && visit.followUpNotes.trim() ? visit.followUpNotes : '—');

      // Flags: only worth a reader's attention when something was actually
      // flagged. A routine visit with nothing pressing doesn't need a
      // "No / No" section taking up space.
      if (visit.pressingIssueObserved) {
        w.section('Flags');
        w.paragraph('Pressing Issue Observed', 'Yes');
        w.paragraph('Arborist-Requested Photos', visit.arboristRequestedPhotos ? 'Yes' : 'No');
      }

      // ---------------------------------------------------------------
      // Finding pages — one finding per page, only when findings exist
      // (playbook section 4/6). No cap on how many findings a visit can
      // have. The photo is sized to fill whatever room is left after its
      // own text, rather than a fixed size, so the pair fits one page
      // together.
      // ---------------------------------------------------------------
      w.currentSection = null; // finding pages carry their own heading, not a section band

      if (findingList.length > 0) {
        for (const finding of findingList) {
          w.newPage(true);
          w.text(`Finding ${finding.sequence} of ${findingList.length}`, { size: 15, font: fonts.bold, color: NAVY });

          if (finding.arboristReviewRequired) {
            w.wrappedText('Arborist has been notified of this finding. Please contact for further RTEC action.', {
              size: 8.5,
              color: ALERT_BORDER,
              font: fonts.bold,
            });
          }

          w.chip(finding.priority || 'Routine', PRIORITY_COLORS[finding.priority] || PRIORITY_COLORS.Routine);
          w.hr(6);

          if (finding.photoBlob) {
            const maxW = CONTENT_WIDTH;
            const bottomLimit = MARGIN + 24;
            const estimatedTextHeight = estimateFindingTextHeight(fonts, finding);
            const available = w.y - bottomLimit - estimatedTextHeight - 24;
            const maxH = Math.max(140, Math.min(available, 480));
            const orientedPhoto = decodedPhotos.get(finding);

            if (orientedPhoto) {
              try {
                const fitted = await embedFitted(doc, orientedPhoto, photoSettings, maxW, maxH);
                w.ensureSpace(fitted.height + 16);
                const x = MARGIN + (maxW - fitted.width) / 2;
                const y = w.y - fitted.height;
                w.page.drawRectangle({
                  x: x - 1,
                  y: y - 1,
                  width: fitted.width + 2,
                  height: fitted.height + 2,
                  borderColor: LINE,
                  borderWidth: 1,
                });
                w.page.drawImage(fitted.image, { x, y, width: fitted.width, height: fitted.height });
                w.y -= fitted.height + 16;
              } catch (err) {
                w.text('[Photo could not be embedded — original is retained in the app.]', {
                  size: 9,
                  color: ALERT_BORDER,
                });
              }
            } else {
              w.text('[Photo could not be embedded — original is retained in the app.]', {
                size: 9,
                color: ALERT_BORDER,
              });
            }
          }

          w.paragraph('Plant / Area', finding.plantArea, { labelWidth: FINDING_LABEL_WIDTH });
          w.paragraph('Location', finding.location, { labelWidth: FINDING_LABEL_WIDTH });
          w.paragraph('Observation', finding.observation, { labelWidth: FINDING_LABEL_WIDTH });
          w.paragraph('Recommendation', finding.recommendation, { labelWidth: FINDING_LABEL_WIDTH });
        }
      }

      w.finish(reportId);

      return doc.save({ useObjectStreams: true });
    }

    let bytes = await buildDocument(PHOTO_SIZE_STEPS[0]);
    for (let i = 1; i < PHOTO_SIZE_STEPS.length && bytes.length > MAX_PDF_BYTES; i++) {
      bytes = await buildDocument(PHOTO_SIZE_STEPS[i]);
    }
    if (bytes.length > MAX_PDF_BYTES) {
      console.warn(
        `PHC report ${reportId}: could not compress under the 2.0 MB target (final size ${(bytes.length / 1e6).toFixed(2)} MB).`
      );
    }
    return bytes;
  }

  /** Builds the report filename per the playbook's expression (section 1 / 5). */
  function reportFilename(visit) {
    const datePart = (visit.visitDateTime || new Date().toISOString()).slice(0, 10);
    const typePart = String(visit.visitType || 'Visit').replace(/\s+/g, '-');
    const idPart = window.PhcLogic.reportId(visit).replace(/\s+/g, '-');
    return `${idPart}-${typePart}-${datePart}.pdf`;
  }

  window.PhcReport = { generateReportPdf, reportFilename };
})();
