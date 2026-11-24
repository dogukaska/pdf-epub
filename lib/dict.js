// Türkçe kelime sıklık sözlüğü (≈630 bin kelime biçimi).
// Bellek dostu: tek büyük metin + satır başı dizini + ikili arama.
import { wordKey } from "./turkish.js";

let TEXT = null;
let STARTS = null;
const cache = new Map();

async function gunzipIfNeeded(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return await new Response(stream).text();
  }
  return new TextDecoder("utf-8").decode(u8);
}

export async function loadDict(url) {
  if (TEXT) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Sözlük yüklenemedi");
  TEXT = await gunzipIfNeeded(await res.arrayBuffer());
  const starts = [0];
  for (let i = 0; i < TEXT.length; i++) if (TEXT.charCodeAt(i) === 10) starts.push(i + 1);
  STARTS = Int32Array.from(starts);
}

export function dictReady() { return !!TEXT; }

function wordAt(i) {
  const s = STARTS[i];
  const tab = TEXT.indexOf("\t", s);
  return TEXT.slice(s, tab);
}

function lookup(key) {
  let lo = 0, hi = STARTS.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = wordAt(mid);
    if (w === key) {
      const b = TEXT.charCodeAt(STARTS[mid] + w.length + 1) - 48;
      return Math.pow(2, b);
    }
    if (w < key) lo = mid + 1; else hi = mid - 1;
  }
  return 0;
}

// Sözlükteki yaklaşık kullanım sıklığı (0 = bilinmiyor)
export function dictFreq(word) {
  if (!TEXT) return 0;
  let k = wordKey(word.split(/['’]/)[0]);
  if (!k) return 0;
  if (cache.has(k)) return cache.get(k);
  const f = lookup(k);
  cache.set(k, f);
  return f;
}
