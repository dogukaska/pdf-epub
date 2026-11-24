# PDF → EPUB (Türkçe karakterlere duyarlı)

Taranmış ya da dijital PDF kitapları, Türkçe karakterleri (ı, İ, ş, ğ, ç, ö, ü, â) bozmadan e-okuyucularda (Onyx Boox, Kobo, Kindle, PocketBook…) rahat okunacak EPUB dosyalarına çeviren web uygulaması.

**Her şey tarayıcıda çalışır.** PDF dosyası hiçbir sunucuya yüklenmez.

## Nasıl çalışır?

Uygulama her kitabı **iki kez tarar ve üç kaynakla doğrular**:

1. **1. tarama: Türkçe OCR.** Her sayfa (dijital PDF'ler dahil) Tesseract'ın Türkçe modeliyle 300 dpi'da okunur.
2. **PDF'in kendi metniyle karşılaştırma.** OCR sonucu, PDF'teki metinle kelime kelime hizalanır. İkisi aynıysa kelime kesinleşir. Biri bozuksa (ör. `GO▯UNMEYEN`, `SE l\IZ`, `8itap`, `ý þ ð`) diğeri seçilir.
3. **Türkçe sözlük kontrolü.** Yaklaşık 630 bin kelime biçimlik bir sıklık sözlüğü ve kitabın kendi kelimeleri kullanılır. Tipik OCR karışıklıkları düzeltilir: `rn`/`m`, `g`/`ğ`, `s`/`ş`, `1`/`l`, `8`/`k`… Örnekler: `olaganüstü` → `olağanüstü`, `Jirnmie` → `Jimmie`, `çalışrnadan` → `çalışmadan`. Sözlükte olan gerçek kelimelere ve konuşma diline gereksiz yere dokunulmaz.
4. **2. tarama.** Hâlâ şüpheli kelime içeren satırlar daha yüksek çözünürlükte (≈500 dpi) tek tek yeniden okunur.
5. **Sayfa düzeni.** Üst bilgiler ve sayfa numaraları silinir. Satır sonu tireleri (gizli/yumuşak tireler dahil) birleştirilir, kaybolmuş tireler sözlükle bulunur (`basa` + `mağında` → `basamağında`). Girintili alıntı blokları tek paragraf olur. Bölüm başlıkları ve dipnotlar bulunur.
6. **Kontrol ekranı.** Emin olunamayan birkaç kelime sarı ile gösterilir. Metin, bölüm adları düzeltilebilir.
7. **EPUB 3.** Kapaklı, içindekiler listeli, tıklanabilir dipnotlu ve dili `tr` olarak işaretli bir dosya oluşturulur.

"Hızlı" seçeneği tek tarama yapar. Dijital PDF'lerin metni temizse OCR'ı atlar.

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
