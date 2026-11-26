// Doğrulama: OCR okuması + PDF'in kendi metni + Türkçe sözlük + kitabın kendi kelimeleri.
// Her kelime için en olası doğru biçim seçilir; şüpheli kalan satırlar yeniden taranır.
import { wordKey, punctOf, normQuotes, countQuotes } from "./turkish.js?v=20261126e";
import { dictFreq } from "./dict.js?v=20261126e";

const L = "A-Za-zÇĞİÖŞÜçğıöşüÂÎÛâîûÊêÉéÀàÈèÄäËëÏïÑñÓóÒòÕõÚúÙùß";
const OK_CHARS = new RegExp(`^[${L}0-9.,;:!?…'"“”‘’«»()\\[\\]\\-–—/%&*§°+=#@$€₺·•]+$`);
const MIXED = new RegExp(`[${L}][0-9]|[0-9][${L}]`);
const NUM_SUFFIX = new RegExp(`^[(“"‘']*[0-9.,]+['’][${L}]+[.,;:!?…”"’)]*$`);
const ORDINAL_NUM = /^[(“"‘']*\d{1,4}(\.|[.,]\d+)*[.,;:!?…”"’)]*$/;

/** Kelimede bozuk karakter var mı? (\, |, ▯, rakam-harf karışımı gibi) */
export function isGarbage(t) {
  if (!t) return false;
  if (!OK_CHARS.test(t)) return true;
  if (MIXED.test(t) && !NUM_SUFFIX.test(t) && !/^[A-ZÇĞİÖŞÜ]{1,4}-?\d+$/.test(t)) return true;
  return false;
}

