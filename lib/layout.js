// Sayfa satırlarından kitap yapısı çıkarır: üst bilgi/sayfa numarası temizliği,
// bölüm başlıkları, paragraflar, satır sonu tireleri, dipnotlar.
import { wordKey, LETTER_RE, isLowerStart } from "./turkish.js?v=20261126e";
import { shouldJoin } from "./reconcile.js?v=20261126e";

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const ROMAN_RE = /^[IVXLC]+$/;
const ORDINALS = ["birinci", "ikinci", "üçüncü", "dördüncü", "beşinci", "altıncı", "yedinci", "sekizinci", "dokuzuncu", "onuncu",
  "on birinci", "on ikinci", "on üçüncü", "on dördüncü", "on beşinci", "on altıncı", "on yedinci", "on sekizinci", "on dokuzuncu", "yirminci"];
const SECTION_WORDS = "bölüm|kısım|kitap|perde|chapter|part";
const STRONG_RES = [
  new RegExp(`^(\\S{1,6}?)\\s*[.)]?\\s*(${SECTION_WORDS})\\s*[:.]?$`, "iu"),            // "I. Bölüm", "3. KISIM", OCR: "HI. Bölüm"
  new RegExp(`^(${SECTION_WORDS})\\s*[:.]?\\s*([0-9]{1,3}|[IVXLC]{1,7}|[a-zçğıöşü ]{3,30})\\s*[:.]?$`, "iu"), // "BÖLÜM 3"
  new RegExp(`^(${ORDINALS.join("|")})\\s+(${SECTION_WORDS})$`, "iu"),                  // "Birinci Bölüm"
  /^(önsöz|sonsöz|giriş|sunuş|başlarken|ön ?söz|son ?söz|epilog|prolog|sonuç|teşekkür|teşekkürler|çevirmenin notu|yazarın notu|editörün notu)$/iu,
];

