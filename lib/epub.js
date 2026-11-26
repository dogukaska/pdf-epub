// EPUB 3 (EPUB 2 içindekiler dosyasıyla birlikte) üretir. Tüm metin UTF-8, dil "tr".
import { escapeXml } from "./turkish.js?v=20261126e";

// XML'de yasak karakterler kalırsa e-okuyucu bölümü hiç açamaz
const esc = (s) => escapeXml(String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, ""));

const CSS = `@charset "UTF-8";
body { margin: 0 0.4em; line-height: 1.45; text-align: start; hyphens: auto; -epub-hyphens: auto; -webkit-hyphens: auto; overflow-wrap: break-word; }
p { margin: 0; text-indent: 1.3em; orphans: 2; widows: 2; }
p.center { text-align: center; text-indent: 0; margin: 0.3em 0; }
p.quote { margin: 0.6em 0 0.6em 1.5em; text-indent: 0; font-size: 0.95em; }
h2 { text-align: center; font-size: 1.3em; margin: 1.1em 0 1em; font-weight: bold; break-after: avoid; page-break-after: avoid; }
h2 + p { text-indent: 0; }
.front p, .back p { text-indent: 0; margin-bottom: 0.5em; }
.cover { text-align: center; margin: 0; padding: 0; }
.cover img { max-width: 100%; max-height: 100%; max-height: 95vh; object-fit: contain; }
.titlepage { text-align: center; margin-top: 3em; }
.titlepage p { text-indent: 0; text-align: center; margin: 0.4em 0; }
.t-title { font-size: 1.7em; font-weight: bold; margin: 0.6em 0; }
a.nref { text-decoration: none; vertical-align: super; font-size: 0.75em; line-height: 0; }
hr.fnsep { width: 30%; margin: 2em 0 0.6em 0; border: 0; border-top: 1px solid #000; }
aside.fn p { font-size: 0.85em; text-indent: 0; margin-bottom: 0.5em; }
aside.fn a { text-decoration: none; }
`;