export function makeScorer(bookVocab) {
  return function score(t) {
    const stem = t.split(/['’]/)[0];
    const k = wordKey(stem);
    if (!k) return 1000;                      // yalnızca noktalama
    if (ORDINAL_NUM.test(t)) return 1000;     // sayı
    if (isGarbage(t)) return 0;
    return dictFreq(stem) + (bookVocab.get(k) || 0) * 40;
  };
}

export function buildBookVocab(pages) {
  const v = new Map();
  for (const p of pages) for (const l of p.lines || []) for (const w of l.words) {
    if (w.c >= 88 && !isGarbage(w.t)) {
      const k = wordKey(w.t.split(/['’]/)[0]);
      if (k) v.set(k, (v.get(k) || 0) + 1);
    }
  }
  return v;
}

// ---------- hizalama
function lcsMatches(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return [];
  const W = m + 1;
  const dp = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i * W + j] = a[i] === b[j] && a[i] !== ""
      ? dp[(i + 1) * W + j + 1] + 1
      : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
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

function segments(a, b) {
  const ms = lcsMatches(a, b);
  const segs = [];
  let pi = 0, pj = 0;
  for (const [i, j] of ms) {
    if (i > pi || j > pj) segs.push({ type: "diff", i1: pi, i2: i, j1: pj, j2: j });
    segs.push({ type: "eq", i, j });
    pi = i + 1; pj = j + 1;
  }
  if (pi < a.length || pj < b.length) segs.push({ type: "diff", i1: pi, i2: a.length, j1: pj, j2: b.length });
  return segs;
}

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

// Eski OCR katmanından yalnızca kesme/tırnak düzeltmesi al (taranmış kitaplar)
function takePunct(w, o) {
  if (w.t === o) return false;
  const tp = punctOf(w.t), op = punctOf(o).replace(/''/g, "'");
  if (normQuotes(tp) === normQuotes(op)) return false;
  const strip = (s) => normQuotes(s).replace(/["']/g, "");
  const qLost = (tp.match(/\?/g) || []).length - (op.match(/\?/g) || []).length;
  const ok = strip(tp) === strip(op) || (qLost === 1 && strip(tp).replace("?", "") === strip(op) && /'/.test(normQuotes(op)));
  if (!ok) return false;
  const ct = countQuotes(tp) + Math.max(0, qLost);
  const co = countQuotes(op);
  const dq = (s) => (normQuotes(s).match(/"/g) || []).length;
  if (co === ct || (co === ct + 1 && dq(op) <= dq(tp) + Math.max(0, qLost))) { w.t = o.replace(/''/g, "'"); return true; }
  return false;
}

/**
 * Bir sayfanın OCR satırlarını PDF metin katmanıyla uzlaştırır.
 * layerTrusted: PDF dijital (metin katmanı yazı tipinden geliyor) → harfleri genelde doğru.
 */
export function reconcilePage(lines, layerText, { score, layerTrusted }) {
  const O = [];
  lines.forEach((l, li) => l.words.forEach((w, wi) => O.push({ w, li, wi })));
  const Lt = glueQuotes(layerText.split(/\s+/).filter(Boolean));
  let changes = 0;
  if (!Lt.length) {
    for (const { w } of O) w.agree = false;
    return 0;
  }
  const a = O.map((x) => wordKey(x.w.t));
  const b = Lt.map(wordKey);
  const replacements = []; // {li, from, to, words}

  for (const s of segments(a, b)) {
    if (s.type === "eq") {
      const w = O[s.i].w, l = Lt[s.j];
      if (layerTrusted) w.agree = true; else w.confirmed = true;
      if (layerTrusted) {
        if (!isGarbage(l) && w.t !== l) { w.t = l; changes++; }
      } else if (takePunct(w, l)) changes++;
      continue;
    }
    const os = O.slice(s.i1, s.i2), ls = Lt.slice(s.j1, s.j2);
    if (!os.length) continue; // yalnızca katmanda olan (üst bilgi vb.)
    if (os.length === ls.length) {
      os.forEach((x, k) => {
        const w = x.w, l = ls[k];
        const so = score(w.t), sl = isGarbage(l) ? -1 : score(l);
        let take = false;
        if (sl < 0) take = false;
        else if (layerTrusted) take = !(so > sl * 4 + 10);
        else take = w.c < 85 && sl > so * 4 + 10;
        if (take && w.t !== l) { w.t = l; w.c = Math.max(w.c, 90); w.fromLayer = true; changes++; }
        w.agree = take && layerTrusted;
        w.disputed = true;
      });
    } else {
      // farklı sayıda kelime: tek satır içindeyse ve katman daha makulse katmanı al
      const sameLine = os.every((x) => x.li === os[0].li);
      const catO = os.map((x) => wordKey(x.w.t)).join(""), catL = ls.map(wordKey).join("");
      const minO = Math.min(...os.map((x) => score(x.w.t)));
      const minL = ls.length && !ls.some(isGarbage) ? Math.min(...ls.map(score)) : -1;
      let takeL;
      if (catO === catL) {
        // yalnızca boşluk farkı ("uyarıs ını" / "uyarısını"): parçaların hepsi gerçek kelime olan taraf kazanır
        takeL = minL > minO || (minL === minO && layerTrusted);
      } else {
        const sumO = os.reduce((n, x) => n + Math.min(score(x.w.t), 1e5), 0);
        const sumL = minL < 0 ? -1 : ls.reduce((n, t) => n + Math.min(score(t), 1e5), 0);
        takeL = layerTrusted && minL >= minO && sumL >= sumO;
      }
      if (takeL && sameLine && ls.length) {
        replacements.push({ li: os[0].li, from: os[0].wi, to: os[os.length - 1].wi, words: ls });
      } else {
        os.forEach((x) => (x.w.disputed = true));
      }
    }
  }
  // satır içi değişimler (sondan başa)
  replacements.sort((x, y) => y.li - x.li || y.from - x.from);
  for (const r of replacements) {
    const line = lines[r.li];
    const old = line.words.slice(r.from, r.to + 1);
    const box = old.length ? [old[0].box?.[0], Math.min(...old.map((w) => w.box?.[1] ?? 0)), old[old.length - 1].box?.[2], Math.max(...old.map((w) => w.box?.[3] ?? 0))] : null;
    line.words.splice(r.from, r.to - r.from + 1, ...r.words.map((t) => ({ t, c: 95, agree: true, box })));
    changes++;
  }
  for (const l of lines) l.text = l.words.map((w) => w.t).join(" ");
  return changes;
}

// Sık OCR / yazı tipi karışıklıkları
const CONFUSIONS = [
  ["rn", "m"], ["m", "rn"], ["iu", "m"], ["in", "m"], ["ni", "m"], ["rm", "m"], ["nn", "m"], ["ri", "n"], ["n", "ri"],
  ["cl", "d"], ["li", "h"], ["h", "li"], ["ii", "ü"], ["ll", "ü"], ["vv", "w"], ["c", "e"], ["e", "c"], ["t", "f"], ["f", "t"],
  ["g", "ğ"], ["ğ", "g"], ["s", "ş"], ["ş", "s"], ["c", "ç"], ["ç", "c"], ["o", "ö"], ["ö", "o"], ["u", "ü"], ["ü", "u"], ["ü", "i"], ["i", "ü"], ["ö", "ü"], ["ü", "ö"],
  ["ı", "i"], ["i", "ı"], ["l", "ı"], ["ı", "l"], ["l", "i"], ["i", "l"], ["1", "ı"], ["1", "l"], ["1", "i"], ["!", "l"], ["!", "ı"],
  ["|", "l"], ["|", "ı"], ["\\", ""], ["0", "o"], ["0", "ö"], ["5", "s"], ["5", "ş"], ["8", "k"], ["8", "b"], ["6", "ğ"], ["9", "ğ"],
  ["2", "z"], ["4", "a"], ["x", "u"], ["y", "ğ"], ["İ", "l"], ["I", "l"], ["l", "I"], ["Il", "İl"], ["l\\", "M"], ["1\\", "K"],
  ["k", "lc"], ["lc", "k"], ["a", "ı"], ["ı", "a"], ["b", "h"], ["h", "b"], ["e", "o"], ["o", "e"], ["r", "t"], ["t", "r"],
];

function caseLike(src, rep) {
  if (src && src === src.toLocaleUpperCase("tr") && src !== src.toLocaleLowerCase("tr")) return rep.toLocaleUpperCase("tr");
  return rep;
}

const DIACRITIC = [["g", "ğ"], ["ğ", "g"], ["s", "ş"], ["ş", "s"], ["c", "ç"], ["ç", "c"], ["o", "ö"], ["ö", "o"], ["u", "ü"], ["ü", "u"], ["ı", "i"], ["i", "ı"]];

function substitute(s, pairs) {
  const res = [];
  const lowS = s.toLocaleLowerCase("tr");
  for (const [a, b] of pairs) {
    const al = a.toLocaleLowerCase("tr");
    let idx = lowS.indexOf(al);
    while (idx !== -1) {
      const src = s.slice(idx, idx + a.length);
      res.push(s.slice(0, idx) + caseLike(src, b) + s.slice(idx + a.length));
      idx = lowS.indexOf(al, idx + 1);
    }
  }
  return res;
}

function variants(head) {
  const out = new Set(substitute(head, CONFUSIONS));
  // ikinci değişiklik yalnızca Türkçe harf karışıklıkları için (ş/s, ğ/g, ı/i, ö/o, ü/u, ç/c)
  if (head.length >= 4 && head.length <= 20) {
    for (const v of [...out]) for (const v2 of substitute(v, DIACRITIC)) out.add(v2);
  }
  out.delete(head);
  return [...out];
}

/**
 * Şüpheli kelimeleri sözlük ve kitabın kendi kelimeleriyle düzeltir.
 * Yalnızca nadir/bilinmeyen kelimelere dokunur; iki kaynağın uzlaştığı kelimeler korunur.
 */
export function correctWord(w, score) {
  if ((w.agree || w.confirmed) && !isGarbage(w.t)) return false;
  const m = w.t.match(/^([(“"‘'«]*)(.*?)([.,;:!?…”"’»)]*)$/);
  if (!m || !m[2]) return false;
  const [, pre, core, post] = m;
  const ap = core.search(/['’]/);
  const head = ap > 0 ? core.slice(0, ap) : core;
  const tail = ap > 0 ? core.slice(ap) : "";
  if (head.length < 2) return false;
  const cur = score(head);
  const inDict = dictFreq(head) > 0;
  const garbage = isGarbage(head);
  // yalnızca Türkçe harf farkı olan adaylar (olaganüstü → olağanüstü)
  let bestDia = null, bestDiaS = 0;
  for (const v of diacriticVariants(head)) { const s = score(v); if (s > bestDiaS) { bestDiaS = s; bestDia = v; } }
  let best = null, bestS = 0;
  for (const v of variants(head)) { if (!v) continue; const s = score(v); if (s > bestS) { bestS = s; best = v; } }
  let pick = null;
  if (inDict && cur >= 8 && !garbage) {
    // gerçek bir kelime: çok dikkatli ol (konuşma dili, şive)
    // sözlükte nadir geçen "Türkçe karaktersiz yazım" (olaganüstü, durdugunu) → asıl biçim
    if (bestDia && cur < 100 && !w.confirmed && bestDiaS >= 500 && bestDiaS >= cur * 50) pick = bestDia;
    // hiç Türkçe harfi olmayan yazım (dogru, cok, icin, degil): sözlükteki sıklığı altyazı yazımından gelir;
    // basılı kitapta bunlar neredeyse her zaman harf kaybıdır
    else if (bestDia && !w.confirmed && /^[a-zA-Z]+$/.test(head) && /[çğışöüÇĞİŞÖÜ]/.test(bestDia)
             && !ASCII_REAL.has(head.toLocaleLowerCase("tr")) && bestDiaS >= 500 && bestDiaS >= cur * 50) pick = bestDia;
    else if (w.c < 60 && !w.confirmed && !w.fromLayer && best && bestS >= cur * 50) pick = best;
  } else {
    if (bestDia && bestDiaS >= 60 && bestDiaS >= Math.max(cur, 1) * 8) pick = bestDia;
    else if (best && bestS >= 60 && bestS >= Math.max(cur, 1) * 8) pick = best;
  }
  if (pick) {
    w.t = pre + pick + tail + post;
    w.c = Math.max(w.c, 88);
    w.corrected = true;
    return true;
  }
  return false;
}

// Türkçe harfsiz de olsa gerçek olan kelimeler (kani oldum, sure, sac levha, yasa…)
const ASCII_REAL = new Set(["kani", "sure", "sureler", "sac", "yasa", "yasal", "basin", "kurt", "kus", "sus", "bas", "kas", "kol", "sok", "sir", "cam", "can", "car", "gol", "kor", "kuru", "olu", "oyun", "sik", "ara", "aci"]);

function diacriticVariants(head) {
  const out = new Set(substitute(head, DIACRITIC));
  if (head.length >= 4 && head.length <= 22) for (const v of [...out]) for (const v2 of substitute(v, DIACRITIC)) out.add(v2);
  out.delete(head);
  return [...out];
}

/** Satır sonunda tiresi kaybolmuş bölünme mi? ("basa" + "mağında", "Kut" + "sal") */
export function shouldJoin(a, b, score) {
  if (!/[A-Za-zÇĞİÖŞÜçğıöşüâîû]$/.test(a) || !/^[a-zçğıöşüâîû]/.test(b)) return false;
  if (/['’]/.test(a) || /['’]/.test(b) || a.length < 2) return false;
  const bCore = b.replace(/[.,;:!?…”"’»)]+$/, "");
  const sj = score(a + bCore), sa = score(a), sb = score(bCore);
  if (sj < 20) return false;
  return Math.min(sa, sb) < 5 || sj >= Math.min(sa, sb) * 4;
}

export function needsRescan(w, score) {
  if (w.frag) return false; // satır sonu kelime parçası: birleştirildikten sonra kontrol edilir
  if (w.agree && !isGarbage(w.t)) return false;
  const s = score(w.t);
  if (isGarbage(w.t)) return true;
  if (w.confirmed && w.c >= 90) return false;
  return w.c < 85 || w.disputed || s === 0 || uncertainDiacritics(w);
}

function uncertainDiacritics(w) {
  return !w.confirmed && !w.corrected && /[çğışöüâîûÇĞİŞÖÜÂÎÛ]/.test(w.t)
    && w.c < 97 && !dictFreq(w.t);
}

/** Yeniden taranan satırdan daha iyi kelimeleri alır */
export function applyRescan(line, rescanWords, score) {
  const a = line.words.map((w) => wordKey(w.t));
  const b = rescanWords.map((w) => wordKey(w.t));
  let changes = 0;
  for (const s of segments(a, b)) {
    if (s.type === "eq") {
      const w = line.words[s.i];
      if (rescanWords[s.j].c > 85 && !w.agree) w.c = Math.max(w.c, rescanWords[s.j].c);
      continue;
    }
    const os = line.words.slice(s.i1, s.i2), rs = rescanWords.slice(s.j1, s.j2);
    if (os.length === rs.length) {
      os.forEach((w, k) => {
        if (w.agree) return;
        // zaten bilinen/doğrulanmış kelimeye dokunma; yalnızca zayıf kelimeleri değiştir
        if (!isGarbage(w.t) && (w.confirmed || (score(w.t) >= 40 && !uncertainDiacritics(w)))) return;
        const r = rs[k];
        const sw = score(w.t), sr = score(r.t);
        if ((sr > sw * 3 + 5) || (sr >= sw && r.c > w.c + 10)) { w.t = r.t; w.c = Math.max(r.c, w.c); w.rescanned = true; changes++; }
      });
    } else if (os.length && rs.length && !os.some((w) => w.agree || w.confirmed || (score(w.t) >= 40 && !isGarbage(w.t)))) {
      const so = os.reduce((n, w) => n + Math.min(score(w.t), 1e5), 0);
      const sr = rs.reduce((n, w) => n + Math.min(score(w.t), 1e5), 0);
      if (sr > so * 3 + 20) {
        const box = os[0].box;
        line.words.splice(s.i1, os.length, ...rs.map((r) => ({ t: r.t, c: r.c, box, rescanned: true })));
        changes++;
        return changes + applyRescan(line, rescanWords, score); // indeksler değişti; yeniden hizala
      }
    }
  }
  line.text = line.words.map((w) => w.t).join(" ");
  return changes;
}

/** Son karar: hâlâ şüpheli olan kelimeleri işaretle (önizlemede işaretli) */
export function finalConfidence(w, score) {
  if (w.agree && !isGarbage(w.t)) { w.c = Math.max(w.c, 95); return; }
  const s = score(w.t);
  if (isGarbage(w.t)) { w.c = Math.min(w.c, 40); return; }
  if (uncertainDiacritics(w)) { w.c = Math.min(w.c,70); return; }
  if (s >= 40) { w.c = Math.max(w.c, 90); return; }
  if (s > 0 && (w.c >= 85 || w.confirmed)) return;
  if (s === 0 && w.c < 93 && !w.confirmed) w.c = Math.min(w.c, 60);
  if (s === 0 && w.confirmed && w.c < 75) w.c = 70;
}

/** Satır sonunda tireyle bölünmüş kelime parçalarını işaretle */
export function markFragments(pages) {
  let prevEnds = false;
  for (const p of pages) {
    const ls = p.lines || [];
    ls.forEach((l, i) => {
      const first = l.words[0], last = l.words[l.words.length - 1];
      if (i < 3 && prevEnds && first) first.frag = true;
      if (i > 0) {
        const pl = ls[i - 1].words[ls[i - 1].words.length - 1];
        if (pl && /[-‐¬]$/.test(pl.t) && first) first.frag = true;
      }
      if (last && /[-‐¬]$/.test(last.t)) last.frag = true;
    });
    const tail = ls.slice(-3).map((l) => l.words[l.words.length - 1]);
    prevEnds = tail.some((w) => w && /[-‐¬]$/.test(w.t));
  }
}
