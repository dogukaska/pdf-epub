// OCR sonucunu PDF'in kendi (çoğu zaman bozuk) metin katmanıyla karşılaştırıp
// iki kaynağın en iyisini birleştirir. OCR harfleri daha iyi okur; eski metin
// katmanı ise kesme işaretleri ve iç içe tırnakları çoğu zaman daha doğru taşır.
import { wordKey, punctOf, normQuotes, countQuotes } from "./turkish.js";

function lcsMatches(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return [];
  const W = m + 1;
  const dp = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * W + j] = a[i] === b[j] && a[i] !== ""
        ? dp[(i + 1) * W + j + 1] + 1
        : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j] && a[i] !== "") { out.push([i, j]); i++; j++; }
    else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++;
    else j++;
  }
  return out;
}

// Kaynak metin katmanında tek başına duran tırnakları komşu kelimeye yapıştır
function glueQuotes(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    if (/^["'“”‘’«»]+$/.test(w)) {
      const prev = out[out.length - 1];
      const next = tokens[i + 1];
      if (prev && (/[.,!?…;:]$/.test(prev) || /^[a-zçğıöşü]/.test(next || ""))) { out[out.length - 1] = prev + w; continue; }
      if (next !== undefined) { tokens[i + 1] = w + next; continue; }
    }
    out.push(w);
  }
  return out;
}

/**
 * ocrWords: [{t, c}] (sayfanın OCR kelimeleri, sırayla; yerinde değiştirilir)
 * layerText: metin katmanından gelen ham metin (tek string)
 * vocab: Map(anahtar -> sayı) yüksek güvenli OCR kelimeleri
 */
