// EPUB 3 (EPUB 2 içindekiler dosyasıyla birlikte) üretir. Tüm metin UTF-8, dil "tr".
import { escapeXml } from "./turkish.js";

// XML'de yasak karakterler kalırsa e-okuyucu bölümü hiç açamaz
const esc = (s) => escapeXml(String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, ""));

const CSS = `@charset "UTF-8";
body { margin: 0 0.4em; line-height: 1.45; text-align: justify; hyphens: auto; -epub-hyphens: auto; -webkit-hyphens: auto; }
p { margin: 0; text-indent: 1.3em; orphans: 2; widows: 2; }
p.center { text-align: center; text-indent: 0; margin: 0.3em 0; }
p.quote { margin: 0.6em 0 0.6em 1.5em; text-indent: 0; font-size: 0.95em; }
h2 { text-align: center; font-size: 1.3em; margin: 2.5em 0 1.6em; page-break-before: always; font-weight: bold; }
h2 + p { text-indent: 0; }
.front p, .back p { text-indent: 0; margin-bottom: 0.5em; }
.cover { text-align: center; margin: 0; padding: 0; }
.cover img { max-width: 100%; max-height: 100%; }
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
 * coverBlob: Blob | null
 */
export async function buildEpub(meta, sections, coverBlob) {
  const JSZip = window.JSZip;
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  const lang = meta.lang || "tr";
  const files = [];

  if (coverBlob) {
    zip.file("OEBPS/cover.jpg", coverBlob);
    files.push({ id: "cover", href: "cover.xhtml", title: "Kapak", toc: false,
      xml: page("Kapak", `<div class="cover"><img src="cover.jpg" alt="${esc(meta.title || "Kapak")}"/></div>`) });
  }

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
    body.push(`<h2 id="s${ci}">${esc(s.title)}</h2>`);
    for (const p of s.paras) {
      const html = p.segs.map((g) => g.ref
        ? `<a class="nref" epub:type="noteref" href="#n${ci}_${g.ref}" id="r${ci}_${g.ref}">${g.label ? esc(g.label) : g.ref}</a>`
        : esc(g.text)).join("").trim();
      if (!html) continue;
      body.push(`<p${p.cls ? ` class="${p.cls}"` : ""}>${html}</p>`);
    }
    if (s.notes.length) {
      body.push(`<hr class="fnsep"/>`);
      for (const note of s.notes) {
        const back = note.linked ? `<a href="#r${ci}_${note.id}">${esc(note.label || String(note.id))}</a> ` : "";
        body.push(`<aside epub:type="footnote" id="n${ci}_${note.id}" class="fn"><p>${back}${esc(note.text)}</p></aside>`);
      }
    }
    const cls = s.kind === "front" ? "front" : s.kind === "back" ? "back" : "chapter";
    files.push({ id: `s${String(ci).padStart(3, "0")}`, href: `bolum${String(ci).padStart(3, "0")}.xhtml`, title: s.title, toc: true, xml: page(s.title, body.join("\n"), cls) });
  }

  const uid = "urn:uuid:" + uuidv4();
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const manifest = [
    `<item id="css" href="style.css" media-type="text/css"/>`,
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
  ];
  if (coverBlob) manifest.push(`<item id="coverimg" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>`);
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
${coverBlob ? `<meta name="cover" content="coverimg"/>` : ""}
</metadata>
<manifest>
${manifest.join("\n")}
</manifest>
<spine toc="ncx">
${spine.join("\n")}
</spine>
<guide>${coverBlob ? `<reference type="cover" title="Kapak" href="cover.xhtml"/>` : ""}<reference type="text" title="Başlangıç" href="${firstText.href}"/></guide>
</package>`;

  const tocItems = files.filter((f) => f.toc);
  const nav = page("İçindekiler", `<nav epub:type="toc" id="toc"><h2>İçindekiler</h2><ol>${tocItems.map((f) => `<li><a href="${f.href}">${esc(f.title)}</a></li>`).join("")}</ol></nav>
<nav epub:type="landmarks" hidden=""><ol>${coverBlob ? `<li><a epub:type="cover" href="cover.xhtml">Kapak</a></li>` : ""}<li><a epub:type="bodymatter" href="${firstText.href}">Başlangıç</a></li></ol></nav>`);
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
