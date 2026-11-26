// Türkçe OCR (tesseract.js, tamamen tarayıcıda)
const base = new URL("../", import.meta.url).href;

export async function createOcrPool(size, onStatus) {
  const T = window.Tesseract;
  const workers = [];
  try {
    for (let i = 0; i < size; i++) {
      onStatus?.(`OCR motoru hazırlanıyor (${i + 1}/${size})…`);
      const w = await T.createWorker("tur", 1, {
        workerPath: base + "vendor/tesseract/worker.min.js",
        corePath: base + "vendor/tesseract/core/",
        langPath: base + "lang",
        gzip: true,
        cacheMethod: "write",
      });
      workers.push(w);
      await w.setParameters({ tessedit_pageseg_mode: "3", preserve_interword_spaces: "0", user_defined_dpi: "300" });
      w._psm = "3";
    }
  } catch(error) {
    await Promise.allSettled(workers.map(w => w.terminate()));
    throw error;
  }
  const idle = [...workers];
  const waiters = [];
  const acquire = async () => (idle.length ? idle.pop() : new Promise((r) => waiters.push(r)));
  const release = (w) => { const n = waiters.shift(); if (n) n(w); else idle.push(w); };
  const withPsm = async (w, psm) => {
    if (w._psm !== psm) { await w.setParameters({ tessedit_pageseg_mode: psm }); w._psm = psm; }
  };
  return {
    size,
    // Tüm sayfa
    async recognize(canvas) {
      const w = await acquire();
      try {
        await withPsm(w, "3");
        const { data } = await w.recognize(canvas, {}, { blocks: true, text: false });
        const lines = toLines(data);
        if (lines.length) return lines;
        await withPsm(w, "6");
        const fallback = await w.recognize(canvas, {}, { blocks: true, text: false });
        return toLines(fallback.data);
      } finally { release(w); }
    },
    // Tek satır (yeniden tarama)
    async recognizeLine(canvas) {
      const w = await acquire();
      try {
        await withPsm(w, "7");
        const { data } = await w.recognize(canvas, {}, { blocks: true, text: false });
        return toLines(data).flatMap((l) => l.words);
      } finally { release(w); }
    },
    async terminate() { await Promise.all(workers.map((w) => w.terminate())); },
  };
}

function toLines(data) {
  const lines = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    const words = (l.words || [])
      .filter((w) => w.text && w.text.trim())
      .map((w) => ({ t: w.text.trim(), c: w.confidence, ocr: w.text.trim(), box: [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1] }));
    if (!words.length) continue;
    lines.push({
      text: words.map((w) => w.t).join(" "),
      words,
      x0: l.bbox.x0, x1: l.bbox.x1, y0: l.bbox.y0, y1: l.bbox.y1,
      h: l.bbox.y1 - l.bbox.y0,
    });
  }
  return lines;
}