function romanToInt(s) {
  const v = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const a = v[s[i]], b = v[s[i + 1]] || 0;
    n += a < b ? -a : a;
  }
  return n;
}
function intToRoman(n) {
  const t = [[100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
}

function similar(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > Math.max(m, n) * 0.3) return 0;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}

function isPageNumber(text) {
  const t = text.replace(/[\s\-–—.·•|]/g, "");
  if (!t || t.length > 5) return false;
  if (/^\d+$/.test(t)) return true;
  // OCR karışıklıkları: s1, l2, I0, O5 vb. — en az bir rakam ve en fazla bir harf
  const digits = (t.match(/\d/g) || []).length;
  return digits >= 1 && t.length - digits <= 1 && t.length <= 4;
}

function headerKey(text) {
  return wordKey(text.replace(/\d+/g, " ")).replace(/\d/g, "");
}

function atEdge(line, page, top) {
  if (!page.height) return false;
  return top ? line.y0 <= page.height * .13 : line.y1 >= page.height * .87;
}

function isolatedEdge(line, neighbor, page, bodyH, top) {
  if (!atEdge(line, page, top)) return false;
  const gap = neighbor ? (top ? neighbor.y0 - line.y1 : line.y0 - neighbor.y1) : 0;
  return line.h < bodyH * .88 || gap > bodyH * 1.55;
}

export function analyze(pages, opts = {}) {
  const { coverFirst = true, backCoverLast = false } = opts;
  const score = opts.score || null;
  const allLines = pages.flatMap((p) => p.lines || []);
  const bodyH = median(allLines.filter((l) => l.words.length >= 4).map((l) => l.h)) || 10;

  // --- 1) Tekrarlayan üst/alt bilgileri bul
  const topCount = new Map(), botCount = new Map();
  for (const p of pages) {
    const ls = p.lines || [];
    for (const [line,neighbor,top,count] of [[ls[0],ls[1],true,topCount],[ls.at(-1),ls.at(-2),false,botCount]]) {
      if (!line || !isolatedEdge(line,neighbor,p,bodyH,top)) continue;
      const key = headerKey(line.text);
      if (key.length >= 3 && key.length <= 70) count.set(key,(count.get(key) || 0)+1);
    }
  }
  const minRep = Math.max(3, Math.floor(pages.length * 0.12));
  const headerKeys = [...topCount].filter(([, c]) => c >= minRep).map(([k]) => k);
  const footerKeys = [...botCount].filter(([, c]) => c >= minRep).map(([k]) => k);
  const matchesAny = (text, keys) => {
    const k = headerKey(text);
    return k.length >= 3 && keys.some((h) => similar(k, h) >= 0.8);
  };

  // --- 2) Her sayfayı temizle ve satırları sınıflandır
  const pitches = [];
  const cleaned = pages.map((p, pi) => {
    let ls = (p.lines || []).filter((l) => LETTER_RE.test(l.text) || /\d/.test(l.text) || /^(?:[*·•]{2,}|[—–])$/.test(l.text.trim()));
    ls = ls.filter((l) => !(l.text.replace(/\s/g, "").length <= 2 && avgConf(l) < 50 && !/^\d+$/.test(l.text.trim())));
    // üst
    for (let k = 0; k < 2 && ls.length; k++) {
      const l = ls[0];
      if (isolatedEdge(l,ls[1],p,bodyH,true) && (isPageNumber(l.text) || matchesAny(l.text,headerKeys))) ls = ls.slice(1); else break;
    }
    // alt
    for (let k = 0; k < 2 && ls.length; k++) {
      const l = ls[ls.length - 1];
      if (isolatedEdge(l,ls.at(-2),p,bodyH,false) && (isPageNumber(l.text) || matchesAny(l.text,footerKeys))) ls = ls.slice(0,-1); else break;
    }
    // OCR'ın harf sandığı küçük, yalnız duran sayfa numarası ("11" → "n")
    const maxW = Math.max(1, ...ls.map((x) => x.x1 - x.x0));
    const tiny = (x) => x.text.replace(/\s/g, "").length <= 3 && (x.x1 - x.x0) < maxW * 0.08 && x.h < bodyH * 1.2;
    if (ls.length > 2 && atEdge(ls.at(-1),p,false) && tiny(ls.at(-1)) && avgConf(ls.at(-1)) < 65 && ls.at(-1).y0 - ls.at(-2).y1 > bodyH * 2) ls = ls.slice(0,-1);
    if (ls.length > 2 && atEdge(ls[0],p,true) && tiny(ls[0]) && avgConf(ls[0]) < 65 && ls[1].y0 - ls[0].y1 > bodyH * 2) ls = ls.slice(1);
    for (let i = 1; i < ls.length; i++) {
      const d = ls[i].y0 - ls[i - 1].y0;
      if (d > 0 && ls[i].column === ls[i - 1].column && ls[i].h < bodyH * 1.2 && ls[i - 1].h < bodyH * 1.2) pitches.push(d);
    }
    return { index: pi, page: p, lines: ls };
  });
  const pitch = median(pitches) || bodyH * 1.4;

  // --- 3) Dipnotları ayır
  for (const c of cleaned) {
    const ls = c.lines;
    const pageH = c.page.height || (ls.length ? ls[ls.length - 1].y1 : 1);
    let start = -1;
    for (let i = ls.length - 1; i >= 1; i--) {
      const l = ls[i];
      if (l.y0 < pageH * 0.4) break;
      const small = l.h < bodyH * 0.93;
      if (/^\*{1,3}\s*\S/.test(l.text) || /^\*{1,3}$/.test(l.words[0].t)) start = i;
      else if (small && /^(\d{1,2}|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)[\s.)]/.test(l.text) && ls.slice(i).every((x) => x.h < bodyH * 1.0)) start = i;
    }
    c.notes = [];
    if (start > 0) {
      for (const l of ls.slice(start)) {
        const m = l.text.match(/^(\*{1,3}|\d{1,2}|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)[\s.)]*/);
        const isStart = m && (m[1].startsWith("*") || l.h < bodyH * 0.93);
        if (isStart || !c.notes.length) {
          const mark = m ? m[1] : "*";
          const words = l.words.slice();
          // işareti ilk kelimeden çıkar
          if (m) {
            const first = words[0].t;
            const rest = first.slice(m[1].length).replace(/^[.)]/, "");
            if (rest) words[0] = { ...words[0], t: rest }; else words.shift();
          }
          c.notes.push({ mark: normMark(mark), lines: [words] });
        } else {
          c.notes[c.notes.length - 1].lines.push(l.words.slice());
        }
      }
      c.lines = ls.slice(0, start);
    }
  }

  // --- 4) Başlıkları işaretle
  let strongCount = 0;
  for (const c of cleaned) {
    const pageBodyH = median(c.lines.filter(l => l.words.length >= 4).map(l => l.h)) || bodyH;
    for (const l of c.lines) {
      const t = l.text.trim();
      l.strong = l.words.length <= 8 && STRONG_RES.some((r) => r.test(t));
      l.big = l.h >= pageBodyH * 1.3 && l.words.length <= 10 && LETTER_RE.test(t);
      if (l.strong) strongCount++;
    }
  }
  const useStrong = strongCount >= 2;
  const bigCount = cleaned.reduce((n, c) => n + c.lines.filter((l) => l.big).length, 0);
  const isHeading = (l) => (useStrong ? l.strong : (l.strong && l.big) || (bigCount >= 2 && bigCount < pages.length * 3 && l.big));

  // --- 5) Bölümleri ve paragrafları kur
  const sections = [];
  let cur = null;
  let para = null;
  let pendingHyph = null;
  let carryQuote = 0;
  const firstContent = coverFirst ? 1 : 0;
  const lastContent = backCoverLast && pages.length > 2 ? pages.length - 2 : pages.length - 1;

  const newSection = (title, kind) => {
    flushHyph();
    cur = { title, kind, paras: [], notes: [], headWords: null };
    sections.push(cur);
    para = null;
  };
  const flushHyph = () => {
    if (pendingHyph && para) { para.words.push(pendingHyph); }
    pendingHyph = null;
  };
  const startPara = (cls) => {
    flushHyph();
    lineEndWord = null;
    para = { words: [], cls };
    cur.paras.push(para);
  };
  let lineEndWord = null; // önceki satırın son kelimesi (tiresi kaybolmuş bölünmeler için)
  const joinHyph = (a, b) => {
    // a "teo-" gibi tireyle biter, b sonraki satırın ilk kelimesi
    const stem = a.t.slice(0, -1);
    if ((!a.softHyphen && !isLowerStart(b.t)) ||
      (!a.softHyphen && a.agree && b.agree && score && score(stem) >= 10 && score(b.t) >= 10 && score(stem+b.t) < 10)) {
      return {...b, t:a.t+b.t, c:Math.min(a.c,b.c), agree:a.agree&&b.agree};
    }
    return { ...b, t: stem + b.t, c: Math.min(a.c, b.c), joined: true, agree: a.agree && b.agree, confirmed: a.confirmed && b.confirmed, disputed: a.disputed || b.disputed };
  };
  const pushLineWords = (words, pageNo) => {
    words.forEach((w0, j) => {
      let w = { t: w0.t, c: w0.c, p: pageNo, agree: w0.agree, confirmed: w0.confirmed, disputed: w0.disputed, softHyphen:w0.softHyphen };
      if (pendingHyph) {
        const jw = joinHyph(pendingHyph, w);
        if (jw) w = jw; else para.words.push(pendingHyph);
        pendingHyph = null;
      } else if (j === 0 && lineEndWord && !(lineEndWord.agree && w.agree) && score && isLowerStart(w.t) && para.words[para.words.length - 1] === lineEndWord
                 && /[A-Za-zÇĞİÖŞÜçğıöşüâîû]$/.test(lineEndWord.t)) {
        // tire hiç görünmüyorsa: "basa" + "mağında" → "basamağında"
        if (shouldJoin(lineEndWord.t, w.t, score)) {
          lineEndWord.t = lineEndWord.t + w.t;
          lineEndWord.c = Math.min(lineEndWord.c, w.c);
          lineEndWord.joined = true;
          lineEndWord = null;
          return;
        }
      }
      if (j === words.length - 1 && /[A-Za-zÇĞİÖŞÜçğıöşüâîû][-‐¬]$/.test(w.t)) { pendingHyph = { ...w, t: w.t.replace(/[‐¬]$/, "-") }; return; }
      para.words.push(w);
      if (j === words.length - 1) lineEndWord = w;
    });
  };

  for (const c of cleaned) {
    const pageNo = c.index + 1;
    const ls = c.lines;
    if (c.index < firstContent) continue;
    const isBack = c.index > lastContent;
    if (isBack) {
      if (!cur || cur.kind !== "back") newSection("Arka Kapak", "back");
    } else if (!cur) {
      newSection("Ön Sayfalar", "front");
    }
    if (!ls.length) {
      if (cur.notes && c.notes) cur.notes.push(...c.notes.map((n) => ({ ...n, page: pageNo })));
      continue;
    }
    const groups = new Map();
    for (const line of ls) {
      if (!groups.has(line.column)) groups.set(line.column,[]);
      groups.get(line.column).push(line);
    }
    const metrics = new Map();
    for (const [column,lines] of groups) {
      const full = lines.filter(l => !isHeading(l) && l.x1 > l.x0);
      const maxW = Math.max(1,...full.map(l => l.x1-l.x0));
      const fit = full.filter(l => l.x1-l.x0 >= maxW*.6);
      const basis = fit.length ? fit : lines;
      const margin = Math.min(...basis.map(l => l.x0)), right = Math.max(...basis.map(l => l.x1));
      metrics.set(column,{margin,right,textW:Math.max(1,right-margin)});
    }
    let prev = null;
    for (const l of ls) { l._heading = false; l._centered = false; l._quote = false; }
    for (const [column,lines] of groups) {
      markQuoteRuns(lines,{...metrics.get(column),bodyH,isHeading,carry:groups.size === 1 ? carryQuote : 0});
    }
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      const {margin,right,textW} = metrics.get(l.column);
      if (!isBack && cur.kind !== "back" && isHeading(l)) {
        // birbirini izleyen başlık satırlarını birleştir
        if (prev && prev._heading && l.y0 - prev.y1 < pitch * 1.6) {
          cur.title += " — " + l.text.trim();
          cur.headWords.push(...l.words);
        } else {
          newSection(l.text.trim(), "chapter");
          cur.headWords = l.words.slice();
          cur.firstPage = pageNo;
        }
        l._heading = true;
        prev = l;
        continue;
      }
      const indent = l.x0 - margin;
      const thr = Math.max(l.h * 0.45, textW * 0.025);
      const centered = indent > textW * 0.08 && Math.abs((l.x0 + l.x1) / 2 - (margin + right) / 2) < textW * 0.06 && (l.x1 - l.x0) < textW * 0.8;
      let newPara = false;
      const columnChange = prev && prev.column !== l.column;
      if (columnChange) newPara = true;
      else if (l._quote) {
        // alıntı bloğu: blok içinde yalnızca ek girinti, boşluk ya da kısa satır sonrası yeni paragraf
        if (!para || !prev || !prev._quote || prev._heading) newPara = !(i === 0 && carryQuote && Math.abs(indent - carryQuote) < thr && para);
        else if (l.y0 - prev.y0 > pitch * 1.65) newPara = true;
        else if (l.x0 > l._quoteBase + thr) newPara = true;
        else if (prev.x1 < l._quoteRight - textW * 0.12 && /[.!?…:”"’»]$/.test(prev.text)) newPara = true;
      } else if (!para || (prev && prev._heading)) newPara = true;
      else if (prev) {
        const gap = l.y0 - prev.y0;
        if (prev._quote) newPara = true;
        else if (gap > pitch * 1.65) newPara = true;
        else if (indent > thr) newPara = true;
        else if (prev.x1 < right - textW * 0.12 && /[.!?…:”"’»]$/.test(prev.text) && !prev._centered) newPara = true;
      } else {
        // sayfanın ilk satırı: yalnızca girintiliyse yeni paragraf
        if (indent > thr) newPara = true;
      }
      if (cur.kind === "front" || cur.kind === "back") {
        if (centered) newPara = true;
      }
      if (newPara && l._quote && !centered) { startPara("quote"); pushLineWords(l.words, pageNo); l._centered = false; prev = l; continue; }
      if (newPara) startPara(centered ? "center" : "");
      pushLineWords(l.words, pageNo);
      l._centered = centered;
      prev = l;
    }
    const lastLine = ls[ls.length - 1];
    carryQuote = lastLine && lastLine._quote ? lastLine.x0 - metrics.get(lastLine.column).margin : 0;
    if (c.notes?.length) cur.notes.push(...c.notes.map((n) => ({ ...n, page: pageNo })));
  }
  flushHyph();

  // --- 6) Bölüm numaralarını düzelt (OCR "HI. Bölüm" gibi hatalar)
  fixNumbering(sections);

  // --- 7) Dipnot işaretlerini bağla
  for (const s of sections) linkNotes(s);

  // boş bölümleri at
  const out = sections.filter((s) => s.paras.some((p) => p.words.length) || s.kind === "chapter");
  if (!out.length) out.push({ title: "Metin", kind: "chapter", paras: [], notes: [] });
  return { sections: out, stats: { bodyH, pitch, strongCount, headers: headerKeys } };
}

function avgConf(l) {
  return l.words.reduce((a, w) => a + w.c, 0) / Math.max(1, l.words.length);
}

function normMark(m) {
  const sup = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return m.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => String(sup.indexOf(c)));
}

function fixNumbering(sections) {
  const chap = sections.filter((s) => s.kind === "chapter");
  const pat = /^(\S{1,6}?)\s*[.)]?\s*(bölüm|kısım)\s*$/iu;
  const matches = chap.map((s) => s.title.split(" — ")[0].match(pat));
  const roman = matches.filter((m) => m && ROMAN_RE.test(m[1].replace(/\.$/, ""))).length;
  const arabic = matches.filter((m) => m && /^\d+$/.test(m[1])).length;
  const total = matches.filter(Boolean).length;
  if (total < 2) return;
  const style = roman >= arabic ? "roman" : "arabic";
  if ((style === "roman" ? roman : arabic) < total * 0.6) return;
  let n = 0;
  chap.forEach((s, i) => {
    const m = matches[i];
    if (!m) return;
    n++;
    const word = m[2];
    const num = style === "roman" ? intToRoman(n) : String(n);
    const rest = s.title.split(" — ").slice(1);
    const raw = m[1].replace(/\.$/, "");
    const parsed = style === "roman" && ROMAN_RE.test(raw) ? romanToInt(raw) : parseInt(raw, 10);
    if (parsed !== n) s.renumbered = true;
    s.title = [`${num}. ${word[0].toLocaleUpperCase("tr")}${word.slice(1).toLocaleLowerCase("tr")}`, ...rest].join(" — ");
  });
}

