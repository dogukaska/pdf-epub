import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { analyze } from "../lib/layout.js";
import { hasMojibake, fixMojibake, normalizeText } from "../lib/turkish.js";
import { buildEpub } from "../lib/epub.js";

const require = createRequire(import.meta.url);
globalThis.window = { JSZip: require("../vendor/jszip.min.js") };

test("Türkçe karakterler ve iki eski kodlama biçimi", () => {
  const source = "İstanbul’da ışık, İzmir’de üzüm; Çığ, öğüt, kâğıt, rüzgâr ve mûsiki.";
  const legacy = "Ýstanbul  ýsýk þiþe  dað";
  const utf8asLatin = String.fromCharCode(...new TextEncoder().encode("İstanbul, ışık, şükür, mûsiki"));
  assert.equal(normalizeText(source),source);
  assert.equal(hasMojibake(source),0);
  assert.ok(hasMojibake(legacy)>2);
  assert.equal(fixMojibake(legacy),"İstanbul  ısık şişe  dağ");
  assert.equal(fixMojibake(utf8asLatin),"İstanbul, ışık, şükür, mûsiki");
  assert.equal(normalizeText("bozuk � harf"),"bozuk � harf");
});

test("kitap gövdesindeki tekrarlanan dizeler üst bilgi olarak atılmaz", () => {
  const line = (text,y) => ({
    text,words:text.split(" ").map(t=>({t,c:100,agree:true})),x0:52,x1:350,y0:y,y1:y+13,h:13,
  });
  const pages = Array.from({length:3},()=>({height:800,width:500,lines:[
    {...line("Kitap kenar bilgisi",17),h:8,y1:25},
    line("Bu cümle şiirin nakaratıdır.",65),
    line("İstanbul geceleri ışıl ışıl.",84),
    line("Bu cümle şiirin nakaratıdır.",103),
  ]}));
  const {sections}=analyze(pages,{coverFirst:false});
  const text=sections.flatMap(s=>s.paras.flatMap(p=>p.words.map(w=>w.t))).join(" ");
  assert.equal(text.match(/Bu cümle şiirin nakaratıdır\./g)?.length,6);
  assert.doesNotMatch(text,/Kitap kenar bilgisi/);
});

test("EPUB Türkçe dilini, dipnotu ve yinelenen dipnot bağlarını korur", async () => {
  const chapter={title:"Çığ ve ışık",kind:"chapter",paras:[
    {segs:[{text:"İlk cümle"},{ref:1,label:"1"},{text:". Aynı dipnot"},{ref:1,label:"1"},{text:"."}]},
    {segs:[{text:"İkinci paragraf ve özel ad: Gülşah."}]},
  ],notes:[{id:1,label:"1",text:"Türkçe dipnot: Kâğıt, rüzgâr, mûsiki."}]};
  const blob=await buildEpub({title:"Türkçe Kitap",author:"Gülşah",lang:"tr"},[chapter],null);
  const zip=await window.JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(Object.keys(zip.files)[0],"mimetype");
  assert.equal(await zip.file("mimetype").async("string"),"application/epub+zip");
  const chapterXml=await zip.file("OEBPS/bolum001.xhtml").async("string");
  assert.match(chapterXml,/xml:lang="tr"/);
  assert.equal(chapterXml.match(/href="#n1_1"/g)?.length,2);
  assert.match(chapterXml,/id="r1_1_1"/);
  assert.match(chapterXml,/id="r1_1_2"/);
  assert.match(chapterXml,/href="#r1_1_1"/);
  assert.match(chapterXml,/Kâğıt, rüzgâr, mûsiki/);
  assert.match(await zip.file("OEBPS/content.opf").async("string"),/<dc:language>tr<\/dc:language>/);
  await assert.rejects(buildEpub({title:"Boş"},[],null),/eklenecek metin yok/);
});
