# PDF → EPUB (Türkçe karakterlere duyarlı)

Taranmış ya da dijital PDF kitapları, Türkçe karakterleri (ı, İ, ş, ğ, ç, ö, ü, â) bozmadan e-okuyucularda (Onyx Boox, Kobo, Kindle, PocketBook…) rahat okunacak EPUB dosyalarına çeviren web uygulaması.

**Her şey tarayıcıda çalışır.** PDF dosyası hiçbir sunucuya yüklenmez.

## Nasıl çalışır?

1. **Sayfa başına metin seçimi.** Okunabilir PDF metni korunur. Taranmış veya bozuk metin katmanlı sayfalar Türkçe OCR ile okunur. İlk ve son sayfa ayrı ayrı kapak olarak seçilebilir. İşaretlenen sayfalar EPUB’a renkli PNG olarak eklenir ve metin dönüşümüne girmez.
2. **OCR denetimi.** Uygun olduğunda PDF metni ve Türkçe sözlük karşılaştırılır. Önerilen mod, şüpheli satırları daha yüksek çözünürlükte yeniden okur.
3. **Sayfa düzeni.** Düzenli çift sütunlar okuma sırasına alınır. Paragraf, başlık ve dipnot ayrımı yapılır. Üst bilgi temizliği sayfanın kenarındaki belirgin tekrarlarla sınırlıdır.
4. **Kontrol ekranı.** Şüpheli kelimeler sarı görünür. Sonraki kelimeye geçtiğinde kaynak PDF sayfasını açabilirsin. Düşük kaliteli taramalarda gözden geçirme özellikle önemlidir.
5. **EPUB 3.** İçindekiler, tıklanabilir dipnotlar, Türkçe dil bilgisi ve yeniden akışa uygun metin üretilir.

Temel metin ve paketleme kontrolleri: `node --test tests/text-and-epub.test.mjs`. Üretilen dosyalar [EPUBCheck](https://github.com/w3c/epubcheck) ile doğrulanabilir. OCR yerleşiminde [Tesseract kalite kılavuzundaki](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html) sayfa ve satır ayrımı kullanılır.

## Yayınlama (GitHub Pages)

Depo ayarlarında **Settings → Pages → Branch: `main` / `(root)` → Save**. Birkaç dakika sonra uygulama
`https://dogukaska.github.io/pdf-epub/` adresinde açılır.

Yerelde denemek için: `python3 -m http.server` ve tarayıcıda `http://localhost:8000`.

## Dosyalar

- `index.html`, `style.css`, `app.js`: arayüz
- `lib/pdfsource.js`: PDF okuma (PDF.js)
- `lib/ocr.js`: Türkçe OCR (tesseract.js)
- `lib/reconcile.js`: OCR + PDF metni + sözlük doğrulaması, ikinci tarama kararları
- `lib/dict.js`: Türkçe sıklık sözlüğü (ikili arama, düşük bellek)
- `lib/layout.js`: başlık, paragraf, dipnot ve sayfa numarası algılama
- `lib/turkish.js`: Türkçe karakter düzeltmeleri, tipografik tırnaklar
- `lib/epub.js`: EPUB üretimi (JSZip)
- `lang/tur.traineddata.gz`: Tesseract Türkçe dil modeli
- `lang/tr-words.txt.gz`: Türkçe kelime sıklık listesi

## Lisanslar

Uygulama kodu MIT lisanslıdır. Kullanılan kütüphaneler: [PDF.js](https://github.com/mozilla/pdf.js) (Apache 2.0), [tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0), [Tesseract tessdata](https://github.com/tesseract-ocr/tessdata) (Apache 2.0), [JSZip](https://github.com/Stuk/jszip) (MIT). Türkçe sözlük, [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (Hermit Dave, CC BY-SA 4.0, OpenSubtitles verisi) listesinden türetilmiştir. Lisans metinleri `vendor/` klasöründedir.
