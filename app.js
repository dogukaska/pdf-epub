import { openPdf, pageImageCoverage, textLayerLines, renderPage, renderCover } from "./lib/pdfsource.js?v=20261126f";
import { createOcrPool } from "./lib/ocr.js?v=20261126e";
import { loadDict } from "./lib/dict.js?v=20261126e";
import { reconcilePage, buildBookVocab, makeScorer, correctWord, needsRescan, applyRescan, finalConfidence, markFragments, shouldJoin } from "./lib/reconcile.js?v=20261126e";
import { analyze } from "./lib/layout.js?v=20261126e";
import { buildEpub } from "./lib/epub.js?v=20261126f";
import { normalizeText, hasMojibake, fixMojibake, textQuality, typography, escapeXml } from "./lib/turkish.js?v=20261126e";

const $ = (id) => document.getElementById(id);
const state = { file: null, pdf: null, pages: null, scannedCovers: null, covers: null, sections: null };
let fileRequest = 0;
let converting = false;

// ---------- Dosya seçimi
const drop = $("drop");
$("file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) pickFile(file);
});
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) pickFile(f); });

function guessTitle(name) {
  return name.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

async function pickFile(file, scannedCovers = null) {
  if (converting) return;
  const request = ++fileRequest;
  const previous = state.pdf;
  Object.assign(state, { file: null, pdf: null, pages: null, scannedCovers: null, covers: null, sections: null });
  for (const id of ["step-opts", "step-run", "step-review"]) $(id).classList.add("hidden");
  $("preview").replaceChildren();
  for (const id of ["m-title", "m-author", "m-translator", "m-publisher"]) $(id).value = "";
  previous?.doc.destroy().catch(console.error);
  $("drop-text").textContent = `${file.name} açılıyor…`;
  $("file-status").textContent = "";
  try {
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) throw new Error("Lütfen bir PDF dosyası seç.");
    if (!file.size) throw new Error("Bu PDF dosyası boş.");
    const pdf = await openPdf(await file.arrayBuffer());
    if (request !== fileRequest) {
      await pdf.doc.destroy();
      return;
    }
    state.pdf = pdf;
    state.file = file;
    state.scannedCovers = scannedCovers;
  } catch (e) {
    if (request !== fileRequest) return;
    $("drop-text").textContent = "Başka bir dosya seç veya buraya sürükle";
    $("file-status").textContent = file.size && (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name))
      ? "PDF açılamadı. Dosya bozuk ya da şifreli olabilir."
      : e.message;
    return;
  }
  $("file-status").textContent = "";
  $("drop-text").textContent = `${file.name} (${(file.size / 1048576).toFixed(1)} MB)`;
  const info = state.pdf.info || {};
  const clean = (s) => (s ? normalizeText(String(s)).trim() : "");
  const title = clean(info.Title);
  $("m-title").value = title && !/^(untitled|about:blank|microsoft word|adsız)$|\.(docx?|pdf|indd|odt)$/i.test(title)
    ? title : guessTitle(file.name);
  $("m-author").value = clean(info.Author);
  $("pdf-info").textContent = `${state.pdf.numPages} sayfa bulundu.`;
  $("step-opts").classList.remove("hidden");
  $("step-opts").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Dönüştürme
$("go").addEventListener("click", async () => {
  if (converting || !state.pdf) return;
  converting = $("file").disabled = $("go").disabled = true;
  try {
    await convert();
  } catch (e) {
    console.error(e);
    setStatus("Bir hata oluştu: " + (e.message || e));
  } finally {
    if (activePool) { await activePool.terminate().catch(() => {}); activePool = null; }
    await keepAwake(false);
    converting = $("file").disabled = $("go").disabled = false;
  }
});
let activePool = null;

function setStatus(t, frac) {
  $("status").textContent = t;
  if (frac != null) $("bar-fill").style.width = `${Math.round(frac * 100)}%`;
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) {}
}

