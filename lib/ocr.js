// Türkçe OCR (tesseract.js, tamamen tarayıcıda)
const base = new URL("../", import.meta.url).href;

export async function createOcrPool(size, onStatus) {
  const T = window.Tesseract;
  const workers = [];
  for (let i = 0; i < size; i++) {
    onStatus?.(`OCR motoru hazırlanıyor (${i + 1}/${size})…`);
    const w = await T.createWorker("tur", 1, {
      workerPath: base + "vendor/tesseract/worker.min.js",
      corePath: base + "vendor/tesseract/core/",
      langPath: base + "lang",
      gzip: true,
      cacheMethod: "write",
    });
    await w.setParameters({
      tessedit_pageseg_mode: "6",
      preserve_interword_spaces: "0",
      user_defined_dpi: "300",
    });
    workers.push(w);
  }
  const idle = [...workers];
  const waiters = [];
  async function acquire() {
    if (idle.length) return idle.pop();
    return new Promise((r) => waiters.push(r));
  }
  function release(w) {
    const next = waiters.shift();
    if (next) next(w); else idle.push(w);
  }
  return {
    size,
    async recognize(canvas) {
      const w = await acquire();
      try {
        const { data } = await w.recognize(canvas, {}, { blocks: true, text: false });
        return toLines(data);
      } finally {
        release(w);
      }
    },
    async terminate() {
      await Promise.all(workers.map((w) => w.terminate()));
    },
  };
}

function toLines(data) {
  const lines = [];
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        const words = (l.words || [])
          .filter((w) => w.text && w.text.trim())
          .map((w) => ({ t: w.text.trim(), c: w.confidence }));
        if (!words.length) continue;
        lines.push({
          text: words.map((w) => w.t).join(" "),
          words,
          x0: l.bbox.x0, x1: l.bbox.x1, y0: l.bbox.y0, y1: l.bbox.y1,
          h: l.bbox.y1 - l.bbox.y0,
        });
      }
    }
  }
  lines.sort((a, b) => a.y0 - b.y0);
  return lines;
}
