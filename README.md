# PDF → EPUB (Türkçe karakterlere duyarlı)

Taranmış ya da dijital PDF kitapları, Türkçe karakterleri (ı, İ, ş, ğ, ç, ö, ü, â) bozmadan e-okuyucularda (Onyx Boox, Kobo, Kindle, PocketBook…) rahat okunacak EPUB dosyalarına çeviren web uygulaması.

**Her şey tarayıcıda çalışır.** PDF dosyası hiçbir sunucuya yüklenmez.

## Nasıl çalışır?

1. **PDF incelenir.** Sayfalar taranmış resim mi, yoksa gerçek metin mi, ona bakılır. Metnin bozuk olup olmadığı ölçülür (ör. `ý þ ð` gibi eski kodlama hataları otomatik onarılır).
2. **Türkçe OCR.** Taranmış kitaplarda her sayfa, Tesseract'ın Türkçe modeliyle 300 dpi'da yeniden okunur.
3. **İki kaynak birleştirilir.** PDF'te eski bir OCR metni varsa yeni okumayla kelime kelime karşılaştırılır. Böylece kesme işaretleri ve iç içe tırnaklar düzelir.
4. **Kitabın kendi sözlüğüyle kontrol.** Kitapta yüzlerce kez geçen bir kelime bir yerde yanlış okunduysa (ör. `Jirnmie` → `Jimmie`) düzeltilir.
5. **Sayfa düzeni temizlenir.** Üst bilgiler, sayfa numaraları ve satır sonu tireleri kaldırılır. Paragraflar birleştirilir, bölüm başlıkları ve dipnotlar bulunur.
6. **Kontrol ekranı.** Emin olunmayan kelimeler sarı ile gösterilir. Metni, bölüm adlarını düzeltebilir, istemediğin bölümü silebilirsin.
7. **EPUB 3.** Kapaklı, içindekiler listeli, tıklanabilir dipnotlu ve dili `tr` olarak işaretli bir dosya oluşturulur.

## Yayınlama (GitHub Pages)

Depo ayarlarında **Settings → Pages → Branch: `main` / `(root)` → Save**. Birkaç dakika sonra uygulama
`https://renkistan.github.io/pdf-epub/` adresinde açılır.

Yerelde denemek için: `python3 -m http.server` ve tarayıcıda `http://localhost:8000`.

## Dosyalar

- `index.html`, `style.css`, `app.js`: arayüz
- `lib/pdfsource.js`: PDF okuma (PDF.js)
- `lib/ocr.js`: Türkçe OCR (tesseract.js)
- `lib/merge.js`: OCR ile eski metni birleştirme, kitap içi düzeltme
- `lib/layout.js`: başlık, paragraf, dipnot ve sayfa numarası algılama
- `lib/turkish.js`: Türkçe karakter düzeltmeleri, tipografik tırnaklar
- `lib/epub.js`: EPUB üretimi (JSZip)
- `lang/tur.traineddata.gz`: Tesseract Türkçe dil modeli

## Lisanslar

Uygulama kodu MIT lisanslıdır. Kullanılan kütüphaneler: [PDF.js](https://github.com/mozilla/pdf.js) (Apache 2.0), [tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0), [Tesseract tessdata](https://github.com/tesseract-ocr/tessdata) (Apache 2.0), [JSZip](https://github.com/Stuk/jszip) (MIT). Lisans metinleri `vendor/` klasöründedir.