function poolSize() {
  const cores = navigator.hardwareConcurrency || 2;
  const mem = navigator.deviceMemory || 4;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  let n = Math.max(1, Math.min(4, cores - 1));
  if (mobile || mem <= 2) return 1;
  if (mem <= 4) n = Math.min(n, 2);
  return n;
}

async function convert() {
  $("step-run").classList.remove("hidden");
  $("step-review").classList.add("hidden");
  $("step-run").scrollIntoView({ behavior: "smooth", block: "start" });
  await keepAwake(true);
  const t0 = performance.now();
  const { doc, numPages } = state.pdf;
  const mode = $("o-mode").value;            // "best" | "fast"
  const dpi = parseInt($("o-dpi").value, 10);
  const coverFirst = state.scannedCovers?.front === true;
  const backCoverLast = state.scannedCovers?.back === true;
  const firstPage = coverFirst ? 2 : 1;
  const lastPage = backCoverLast ? numPages - 1 : numPages;
  if (firstPage > lastPage) throw Error("EPUB için Belge Tarayıcı’da en az bir iç sayfa ekle.");
  const dictPromise = loadDict(new URL("lang/tr-words.txt.gz", location.href).href);
  dictPromise.catch(() => {});

  // 1) PDF'in kendi metnini incele
  const pages = [];
  let repairedPages = 0;
  for (let i = 1; i <= numPages; i++) {
    if (i < firstPage || i > lastPage) {
      pages.push({n:i, layer:{lines:[],width:0,height:0}});
      continue;
    }
    setStatus(`PDF inceleniyor: sayfa ${i}/${numPages}`, (i / numPages) * 0.05);
    const page = await doc.getPage(i);
    const cov = await pageImageCoverage(page).catch(() => 0);
    try {
      const layer = await textLayerLines(page).catch(() => {
        const {width,height} = page.getViewport({scale:1});
        return {lines:[],width,height};
      });
      const raw = layer.lines.map(l => l.text).join("\n");
      if (hasMojibake(raw) >= 2) {
        repairedPages++;
        for (const line of layer.lines) {
          for (const word of line.words) word.t = fixMojibake(word.t);
          line.text = line.words.map(w => w.t).join(" ");
        }
      }
      const layerText = layer.lines.map(l => l.text).join("\n");
      const words = layer.lines.flatMap(line => line.words);
      const quality = textQuality(words.map(w => w.t));
      const trusted = cov < .55 && (words.length >= 12 || cov < .15) && words.length > 0 && quality >= .84
        && !/[\uE000-\uF8FF\uFFFD]/u.test(layerText)
        && hasMojibake(layerText) === 0;
      if (trusted) words.forEach(word => { word.agree = true; });
      pages.push({ n:i, layer, layerText, trusted, usefulLayer:words.length >= 5 && quality > .45 });
    } finally {
      page.cleanup();
    }
  }
  const work = pages.slice(firstPage - 1,lastPage);
  const scanPages = work.filter(p => !p.trusted);
  const useOcr = scanPages.length > 0;

  // 2) Kapak
  const covers = {};
  async function loadCover(n,label) {
    setStatus(label+" hazırlanıyor…",0.05);
    const page = await doc.getPage(n);
    try {
      const image = await renderCover(page);
      if (!image) throw Error();
      return image;
    } catch {
      throw Error(label+" görsele dönüştürülemedi.");
    } finally { page.cleanup(); }
  }
  if (coverFirst) covers.front = await loadCover(1,"Ön kapak");
  // Dosyadan açılan kitaplarda ilk sayfa eskisi gibi kapak görselidir; metni de işlenir.
  if (!state.scannedCovers && numPages > 1) {
    covers.front = await loadCover(1,"Ön kapak").catch(() => null);
  }
  if (backCoverLast) covers.back = await loadCover(numPages,"Arka kapak");
  state.covers = covers;

  setStatus("Türkçe sözlük yükleniyor…", 0.05);
  await dictPromise.catch((e) => console.warn("sözlük yok", e));

  const stats = { fromLayer: 0, corrected: 0, rescannedLines: 0, rescanFixes: 0 };
  let pool = null;

  // 3) OCR
  if (useOcr) {
    const size = Math.min(poolSize(), scanPages.length);
    pool = activePool = await createOcrPool(size, (t) => setStatus(t, 0.06));
    let done = 0;
    const tStart = performance.now();
    const queue = [...scanPages];
    const total = queue.length;
    async function runner() {
      while (queue.length) {
        const item = queue.shift();
        const page = await doc.getPage(item.n);
        let canvas;
        try {
          const raster = await renderPage(page, { dpi, maxSide: dpi >= 400 ? 3400 : 2700 });
          canvas = raster.canvas;
          const lines = await pool.recognize(canvas);
          if (lines.length) item.ocr = {lines, width:canvas.width, height:canvas.height, pxPerPt:raster.scale};
        } finally {
          if (canvas) canvas.width = canvas.height = 0;
          page.cleanup();
        }
        done++;
        const el = (performance.now() - tStart) / 1000;
        setStatus(`1. tarama (Türkçe OCR): sayfa ${done}/${total} · kalan yaklaşık ${fmtTime((el / done) * (total - done))}`, 0.07 + (done / total) * 0.6);
      }
    }
    const completed = await Promise.allSettled(Array.from({ length: size }, runner));
    const failure = completed.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
  }

  const structPages = () => pages.map((p) => (p.ocr ? p.ocr : { lines: p.layer.lines, width: p.layer.width, height: p.layer.height }));
  for (const p of structPages()) for (const l of p.lines) l.words.forEach((w) => (w.t = normalizeText(w.t)));

  // 4) İki kaynağı karşılaştır
  let score = makeScorer(buildBookVocab(structPages()));
  if (scanPages.some(p => p.ocr && p.usefulLayer)) {
    setStatus("OCR ile PDF metni kelime kelime karşılaştırılıyor…", 0.68);
    for (const p of work) {
      if (!p.ocr || !p.usefulLayer) continue;
      stats.fromLayer += reconcilePage(p.ocr.lines, p.layerText, { score, layerTrusted:false });
      await tick();
    }
    score = makeScorer(buildBookVocab(structPages()));
  }

  markFragments(structPages());

  // 6) Şüpheli satırları yüksek çözünürlükte yeniden tara
  if (useOcr && mode === "best") {
    const targets = [];
    for (const p of work) {
      if (!p.ocr) continue;
      const ls = p.ocr.lines.filter((l) => l.words.some((w) => needsRescan(w, score)));
      if (ls.length) targets.push({ p, ls });
    }
    const totalLines = Math.min(800, targets.reduce((n, t) => n + t.ls.length, 0));
    let doneLines = 0;
    const tStart = performance.now();
    let budget = totalLines;
    for (const { p, ls: all } of targets) {
      if (budget <= 0) break;
      const ls = all.slice(0, budget);
      budget -= ls.length;
      const page = await doc.getPage(p.n);
      const hiDpi = Math.min(dpi * 1.7, 520);
      const { canvas, scale } = await renderPage(page, { dpi: hiDpi, maxSide: 4400 });
      const f = scale / p.ocr.pxPerPt;
      await Promise.all(ls.map(async (line) => {
        const pad = line.h * 0.35;
        const x = Math.max(0, (line.x0 - pad) * f), y = Math.max(0, (line.y0 - pad) * f);
        const w = Math.min(canvas.width - x, (line.x1 - line.x0 + pad * 2) * f);
        const h = Math.min(canvas.height - y, (line.y1 - line.y0 + pad * 2) * f);
        if (w < 8 || h < 8) return;
        const crop = document.createElement("canvas");
        crop.width = Math.round(w); crop.height = Math.round(h);
        const cx = crop.getContext("2d");
        cx.fillStyle = "#fff"; cx.fillRect(0, 0, crop.width, crop.height);
        cx.drawImage(canvas, x, y, w, h, 0, 0, crop.width, crop.height);
        // tek satırın okunamaması tüm dönüşümü durdurmasın
        const words = await pool.recognizeLine(crop).catch((e) => { console.warn("satır okunamadı", e); return null; });
        crop.width = crop.height = 0;
        if (words) stats.rescanFixes += applyRescan(line, words, score);
        doneLines++;
        stats.rescannedLines++;
        const el = (performance.now() - tStart) / 1000;
        setStatus(`2. tarama (şüpheli satırlar): ${doneLines}/${totalLines} · kalan yaklaşık ${fmtTime((el / doneLines) * (totalLines - doneLines))}`, 0.74 + (doneLines / Math.max(1, totalLines)) * 0.22);
      }));
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  }
  if (pool) { await pool.terminate(); activePool = null; }

  for (const p of structPages()) for (const l of p.lines) l.text = l.words.map((w) => w.t).join(" ");

  if (!work.some(p => (p.ocr || p.layer).lines.length)) throw Error("Okunabilir metin bulunamadı. Daha net bir PDF dene.");

  // 8) Yapıyı çıkar
  setStatus("Bölümler ve paragraflar düzenleniyor…", 0.97);
  state.pages = pages.slice(0,lastPage).map(p => {
    if (!p.ocr) return p.layer;
    const { lines,width,height,pxPerPt } = p.ocr;
    const size = key => key / pxPerPt;
    return {width:size(width),height:size(height),lines:lines.map(l => ({
      ...l, x0:size(l.x0), x1:size(l.x1), y0:size(l.y0), y1:size(l.y1), h:size(l.h),
    }))};
  });
  const { sections } = analyze(state.pages, { coverFirst, score });
  if (!sections.some(s => s.paras.some(p => p.words.length) || s.notes.length)) throw Error("EPUB oluşturmak için okunabilir metin bulunamadı.");

  // 7) Birleştirilmiş tam kelimeleri sözlük ve kitabın kendi kelimeleriyle düzelt
  setStatus("Türkçe sözlükle kelimeler kontrol ediliyor…", 0.98);
  score = makeScorer(buildBookVocab(state.pages));
  const finalWords = [];
  for (const s of sections) {
    for (const p of s.paras) finalWords.push(...p.words);
    for (const n of s.notes) for (const line of n.lines) finalWords.push(...line);
  }
  // konuşma dili "bi’" (bir): OCR'ın "b”", "b?", "bi”" diye okuduğu biçimler
  for (const s of sections) for (const p of s.paras) p.words.forEach((w, i) => {
    const next = p.words[i + 1];
    const m = w.t.match(/^([“"‘']?)([bB])(i?)[”?"'’]$/);
    if (!w.agree && m && next && /^[a-zçğıöşü]/.test(next.t) && (m[3] || w.c < 90)) { w.t = `${m[1]}${m[2]}i’`; w.c = Math.max(w.c, 85); }
  });
  let k = 0;
  for (const w of finalWords) {
    if (/[-‐¬]$/.test(w.t)) continue;
    if (correctWord(w, score)) stats.corrected++;
    finalConfidence(w, score);
    if (++k % 3000 === 0) await tick();
  }
  state.sections = sections;
  state.score = score;
  renderPreview(sections);

  const secs = (performance.now() - t0) / 1000;
  const chapters = sections.filter((s) => s.kind === "chapter").length;
  const paras = sections.reduce((n, s) => n + s.paras.length, 0);
  const parts = [`${numPages} sayfa ${fmtTime(secs)} içinde işlendi`];
  if (covers.front || covers.back) {
    const labels = [covers.front && "ön kapak",covers.back && "arka kapak"].filter(Boolean);
    parts.push(labels.join(" ve ") + " renkli görsel olarak eklendi");
  }
  if (work.length > scanPages.length) parts.push(`${work.length - scanPages.length} sayfada PDF metni korundu`);
  if (useOcr) parts.push(`${scanPages.length} sayfa Türkçe OCR ile incelendi`);
  if (repairedPages) parts.push(`${repairedPages} sayfada Türkçe kodlama düzeltildi`);
  const missing = work.filter(p => !(p.ocr || p.layer).lines.length).map(p => p.n);
  if (missing.length) parts.push(`metin bulunamayan sayfalar: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}`);
  if (stats.corrected + stats.rescanFixes) parts.push(`${stats.corrected + stats.rescanFixes} kelime düzeltildi`);
  if (stats.rescannedLines) parts.push(`${stats.rescannedLines} satır yeniden tarandı`);
  parts.push(`${chapters} bölüm, ${paras} paragraf`);
  $("summary").textContent = parts.join(" · ") + ".";
  setStatus("Bitti.", 1);
  $("step-run").classList.add("hidden");
  $("step-review").classList.remove("hidden");
  $("step-review").scrollIntoView({ behavior: "smooth", block: "start" });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function fmtTime(s) {
  s = Math.round(s);
  if (s < 60) return `${s} sn`;
  return `${Math.floor(s / 60)} dk ${s % 60} sn`;
}

// ---------- Önizleme (düzenlenebilir)
const LOW = 72;

function wordsToHtml(words, noteLabels = new Map()) {
  // \u0001/\u0002: şüpheli kelime sınırı, \u0003n\u0003: dipnot işareti
  const parts = words.map((w) => {
    let t = w.t;
    if (w.ref) {
      const pos = Math.min(w.refPos ?? t.length, t.length);
      t = t.slice(0, pos) + `\u0003${w.ref}\u0003` + t.slice(pos);
    }
    return w.c < LOW && !w.fixed ? `\u0001${w.p || 0}\u0001${t}\u0002` : t;
  });
  let s = typography(parts.join(" "));
  s = escapeXml(s);
  s = s.replace(/\u0001(\d+)\u0001/g,'<mark data-page="$1">').replace(/\u0002/g,"</mark>");
  s = s.replace(/\u0003(\d+)\u0003/g,(_,id) => `<sup class="ref" contenteditable="false" data-ref="${id}">${escapeXml(noteLabels.get(Number(id)) || "*")}</sup>`);
  return s;
}

function noteText(n) {
  const words = [];
  for (const line of n.lines) {
    line.forEach((w, j) => {
      const prev = words[words.length - 1];
      if (j === 0 && prev && /[A-Za-zçğıöşüÇĞİÖŞÜ]-$/.test(prev.t) && /^[a-zçğıöşü]/.test(w.t)) prev.t = prev.t.slice(0,-1) + w.t;
      else if (j === 0 && prev && !(prev.agree && w.agree) && state.score && shouldJoin(prev.t,w.t,state.score)) prev.t = prev.t + w.t;
      else words.push({ ...w, p:n.page });
    });
  }
  return words;
}

function renderPreview(sections) {
  const root = $("preview");
  root.innerHTML = "";
  lowIdx = -1;
  reviewPage = 0;
  $("review-source").textContent = "";
  $("show-source").hidden = true;
  sections.forEach(s => {
    const sec = document.createElement("div");
    sec.className = "sec";
    sec.dataset.kind = s.kind;
    const head = document.createElement("div");
    head.className = "sec-head";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = s.title;
    inp.className = "sec-title";
    const del = document.createElement("button");
    del.textContent = "Sil";
    del.title = "Bu bölümü EPUB'a ekleme";
    del.addEventListener("click", () => {
      sec.classList.toggle("removed");
      del.textContent = sec.classList.contains("removed") ? "Geri al" : "Sil";
      updateLowCount();
    });
    head.append(inp, del);
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = s.kind === "front" ? "ön sayfalar" : s.kind === "back" ? "arka kapak" : `${s.paras.length} paragraf`;
    head.append(badge);
    const body = document.createElement("div");
    body.className = "sec-body";
    const noteLabels = new Map(s.notes.map(n => [n.id,n.mark]));
    for (const p of s.paras) {
      if (!p.words.length) continue;
      const el = document.createElement("p");
      if (p.cls) el.className = p.cls;
      el.contentEditable = "true";
      el.spellcheck = false;
      el.lang = "tr";
      el.innerHTML = wordsToHtml(p.words,noteLabels);
      body.append(el);
    }
    if (s.notes.length) {
      const nb = document.createElement("div");
      nb.className = "notes";
      s.notes.forEach((n) => {
        const el = document.createElement("p");
        el.contentEditable = "true";
        el.dataset.note = n.id;
        el.dataset.noteLabel = n.mark || "*";
        el.innerHTML = `<sup class="ref" contenteditable="false">${escapeXml(n.mark || "*")}</sup> ` + wordsToHtml(noteText(n));
        nb.append(el);
      });
      body.append(nb);
    }
    sec.append(head, body);
    root.append(sec);
  });
  updateLowCount();
}

let lowIdx = -1, reviewPage = 0;
function updateLowCount() {
  const marks = [...document.querySelectorAll("#preview .sec:not(.removed) mark")];
  $("low-count").textContent = marks.length;
}
$("next-low").addEventListener("click", () => {
  const marks = [...document.querySelectorAll("#preview .sec:not(.removed) mark")];
  if (!marks.length) return;
  document.querySelectorAll("mark.current").forEach((m) => m.classList.remove("current"));
  lowIdx = (lowIdx + 1) % marks.length;
  const m = marks[lowIdx];
  m.classList.add("current");
  reviewPage = Number(m.dataset.page);
  $("review-source").textContent = reviewPage ? `Kaynak PDF sayfası: ${reviewPage}` : "";
  $("show-source").hidden = !reviewPage;
  m.scrollIntoView({ behavior: "smooth", block: "center" });
});

const sourceDialog = $("source-dialog");
let sourceRequest = 0;
$("show-source").addEventListener("click",async () => {
  const doc = state.pdf?.doc, n = reviewPage;
  if (!doc || !n || sourceDialog.open) return;
  const request = ++sourceRequest;
  const title = $("source-title");
  title.textContent = `PDF · Sayfa ${n}`;
  $("source-status").textContent = "Sayfa hazırlanıyor…";
  sourceDialog.showModal();
  let page, canvas;
  try {
    page = await doc.getPage(n);
    ({canvas} = await renderPage(page,{dpi:135,maxSide:1550}));
    if (request !== sourceRequest || !sourceDialog.open) return;
    canvas.setAttribute("role","img");
    canvas.setAttribute("aria-label",title.textContent);
    $("source-image").append(canvas);
    canvas = null;
    $("source-status").textContent = "";
  } catch {
    if (request === sourceRequest) $("source-status").textContent = "Kaynak sayfa gösterilemedi.";
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    page?.cleanup();
  }
});
$("close-source").addEventListener("click",() => sourceDialog.close());
sourceDialog.addEventListener("close",() => {
  sourceRequest++;
  const canvas = $("source-image").querySelector("canvas");
  if (canvas) canvas.width = canvas.height = 0;
  $("source-image").replaceChildren();
});
// Düzeltilen şüpheli kelimenin işaretini kaldır
$("preview").addEventListener("input", (e) => {
  const sel = window.getSelection();
  const node = sel && sel.anchorNode;
  const mark = node && (node.nodeType === 1 ? node : node.parentElement)?.closest("mark");
  if (mark) { mark.replaceWith(...mark.childNodes); updateLowCount(); }
});

function readSegments(el) {
  const segs = [];
  function add(text) {
    const clean = normalizeText(text).replace(/\s+/g," ");
    const last = segs.at(-1);
    if (last && last.text != null) last.text = (last.text + clean).replace(/ {2,}/g," ");
    else segs.push({text:clean});
  }
  const walk = (node) => {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) add(ch.nodeValue);
      else if (ch.nodeType === 1) {
        if (ch.matches("sup.ref")) {
          if (ch.dataset.ref) segs.push({ref:parseInt(ch.dataset.ref,10),label:ch.textContent});
        } else if (ch.tagName === "BR") add(" ");
        else {
          const block = ["DIV","P","LI"].includes(ch.tagName);
          if (block && segs.length) add(" ");
          walk(ch);
          if (block) add(" ");
        }
      }
    }
  };
  walk(el);
  for (const g of segs) if (g.text != null) g.text = g.text.replace(/ +([,.;:!?…])(?=\s|$)/g,"$1");
  return segs;
}

$("download").addEventListener("click", async () => {
  const btn = $("download");
  btn.disabled = true;
  btn.textContent = "Hazırlanıyor…";
  try {
    const meta = {
      title: $("m-title").value.trim(),
      author: $("m-author").value.trim(),
      translator: $("m-translator").value.trim(),
      publisher: $("m-publisher").value.trim(),
      lang: "tr",
    };
    const sections = [];
    document.querySelectorAll("#preview .sec").forEach((sec) => {
      if (sec.classList.contains("removed")) return;
      const title = sec.querySelector(".sec-title").value.trim() || "Bölüm";
      const paras = [...sec.querySelectorAll(".sec-body > p")].map((p) => ({ cls: p.className || "", segs: readSegments(p) }));
      const notes = [...sec.querySelectorAll(".notes p")].map((p) => {
        const segs = readSegments(p).filter((g) => g.text != null);
        return {id:parseInt(p.dataset.note,10), label:p.dataset.noteLabel, text:segs.map(g => g.text).join("").trim()};
      });
      sections.push({ title, kind: sec.dataset.kind, paras, notes });
    });
    const blob = await buildEpub(meta, sections, state.covers);
    const name = asciiName(meta.title || "kitap") + ".epub";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  } catch (e) {
    console.error(e);
    alert("EPUB oluşturulamadı: " + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = "EPUB'ı indir";
  }
});

function asciiName(s) {
  const map = { ı: "i", İ: "I", ş: "s", Ş: "S", ğ: "g", Ğ: "G", ç: "c", Ç: "C", ö: "o", Ö: "O", ü: "u", Ü: "U", â: "a", î: "i", û: "u" };
  return s.replace(/[ıİşŞğĞçÇöÖüÜâîû]/g, (c) => map[c]).normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 80) || "kitap";
}

$("restart").addEventListener("click", () => location.reload());

// Belge Tarayıcı'dan "EPUB'a çevir" ile gelen kitap (aynı adres, ortak depo)
(async () => {
  const params = new URLSearchParams(location.search);
  if (params.get("kaynak") !== "belge") return;
  const key = params.get("aktarim") || "son";
  if (params.has("aktarim") && !/^[0-9a-f-]{36}$/i.test(key)) {
    $("file-status").textContent = "PDF aktarım adresi geçersiz. Belge Tarayıcı’dan yeniden gönder.";
    return;
  }
  const request = fileRequest;
  let db;
  try {
    db = await new Promise((res, rej) => {
      const r = indexedDB.open("paylasim", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("dosyalar");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const item = await new Promise((res, rej) => {
      const t = db.transaction("dosyalar", "readwrite");
      const s = t.objectStore("dosyalar");
      const g = s.get(key);
      g.onsuccess = () => { if (g.result) s.delete(key); };
      t.oncomplete = () => res(g.result);
      t.onabort = () => rej(t.error);
    });
    params.delete("kaynak");
    params.delete("aktarim");
    const query = params.toString();
    history.replaceState(null, "", location.pathname + (query ? "?" + query : "") + location.hash);
    if (request !== fileRequest) return;
    const data = item?.bytes || item?.blob;
    if (!data) throw new Error("Aktarılmış PDF bulunamadı.");
    await pickFile(new File([data], item.name || "kitap.pdf", { type: "application/pdf" }), item.covers ?? {});
  } catch {
    if (request === fileRequest) $("file-status").textContent = "Aktarılan PDF açılamadı. Belge Tarayıcı’dan yeniden gönder veya bir PDF seç.";
  } finally { db?.close(); }
})();