function linkNotes(s) {
  if (!s.notes.length) return;
  const allWords = s.paras.flatMap((p) => p.words);
  s.notes.forEach((n, idx) => {
    n.id = idx + 1;
    let found = null;
    for (const w of allWords) {
      if (w.ref || (n.page && w.p && w.p !== n.page)) continue;
      if (n.mark.startsWith("*")) {
        if (w.t.includes(n.mark) && !w.t.startsWith("*")) { found = w; break; }
        if (w.t.includes("*")) { found = w; break; }
      } else {
        const m = w.t.match(/^(.*[A-Za-zÇĞİÖŞÜçğıöşü.,;:!?”’"'])([⁰¹²³⁴⁵⁶⁷⁸⁹]+|\d{1,2})([.,;:!?”’"']*)$/);
        if (m && normMark(m[2]) === n.mark) { found = w; w.t = m[1] + m[3]; w.refPos = m[1].length; break; }
      }
    }
    if (found) {
      if (n.mark.startsWith("*")) {
        found.refPos = found.t.indexOf("*");
        found.t = found.t.replace(/\*+/, "");
      }
      found.ref = n.id;
    }
  });
}

// Girintili alıntı blokları: art arda en az 3 girintili satır (sonuncusu hariç hepsi uzun),
// ya da daha küçük puntoyla yazılmış en az 2 girintili satır.
function markQuoteRuns(ls, { margin, right, textW, bodyH, isHeading, carry }) {
  let i = 0;
  // önceki sayfadan devam eden alıntı: sayfa başındaki aynı girintili satırlar
  if (carry) {
    while (i < ls.length && !isHeading(ls[i])) {
      const x = ls[i];
      const thr = Math.max(x.h * 0.45, textW * 0.025);
      const next = ls[i + 1];
      // girintili satırın altındaki satır kenar boşluğundaysa bu normal paragraf başıdır, alıntı değil
      if (next && !isHeading(next) && next.x0 - margin <= thr && !(x.x1 < right - textW * 0.12)) break;
      if (Math.abs((x.x0 - margin) - carry) < thr || (i > 0 && x.x0 - margin > carry + thr && ls[i - 1]._quote)) {
        x._quote = true; x._quoteBase = margin + carry; x._quoteRight = right; i++;
      } else break;
    }
  }
  while (i < ls.length) {
    const l = ls[i];
    const thr = Math.max(l.h * 0.45, textW * 0.025);
    if (isHeading(l) || l.x0 - margin <= thr) { i++; continue; }
    let j = i;
    while (j + 1 < ls.length && !isHeading(ls[j + 1]) && ls[j + 1].x0 - margin > thr) j++;
    // alıntının sol hizasından daha az girintili satır = sonraki normal paragrafın başı; orada kes
    const xs = ls.slice(i, j + 1).map((x) => x.x0).sort((a, b) => a - b);
    const med = xs[Math.floor(xs.length / 2)];
    for (let k = i + 1; k <= j; k++) if (ls[k].x0 < med - thr * 0.5) { j = k - 1; break; }
    const run = ls.slice(i, j + 1);
    if (run.length >= 2) {
      const base = Math.min(...run.map((x) => x.x0));
      const qRight = Math.max(...run.map((x) => x.x1));
      const isLong = (x) => x.x1 > qRight - textW * 0.04; // iki yana yaslı alıntı satırları sağ kenara dayanır
      // ilk satır mutlaka uzun olmalı; içerideki kısa satırlara yalnızca cümle sonuysa izin ver
      const longEnough = isLong(run[0]) && run.slice(1, -1).every((x) => isLong(x) || (run.length >= 4 && /[.!?…:”"’»]$/.test(x.text)));
      const sameLeft = run.filter((x) => Math.abs(x.x0 - base) < thr).length >= run.length - 1;
      const hs = run.map((x) => x.h).sort((a, b) => a - b);
      const small = hs[Math.floor(hs.length / 2)] < bodyH * 0.86;
      const centeredRun = run.every((x) => Math.abs((x.x0 + x.x1) / 2 - (margin + right) / 2) < textW * 0.06 && (x.x1 - x.x0) < textW * 0.8);
      if (!centeredRun && sameLeft && longEnough && (run.length >= 3 || small)) {
        run.forEach((x) => { x._quote = true; x._quoteBase = base; x._quoteRight = qRight; });
      }
    }
    i = j + 1;
  }
}