export function mergePage(ocrWords, layerText, vocab) {
  const otoks = glueQuotes(layerText.replace(/­\s*/g, "").split(/\s+/).filter(Boolean));
  if (!otoks.length || !ocrWords.length) return 0;
  const a = ocrWords.map((w) => wordKey(w.t));
  const b = otoks.map(wordKey);
  const matches = lcsMatches(a, b);
  let changes = 0;

  const fixPunct = (w, o) => {
    if (w.t === o) return;
    const tp = punctOf(w.t), op = punctOf(o).replace(/''/g, "'");
    if (normQuotes(tp) === normQuotes(op)) return;
    const strip = (s) => normQuotes(s).replace(/["']/g, "");
    const tq = strip(tp), oq = strip(op);
    const qMarkLost = (tp.match(/\?/g) || []).length - (op.match(/\?/g) || []).length;
    const ok = tq === oq || (qMarkLost === 1 && tq.replace("?", "") === oq && /'/.test(normQuotes(op)));
    if (!ok) return;
    const ct = countQuotes(tp) + Math.max(0, qMarkLost);
    const co = countQuotes(op);
    const dq = (s) => (normQuotes(s).match(/"/g) || []).length;
    // Yalnızca OCR'ın kaçırdığı tek bir kesme/tek tırnak eklenebilir; çift tırnak eklenmez
    if (co === ct || (co === ct + 1 && dq(op) <= dq(tp) + Math.max(0, qMarkLost))) {
      w.t = o.replace(/''/g, "'");
      w.fixed = true;
      changes++;
    }
  };

  const fixWord = (w, o) => {
    const kt = wordKey(w.t), ko = wordKey(o);
    if (!ko || kt === ko) return;
    if (w.c < 85 && (vocab.get(ko) || 0) >= 1 && !(vocab.get(kt) || 0)) {
      w.t = o.replace(/''/g, "'");
      w.c = 90;
      w.fixed = true;
      changes++;
    }
  };

  let pi = 0, pj = 0;
  const seg = (i2, j2) => {
    if (i2 - pi === j2 - pj) for (let k = 0; k < i2 - pi; k++) fixWord(ocrWords[pi + k], otoks[pj + k]);
  };
  for (const [i, j] of matches) {
    seg(i, j);
    fixPunct(ocrWords[i], otoks[j]);
    pi = i + 1; pj = j + 1;
  }
  seg(a.length, b.length);
  return changes;
}

export function buildVocab(pages) {
  const v = new Map();
  for (const p of pages) for (const l of p.lines || []) for (const w of l.words) {
    if (w.c >= 90) { const k = wordKey(w.t); if (k) v.set(k, (v.get(k) || 0) + 1); }
  }
  return v;
}

// Sık OCR karışıklıkları (Türkçe kitaplarda en çok görülenler)
const CONFUSIONS = [
  ["rn", "m"], ["m", "rn"], ["ü", "i"], ["i", "ü"], ["iu", "m"], ["in", "m"], ["ni", "m"], ["rm", "m"],
  ["g", "ğ"], ["ğ", "g"], ["s", "ş"], ["ş", "s"], ["c", "ç"], ["ç", "c"], ["o", "ö"], ["ö", "o"],
  ["u", "ü"], ["ü", "u"], ["ı", "i"], ["i", "ı"], ["l", "ı"], ["ı", "l"], ["l", "i"], ["i", "l"],
  ["cl", "d"], ["li", "h"], ["h", "li"], ["ii", "ü"], ["ri", "n"], ["n", "ri"], ["e", "c"], ["c", "e"],
  ["0", "o"], ["1", "l"], ["5", "s"], ["x", "u"], ["İ", "l"], ["I", "l"], ["l", "I"], ["t", "f"], ["f", "t"],
];

function caseLike(src, rep) {
  if (src === src.toLocaleUpperCase("tr") && src !== src.toLocaleLowerCase("tr")) return rep.toLocaleUpperCase("tr");
  return rep;
}

/**
 * Kitabın kendi kelime dağarcığına bakarak tek tük yanlış okunmuş kelimeleri düzeltir.
 * Örn. kitapta 300 kez "Jimmie" geçiyorsa, bir yerde çıkan "Jirnmie" → "Jimmie".
 */
export function selfCorrect(pages) {
  const freq = new Map();
  const all = [];
  const stemOf = (t) => t.split(/['’]/)[0];
  for (const p of pages) for (const l of p.lines || []) for (const w of l.words) {
    const k = wordKey(w.t);
    if (!k) continue;
    freq.set(k, (freq.get(k) || 0) + 1);
    const sk = "§" + wordKey(stemOf(w.t));
    freq.set(sk, (freq.get(sk) || 0) + 1);
    all.push(w);
  }
  let changes = 0;
  for (const w of all) {
    if (w.c >= 96) continue;
    // Kesmeli kelimelerde (Jirnmie’den) yalnızca kök kısmı değerlendirilir
    const apos = /['’]/.test(w.t);
    const head = apos ? stemOf(w.t) : w.t;
    const tail = apos ? w.t.slice(head.length) : "";
    const keyOf = (x) => (apos ? "§" + wordKey(x) : wordKey(x));
    const k = keyOf(head);
    const fo = freq.get(k) || 0;
    if (fo > 15 || wordKey(head).length < 3) continue;
    const proper = /^["“‘'(]*[A-ZÇĞİÖŞÜ][a-zçğıöşü]/.test(head);
    let best = null, bestC = 0;
    const low = head.toLocaleLowerCase("tr");
    for (const [a, b] of CONFUSIONS) {
      const diacritic = a.length === 1 && b.length === 1 && /[çğıöşüiİI]/.test(a + b) && !/[0-9]/.test(a);
      if (diacritic && w.c >= 80 && !proper) continue;
      const al = a.toLocaleLowerCase("tr");
      let idx = low.indexOf(al);
      while (idx !== -1) {
        const src = head.slice(idx, idx + a.length);
        if (a === a.toLocaleLowerCase("tr") || src === a) {
          const cand = head.slice(0, idx) + caseLike(src, b) + head.slice(idx + a.length);
          const c = freq.get(keyOf(cand)) || 0;
          if (c > bestC) { bestC = c; best = cand; }
        }
        idx = low.indexOf(al, idx + 1);
      }
    }
    if (best && bestC >= 3 && bestC >= fo * (fo > 3 ? 8 : 4)) {
      w.t = best + tail;
      w.fixed = true;
      w.c = Math.max(w.c, 90);
      changes++;
    }
  }
  return changes;
}
