import { openPdf, pageImageCoverage, textLayerLines, renderPage, renderCover } from "./lib/pdfsource.js";
import { createOcrPool } from "./lib/ocr.js";
import { loadDict } from "./lib/dict.js";
import { reconcilePage, buildBookVocab, makeScorer, correctWord, needsRescan, applyRescan, finalConfidence, markFragments, shouldJoin } from "./lib/reconcile.js";
import { analyze } from "./lib/layout.js";
import { buildEpub } from "./lib/epub.js";
import { normalizeText, hasMojibake, fixMojibake, textQuality, typography, escapeXml } from "./lib/turkish.js";

const $ = (id) => document.getElementById(id);
const state = { file: null, pdf: null, pages: null, cover: null, sections: null };

// ---------- Dosya seçimi
const drop = $("drop");
$("file").addEventListener("change", (e) => e.target.files[0] && pickFile(e.target.files[0]));
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) pickFile(f); });

function guessTitle(name) {
  return name.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

async function pickFile(file) {
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { alert("Lütfen bir PDF dosyası seç."); return; }
  state.file = file;
  $("drop-text").textContent = `${file.name} (${(file.size / 1048576).toFixed(1)} MB)`;
  try {
    state.pdf = await openPdf(await file.arrayBuffer());
  } catch (e) {
    console.error(e);
    alert("Bu PDF açılamadı. Dosya bozuk ya da şifreli olabilir.");
    return;
  }
  const info = state.pdf.info || {};
  const clean = (s) => (s ? normalizeText(String(s)).trim() : "");
  $("m-title").value = clean(info.Title) && !/^(untitled|about:blank|microsoft word|adsız)|\.(docx?|pdf|indd|odt)$/i.test(info.Title.trim()) ? clean(info.Title) : guessTitle(file.name);
  $("m-author").value = clean(info.Author);
  $("pdf-info").textContent = `${state.pdf.numPages} sayfa bulundu.`;
  $("step-opts").classList.remove("hidden");
  $("step-opts").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Dönüştürme
let backTouched = false;
$("o-back").addEventListener("change", () => (backTouched = true));
$("go").addEventListener("click", () => convert().catch((e) => {
  console.error(e);
  setStatus("Bir hata oluştu: " + (e.message || e));
  $("go").disabled = false;
  keepAwake(false);
  if (activePool) { activePool.terminate().catch(() => {}); activePool = null; }
}));
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
  if (mobile || mem <= 4) n = Math.min(n, 2);
  return n;
}

async function convert() {
  $("go").disabled = true;
  $("step-run").classList.remove("hidden");
  $("step-review").classList.add("hidden");
  $("step-run").scrollIntoView({ behavior: "smooth", block: "start" });
  await keepAwake(true);
  const t0 = performance.now();
  const { doc, numPages } = state.pdf;
  const mode = $("o-mode").value;            // "best" | "fast"
  const dpi = parseInt($("o-dpi").value, 10);
  const coverFirst = $("o-cover").checked;
  const dictPromise = loadDict(new URL("lang/tr-words.txt.gz", location.href).href);
  dictPromise.catch(() => {});

  // 1) PDF'in kendi metnini incele
  const pages = [];
  let imagePages = 0, mojibake = 0;
  const allLayerWords = [];
  for (let i = 1; i <= numPages; i++) {
    setStatus(`PDF inceleniyor: sayfa ${i}/${numPages}`, (i / numPages) * 0.05);
    const page = await doc.getPage(i);
    const cov = await pageImageCoverage(page).catch(() => 0);
    const tl = await textLayerLines(page);
    const raw = tl.lines.map((l) => l.text).join("\n");
    mojibake += hasMojibake(raw);
    if (cov > 0.6) imagePages++;
    pages.push({ n: i, cov, layer: tl, layerText: raw });
    if (i > (coverFirst ? 1 : 0)) allLayerWords.push(...raw.split(/\s+/).filter(Boolean));
    page.cleanup();
  }
  const fixMoj = mojibake > 5;
  if (fixMoj) {
    for (const p of pages) {
      p.layerText = fixMojibake(p.layerText);
      for (const l of p.layer.lines) { l.text = fixMojibake(l.text); l.words.forEach((w) => (w.t = fixMojibake(w.t))); }
    }
  }
  const quality = textQuality(fixMoj ? allLayerWords.map(fixMojibake) : allLayerWords);
  const scanned = imagePages >= numPages * 0.5;
  const wordsPerPage = allLayerWords.length / Math.max(1, numPages);
  const hasLayer = wordsPerPage >= 25 && quality > 0.5;
  const layerTrusted = hasLayer && !scanned && quality >= 0.75;  // dijital PDF: harfler yazı tipinden gelir
  const useOcr = mode === "best" || !layerTrusted || quality < 0.97;
  console.info({ scanned, quality, wordsPerPage, mojibake, hasLayer, layerTrusted, useOcr });

  // 2) Kapak
  if (coverFirst) {
    setStatus("Kapak hazırlanıyor…", 0.05);
    state.cover = await renderCover(await doc.getPage(1)).catch(() => null);
  } else state.cover = null;

  setStatus("Türkçe sözlük yükleniyor…", 0.05);
  await dictPromise.catch((e) => console.warn("sözlük yok", e));

  const stats = { fromLayer: 0, corrected: 0, rescannedLines: 0, rescanFixes: 0 };
  let pool = null;
  const work = pages.filter((p) => !(coverFirst && p.n === 1));

  // 3) OCR
  if (useOcr) {
    const size = poolSize();
    pool = activePool = await createOcrPool(size, (t) => setStatus(t, 0.06));
    let done = 0;
    const tStart = performance.now();
    const queue = work.map((p) => p.n);
    const total = queue.length;
    async function runner() {
      while (queue.length) {
        const n = queue.shift();
        const page = await doc.getPage(n);
        const vp1 = page.getViewport({ scale: 1 });
        const { canvas } = await renderPage(page, { dpi, maxSide: dpi >= 400 ? 3400 : 2700 });
        const lines = await pool.recognize(canvas);
        pages[n - 1].ocr = { lines, width: canvas.width, height: canvas.height, pxPerPt: canvas.width / vp1.width };
        canvas.width = canvas.height = 0;
        page.cleanup();
        done++;
        const el = (performance.now() - tStart) / 1000;
        setStatus(`1. tarama (Türkçe OCR): sayfa ${done}/${total} · kalan yaklaşık ${fmtTime((el / done) * (total - done))}`, 0.07 + (done / total) * 0.6);
      }
    }
    await Promise.all(Array.from({ length: size }, runner));
  }

  const structPages = () => pages.map((p) => (p.ocr ? p.ocr : { lines: p.layer.lines, width: p.layer.width, height: p.layer.height }));
  for (const p of structPages()) for (const l of p.lines) l.words.forEach((w) => (w.t = normalizeText(w.t)));

  // 4) İki kaynağı karşılaştır
  let score = makeScorer(buildBookVocab(structPages()));
  if (useOcr && hasLayer) {
    setStatus("OCR ile PDF metni kelime kelime karşılaştırılıyor…", 0.68);
    for (const p of work) {
      if (!p.ocr) continue;
      stats.fromLayer += reconcilePage(p.ocr.lines, p.layerText, { score, layerTrusted });
      await tick();
    }
    score = makeScorer(buildBookVocab(structPages()));
  }

  const allWords = () => structPages().flatMap((p) => p.lines.flatMap((l) => l.words));
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
      const vp1 = page.getViewport({ scale: 1 });
      const hiDpi = Math.min(dpi * 1.7, 520);
      const { canvas } = await renderPage(page, { dpi: hiDpi, maxSide: 4400 });
      const f = canvas.width / vp1.width / p.ocr.pxPerPt;
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

  // Son sayfa arka kapak mı? (ISBN, barkod, fiyat) — kullanıcı seçmediyse otomatik
  if (!backTouched && numPages > 3) {
    const last = structPages()[numPages - 1];
    const txt = last.lines.map((l) => l.text).join(" ");
    $("o-back").checked = /ISBN|97[89][\s\-–"“”]*\d{3}|\b\d+([.,]\d+)?\s?(TL|₺)\b/i.test(txt);
  }

  // 8) Yapıyı çıkar
  setStatus("Bölümler ve paragraflar düzenleniyor…", 0.97);
  state.pages = structPages();
  const { sections } = analyze(state.pages, { coverFirst, backCoverLast: $("o-back").checked, score });

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
    if (m && next && /^[a-zçğıöşü]/.test(next.t) && (m[3] || w.c < 90)) { w.t = `${m[1]}${m[2]}i’`; w.c = Math.max(w.c, 85); }
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
  parts.push(useOcr ? (hasLayer ? "OCR ve PDF metni karşılaştırıldı" : "Türkçe OCR ile okundu") : "PDF metni kullanıldı");
  if (fixMoj) parts.push("bozuk Türkçe harfler onarıldı");
  if (stats.corrected + stats.rescanFixes) parts.push(`${stats.corrected + stats.rescanFixes} kelime düzeltildi`);
  if (stats.rescannedLines) parts.push(`${stats.rescannedLines} satır yeniden tarandı`);
  parts.push(`${chapters} bölüm, ${paras} paragraf`);
  $("summary").textContent = parts.join(" · ") + ".";
  setStatus("Bitti.", 1);
  $("step-run").classList.add("hidden");
  $("step-review").classList.remove("hidden");
  $("step-review").scrollIntoView({ behavior: "smooth", block: "start" });
  $("go").disabled = false;
  keepAwake(false);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function fmtTime(s) {
  s = Math.round(s);
  if (s < 60) return `${s} sn`;
  return `${Math.floor(s / 60)} dk ${s % 60} sn`;
}

// ---------- Önizleme (düzenlenebilir)
const LOW = 72;

function wordsToHtml(words) {
  // \u0001/\u0002: şüpheli kelime sınırı, \u0003n\u0003: dipnot işareti
  const parts = words.map((w) => {
    let t = w.t;
    if (w.ref) {
      const pos = Math.min(w.refPos ?? t.length, t.length);
      t = t.slice(0, pos) + `\u0003${w.ref}\u0003` + t.slice(pos);
    }
    return w.c < LOW && !w.fixed ? `\u0001${t}\u0002` : t;
  });
  let s = typography(parts.join(" "));
  s = escapeXml(s);
  s = s.replace(/\u0001/g, "<mark>").replace(/\u0002/g, "</mark>");
  s = s.replace(/\u0003(\d+)\u0003/g, '<sup class="ref" contenteditable="false" data-ref="$1">*</sup>');
  return s;
}

function noteText(n) {
  const words = [];
  for (const line of n.lines) {
    line.forEach((w, j) => {
      const prev = words[words.length - 1];
      if (prev && /[A-Za-zçğıöşüÇĞİÖŞÜ]-$/.test(prev.t) && /^[a-zçğıöşü]/.test(w.t)) prev.t = prev.t.slice(0, -1) + w.t;
      else if (j === 0 && prev && state.score && shouldJoin(prev.t, w.t, state.score)) prev.t = prev.t + w.t;
      else words.push({ ...w });
    });
  }
  return words;
}

function renderPreview(sections) {
  const root = $("preview");
  root.innerHTML = "";
  sections.forEach((s, si) => {
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
    for (const p of s.paras) {
      if (!p.words.length) continue;
      const el = document.createElement("p");
      if (p.cls) el.className = p.cls;
      el.contentEditable = "true";
      el.spellcheck = false;
      el.lang = "tr";
      el.innerHTML = wordsToHtml(p.words);
      body.append(el);
    }
    if (s.notes.length) {
      const nb = document.createElement("div");
      nb.className = "notes";
      s.notes.forEach((n) => {
        const el = document.createElement("p");
        el.contentEditable = "true";
        el.dataset.note = n.id;
        el.dataset.linked = s.paras.some((p) => p.words.some((w) => w.ref === n.id)) ? "1" : "";
        el.innerHTML = `<sup class="ref" contenteditable="false">*</sup> ` + wordsToHtml(noteText(n));
        nb.append(el);
      });
      body.append(nb);
    }
    sec.append(head, body);
    root.append(sec);
  });
  updateLowCount();
}

let lowIdx = -1;
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
  m.scrollIntoView({ behavior: "smooth", block: "center" });
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
  const walk = (node) => {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) segs.push({ text: ch.nodeValue });
      else if (ch.nodeType === 1) {
        if (ch.matches("sup.ref")) { if (ch.dataset.ref) segs.push({ ref: parseInt(ch.dataset.ref, 10) }); }
        else if (ch.tagName === "BR") segs.push({ text: " " });
        else walk(ch);
      }
    }
  };
  walk(el);
  // boşlukları sadeleştir
  segs.forEach((g) => { if (g.text != null) g.text = normalizeText(g.text).replace(/\s+/g, " "); });
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
        return { id: parseInt(p.dataset.note, 10), linked: !!p.dataset.linked, label: "*", text: segs.map((g) => g.text).join("").trim() };
      });
      paras.forEach((p) => p.segs.forEach((g) => { if (g.ref) g.label = "*"; }));
      sections.push({ title, kind: sec.dataset.kind, paras, notes });
    });
    const blob = await buildEpub(meta, sections, state.cover);
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