function page(title, body, cls = "") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="tr" lang="tr">
<head><meta charset="UTF-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body${cls ? ` class="${cls}"` : ""}>
${body}
</body>
</html>`;
}

function uuidv4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * meta: {title, author, translator, publisher, lang}
 * sections: [{title, kind, paras:[{cls, segs:[{text}|{ref}]}], notes:[{id, text}], showTitle}]
 * covers: {front?: Blob, back?: Blob}, renkli PNG görselleri
 */
export async function buildEpub(meta, sections, covers) {
  const hasText = section => section.paras.some(p => p.segs.some(g => g.text?.trim())) || section.notes.some(note => note.text?.trim());
  if (!sections.some(hasText)) throw Error("EPUB’a eklenecek metin yok. En az bir bölümü seç.");
  sections = sections.filter(section => section.kind === "chapter" || hasText(section));
  const JSZip = window.JSZip;
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  const lang = meta.lang || "tr";
  const files = [];
  const {front,back} = covers ?? {};

  const coverPage = (id,label,image,toc,kind) => {
    zip.file(`OEBPS/${id}.png`,image);
    files.push({id,href:`${id}.xhtml`,title:label,toc,
      xml:page(label,`<div class="cover" epub:type="${kind}"><img src="${id}.png" alt="${label}"/></div>`)});
  };
  if (front) coverPage("cover","Ön Kapak",front,false,"cover");

  const tp = [`<div class="titlepage">`];
  if (meta.author) tp.push(`<p>${esc(meta.author)}</p>`);
  tp.push(`<p class="t-title">${esc(meta.title || "Adsız Kitap")}</p>`);
  if (meta.translator) tp.push(`<p><i>Çeviren: ${esc(meta.translator)}</i></p>`);
  if (meta.publisher) tp.push(`<p>${esc(meta.publisher)}</p>`);
  tp.push(`</div>`);
  files.push({ id: "title", href: "title.xhtml", title: "Başlık Sayfası", toc: false, xml: page(meta.title || "Başlık", tp.join("\n")) });

  let n = 0;
  for (const s of sections) {
    n++;
    const ci = n;
    const body = [];
    const noteIds = new Set(s.notes.map(note => note.id));
    const anchors = new Map();
    body.push(`<h2 id="s${ci}">${esc(s.title)}</h2>`);
    for (const p of s.paras) {
      const html = p.segs.map(g => {
        if (!g.ref) return esc(g.text);
        const label = esc(g.label || g.ref);
        if (!noteIds.has(g.ref)) return label;
        const count = (anchors.get(g.ref) || 0) + 1;
        anchors.set(g.ref,count);
        return `<a class="nref" epub:type="noteref" href="#n${ci}_${g.ref}" id="r${ci}_${g.ref}_${count}">${label}</a>`;
      }).join("").trim();
      if (!html) continue;
      body.push(`<p${p.cls ? ` class="${esc(p.cls)}"` : ""}>${html}</p>`);
    }
    if (s.notes.length) {
      body.push(`<hr class="fnsep"/>`);
      for (const note of s.notes) {
        const label = esc(note.label || String(note.id));
        const back = anchors.has(note.id) ? `<a href="#r${ci}_${note.id}_1">${label}</a> ` : label + " ";
        body.push(`<aside epub:type="footnote" id="n${ci}_${note.id}" class="fn"><p>${back}${esc(note.text)}</p></aside>`);
      }
    }
    const cls = s.kind === "front" ? "front" : s.kind === "back" ? "back" : "chapter";
    files.push({ id: `s${String(ci).padStart(3, "0")}`, href: `bolum${String(ci).padStart(3, "0")}.xhtml`, title: s.title, toc: true, xml: page(s.title, body.join("\n"), cls) });
  }
  if (back) coverPage("back-cover","Arka Kapak",back,true,"backmatter");

  const uid = "urn:uuid:" + uuidv4();
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const manifest = [
    `<item id="css" href="style.css" media-type="text/css"/>`,
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
  ];
  if (front) manifest.push(`<item id="coverimg" href="cover.png" media-type="image/png" properties="cover-image"/>`);
  if (back) manifest.push(`<item id="back-cover-img" href="back-cover.png" media-type="image/png"/>`);
  for (const f of files) manifest.push(`<item id="${f.id}" href="${f.href}" media-type="application/xhtml+xml"/>`);
  const spine = files.map((f) => `<itemref idref="${f.id}"/>`);
  const firstText = files.find((f) => f.toc) || files[0];

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${uid}</dc:identifier>
<dc:title>${esc(meta.title || "Adsız Kitap")}</dc:title>
${meta.author ? `<dc:creator>${esc(meta.author)}</dc:creator>` : ""}
${meta.translator ? `<dc:contributor>${esc(meta.translator)}</dc:contributor>` : ""}
${meta.publisher ? `<dc:publisher>${esc(meta.publisher)}</dc:publisher>` : ""}
<dc:language>${lang}</dc:language>
<meta property="dcterms:modified">${now}</meta>
${front ? `<meta name="cover" content="coverimg"/>` : ""}
</metadata>
<manifest>
${manifest.join("\n")}
</manifest>
<spine toc="ncx">
${spine.join("\n")}
</spine>
<guide>${front ? `<reference type="cover" title="Ön Kapak" href="cover.xhtml"/>` : ""}<reference type="text" title="Başlangıç" href="${firstText.href}"/></guide>
</package>`;

  const tocItems = files.filter((f) => f.toc);
  const nav = page("İçindekiler", `<nav epub:type="toc" id="toc"><h2>İçindekiler</h2><ol>${tocItems.map((f) => `<li><a href="${f.href}">${esc(f.title)}</a></li>`).join("")}</ol></nav>
<nav epub:type="landmarks" hidden=""><ol>${front ? `<li><a epub:type="cover" href="cover.xhtml">Ön Kapak</a></li>` : ""}<li><a epub:type="bodymatter" href="${firstText.href}">Başlangıç</a></li></ol></nav>`);
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${lang}">
<head><meta name="dtb:uid" content="${uid}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
<docTitle><text>${esc(meta.title || "Adsız Kitap")}</text></docTitle>
<navMap>
${tocItems.map((f, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(f.title)}</text></navLabel><content src="${f.href}"/></navPoint>`).join("\n")}
</navMap>
</ncx>`;

  zip.file("OEBPS/content.opf", opf);
  zip.file("OEBPS/toc.ncx", ncx);
  zip.file("OEBPS/nav.xhtml", nav);
  zip.file("OEBPS/style.css", CSS);
  for (const f of files) zip.file("OEBPS/" + f.href, f.xml);
  return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE", compressionOptions: { level: 9 } });
}
