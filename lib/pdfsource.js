// PDF okuma: metin katmanı, görsel algılama, sayfa görüntüsü
import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
import { normalizeText } from "./turkish.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

export async function openPdf(arrayBuffer) {
  const doc = await pdfjsLib.getDocument({
    data: arrayBuffer,
    cMapUrl: new URL("../vendor/pdfjs/cmaps/", import.meta.url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href,
    isEvalSupported: false,
  }).promise;
  let info = {};
  try { info = (await doc.getMetadata()).info || {}; } catch (e) {}
  return { doc, numPages: doc.numPages, info };
}

// Sayfanın büyük bölümünü kaplayan bir resim var mı? (taranmış sayfa)
export async function pageImageCoverage(page) {
  const ops = await page.getOperatorList();
  const O = pdfjsLib.OPS;
  const vp = page.getViewport({ scale: 1 });
  const pageArea = vp.width * vp.height;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let best = 0;
  const mul = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === O.transform) ctm = mul(ctm, ops.argsArray[i]);
    else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageXObjectRepeat || fn === O.paintJpegXObject) {
      const w = Math.hypot(ctm[0], ctm[1]);
      const h = Math.hypot(ctm[2], ctm[3]);
      best = Math.max(best, (w * h) / pageArea);
    }
  }
  return best;
}

// Metin katmanını satırlara dönüştürür (görünüm koordinatlarında, y aşağı doğru)
export async function textLayerLines(page) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent({ disableNormalization: false });
  const items = [];
  for (const it of tc.items) {
    if (!("str" in it)) continue;
    const str = normalizeText(it.str, true);
    const m = pdfjsLib.Util.transform(vp.transform, it.transform);
    const fh = Math.hypot(m[2], m[3]) || Math.abs(it.height) || 10;
    const x = m[4], yBase = m[5];
    items.push({ str, x, x1: x + (it.width || 0) * (vp.scale || 1), yBase, h: fh, eol: it.hasEOL });
  }
  // satırlara grupla
  items.sort((a, b) => a.yBase - b.yBase || a.x - b.x);
  const lines = [];
  for (const it of items) {
    if (!it.str.trim()) { continue; }
    let L = lines.find((l) => Math.abs(l.yBase - it.yBase) < Math.max(l.h, it.h) * 0.45);
    if (!L) { L = { yBase: it.yBase, h: it.h, items: [] }; lines.push(L); }
    L.items.push(it);
    L.h = Math.max(L.h, it.h);
  }
  const out = [];
  for (const L of lines) {
    L.items.sort((a, b) => a.x - b.x);
    let text = "";
    let prev = null;
    for (const it of L.items) {
      if (prev) {
        const gap = it.x - prev.x1;
        const soft = /\u00AD$/.test(text) || /^\u00AD/.test(it.str);
        if (!soft && gap > L.h * 0.12 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += " ";
      }
      text += it.str;
      prev = it;
    }
    text = text.replace(/\s+/g, " ").trim();
    // satır sonundaki yumuşak tire = heceleme tiresi; diğerleri atılır
    text = text.replace(/\u00AD\s*$/, "-").replace(/\u00AD/g, "");
    text = text.replace(/[¬]\s*$/, "-");
    if (!text) continue;
    out.push({
      text,
      words: text.split(" ").map((t) => ({ t, c: 100 })),
      x0: L.items[0].x,
      x1: Math.max(...L.items.map((i) => i.x1)),
      y0: L.yBase - L.h * 0.8,
      y1: L.yBase + L.h * 0.2,
      h: L.h,
    });
  }
  out.sort((a, b) => a.y0 - b.y0);
  return { lines: out, width: vp.width, height: vp.height };
}

// Sayfayı OCR için tuvale çizer
export async function renderPage(page, { dpi = 300, maxSide = 2600 } = {}) {
  let scale = dpi / 72;
  const vp1 = page.getViewport({ scale: 1 });
  const longest = Math.max(vp1.width, vp1.height) * scale;
  if (longest > maxSide) scale *= maxSide / longest;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, intent: "print" }).promise;
  return { canvas, scale };
}

export async function renderCover(page, maxSide = 1600) {
  const { canvas } = await renderPage(page, { dpi: 200, maxSide });
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.88));
  canvas.width = canvas.height = 0;
  return blob;
}
