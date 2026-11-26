# PDF → EPUB (Türkçe karakterlere duyarlı)

Taranmış ya da dijital PDF kitapları, Türkçe karakterleri (ı, İ, ş, ğ, ç, ö, ü, â) bozmadan e-okuyucularda (Onyx Boox, Kobo, Kindle, PocketBook…) rahat okunacak EPUB dosyalarına çeviren web uygulaması.

**Her şey tarayıcıda çalışır.** PDF dosyası hiçbir sunucuya yüklenmez.

[PDF → EPUB aracını aç](https://dogukaska.github.io/pdf-epub/)

## Nasıl çalışır?

1. **Sayfa başına metin seçimi.** Okunabilir PDF metni korunur. Taranmış veya bozuk metin katmanlı sayfalar Türkçe OCR ile okunur. Doğrudan açılan çok sayfalı PDF’lerin ilk sayfası otomatik kapak görseli olarak eklenir ve metni de işlenir. Belge Tarayıcı’nın Kitap sekmesinde seçilen ön ve arka kapaklar EPUB’a renkli görsel olarak aktarılır.
2. **OCR denetimi.** Uygun olduğunda PDF metni ve Türkçe sözlük karşılaştırılır. Önerilen mod, şüpheli satırları daha yüksek çözünürlükte yeniden okur.
3. **Sayfa düzeni.** Düzenli çift sütunlar okuma sırasına alınır. Paragraf, başlık ve dipnot ayrımı yapılır. Üst bilgi temizliği sayfanın kenarındaki belirgin tekrarlarla sınırlıdır.
4. **Kontrol ekranı.** Şüpheli kelimeler sarı görünür. Sonraki kelimeye geçtiğinde kaynak PDF sayfasını açabilirsin. Düşük kaliteli taramalarda gözden geçirme özellikle önemlidir.
5. **EPUB 3.** İçindekiler, tıklanabilir dipnotlar, Türkçe dil bilgisi ve yeniden akışa uygun metin üretilir.

## Lisanslar

Uygulama kodu MIT lisanslıdır. Kullanılan kütüphaneler: [PDF.js](https://github.com/mozilla/pdf.js) (Apache 2.0), [tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0), [Tesseract tessdata](https://github.com/tesseract-ocr/tessdata) (Apache 2.0), [JSZip](https://github.com/Stuk/jszip) (MIT). Türkçe sözlük, [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (Hermit Dave, CC BY-SA 4.0, OpenSubtitles verisi) listesinden türetilmiştir. Lisans metinleri `vendor/` klasöründedir.

Türkçe PDF’den EPUB’a dönüştürücünün geliştirilmesine Claude, dönüştürme ve renkli kapak aktarımının geliştirme ve test çalışmalarına OpenAI Codex katkıda bulundu.
