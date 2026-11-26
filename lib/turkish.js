// Türkçe metin düzeltme yardımcıları

const LIGATURES = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };

// Eski Windows-1254 / 1252 karışıklığından doğan bozuk harfler.
// Bu harfler Türkçede hiç geçmediği için güvenle düzeltilebilir.
const MOJIBAKE = { "ý": "ı", "Ý": "İ", "þ": "ş", "Þ": "Ş", "ð": "ğ", "Ð": "Ğ" };

export function normalizeText(s, keepSoftHyphen = false) {
  if (!s) return "";
  s = s.normalize("NFC");
  if (!keepSoftHyphen) s = s.replace(/­/g, ""); // yumuşak tire
  s = s.replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] || c);
  s = s.replace(/i̇/g, "i");                   // i + birleşik nokta
  s = s.replace(/[​‌‍﻿]/g, "");
  // kontrol karakterleri (bazı PDF'lerin metninde bulunur; EPUB'ı açılmaz hale getirir)
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F￾￿]/g, "");
  s = s.replace(/[   ]/g, " ");
  s = s.replace(/[‐‑]/g, "-");            // farklı tire biçimleri
  return s;
}

export function hasMojibake(text) {
  let count = text.match(/[ýÝþÞðÐ]/g)?.length || 0;
  for (const wrong of UTF8_GLITCHES.keys()) count += text.split(wrong).length - 1;
  return count;
}

// UTF-8 harfler Windows-1252 / Latin-1 olarak yanlış yorumlandığında.
const UTF8_GLITCHES = new Map();
for (const character of "çÇğĞıİöÖşŞüÜâÂîÎûÛ") {
  const bytes = new TextEncoder().encode(character);
  UTF8_GLITCHES.set(new TextDecoder("windows-1252").decode(bytes), character);
  UTF8_GLITCHES.set(String.fromCharCode(...bytes), character);
}

export function fixMojibake(s) {
  for (const [wrong, right] of UTF8_GLITCHES) s = s.replaceAll(wrong, right);
  return s.replace(/[ýÝþÞðÐ]/g, (c) => MOJIBAKE[c]);
}

const TR_LETTER = "A-Za-zÇĞİÖŞÜçğıöşüÂÎÛâîûÊêÉéÀàÈèÄäËëÏïÑñÓóÒòÕõÚúÙùß";
export const LETTER_RE = new RegExp(`[${TR_LETTER}]`);
const WORD_RE = new RegExp(`^[“”"'‘’(\\[«]*[${TR_LETTER}]+(['’][${TR_LETTER}]+)?([-–][${TR_LETTER}]+)*[.,;:!?…”"'’)\\]»]*$`);

// Bir metin katmanının ne kadar "okunur" olduğunu ölçer (0..1)
export function textQuality(words) {
  if (!words.length) return 0;
  let ok = 0, total = 0;
  for (const w of words) {
    if (/^\d+[.,:)]*$/.test(w)) continue;
    total++;
    if (WORD_RE.test(w) && !/[-�]/.test(w)) ok++;
  }
  return total ? ok / total : 0;
}

// Karşılaştırma anahtarı: küçük harf, noktalama yok
export function wordKey(w) {
  return normalizeText(w)
    .toLocaleLowerCase("tr")
    .replace(new RegExp(`[^${TR_LETTER}0-9]`, "g"), "");
}

const QUOTES = /["'“”‘’«»„]/g;
export function punctOf(w) {
  return w.replace(new RegExp(`[${TR_LETTER}0-9]`, "g"), "");
}
export function normQuotes(s) {
  return s.replace(/[“”«»„"]/g, '"').replace(/[‘’']/g, "'");
}
export function countQuotes(s) {
  return (s.match(QUOTES) || []).length;
}

// Düz tırnakları tipografik tırnağa çevirir, kelime içi tırnakları kesme yapar
export function typography(s) {
  // harf + tırnak/soru işareti benzeri + küçük harf  →  kesme işareti (Ali”nin → Ali’nin)
  s = s.replace(new RegExp(`([${TR_LETTER}])[”"'‘´\`](?=[a-zçğıöşüâîû])`, "g"), "$1’");
  s = s.replace(/(^|[\s(\[—–\u0001\u0002-])"/g, "$1“").replace(/"/g, "”");
  s = s.replace(/(^|[\s(\[“—–\u0001\u0002-])'/g, "$1‘").replace(/'/g, "’");
  s = s.replace(/\.\s?\.\s?\./g, "…");
  s = s.replace(/»/g, "”").replace(/«/g, "“");
  s = s.replace(/ +([,.;:!?…])(?=[\s\u0001\u0002]|$)/g, "$1");
  s = s.replace(/ {2,}/g, " ");
  return s.trim();
}

export function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function isLowerStart(w) {
  return /^[a-zçğıöşüâîû]/.test(w || "");
}
