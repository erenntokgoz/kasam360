# KASAM360 Ürün Akışı

## Amaç

Restoranın masaya servis öncelikli günlük işini, internet olmasa da aynı yerel ağdaki cihazlarda kesintisiz yürütmek. Tezgâh satışı aynı ödeme ve stok kurallarını kullanır. Ekranlar yalnızca gerçek işlemleri sunar; yol haritası ve tanıtım sayfaları uygulamada yer almaz.

## Günlük akış

1. İşletme sahibi cihazları, kullanıcıları, menüyü, reçeteleri, hammaddeleri ve tedarikçileri tanımlar.
2. Yönetici vardiyayı açar; cihazlar menü, fiyat, stok ve açık işlemleri eşitler.
3. Garson masayı açar, ürün ve seçenekleri ekler, mutfağa gönderir. Tezgâh satışı masa seçmeden aynı akışı kullanır.
4. Mutfağa gönderilen kalemler reçetelerinden gerçek parti sırasıyla bir kez stok düşer. Hazırlık öncesi iptal stoğu geri bırakır; hazırlık sonrası kayıp gerekçeli fire olur.
5. Mutfak hazırlık durumunu günceller; garson hazır kalemleri görür.
6. Kasiyer adisyonu tam, tutara göre, kaleme göre veya aynı satırın adetlerine göre böler. Nakit, kart ve müşteri carisi birlikte kullanılabilir. Her ödeme yalnızca bir kez işlenir.
7. Bahşişte ödeme yöntemi ve ortak havuz veya personel seçimi belirtilir. Ortak havuz çalışılan süre ve personel kartındaki bahşiş payına göre dağıtılır.
8. Kapanmış adisyonda çalışan değişiklik talep eder; müdür onaylar. Müdürün kendi değişikliği ayrıca onay beklemez. Önceki kayıt korunur ve bütün değişiklikler sahibin kritik işlemler geçmişinde görünür.
9. Gün sonunda açık adisyon, eşitlenmemiş hareket ve açıklanmamış kasa farkı varsa kapanış tamamlanmaz.

## Yönetim ekranları

- **Menü:** Kategori, ürün, seçenek, fiyat listesi, toplu fiyat güncellemesi, satışta/tükendi durumu ve reçete.
- **Stok:** Hammadde, yarı mamul, hazır ürün, mal kabulü, parti ve son kullanma tarihi, gerçek FIFO maliyeti, üretim, sayım, fire ve kritik stok.
- **Cari Hesaplar:** Müşteriler ve tedarikçiler ayrı sekmelerdir. Kişi/kurum kartı, borç/alacak, vade, kısmi/tam ödeme, ekstre ve bağlı belge/adisyon görülür. Arama Türkçe karakter ve harf büyüklüğü farklarını tolere eder; kayıtlar adla değil benzersiz kimlikle bağlanır. Benzer ad yeni kart açılışında gösterilir, otomatik birleştirilmez.
- **Personel:** Rol, PIN, vardiya, bahşiş payı ve hak ediş. Bahşiş payındaki değişiklik geçmiş vardiyayı değiştirmez.
- **Kritik İşlemler:** Kapanmış adisyon değişiklikleri, iptal, iade, finansal düzeltme ve bunları yapan kişi ile gerekçe.

## Tedarik ve cari bağlantısı

Mal kabulü gerçek teslim miktarını stoğa ekler. Tedarikçi belgesi daha sonra gelebilir; bu durumda giriş "Belge bekleniyor" görünür. Belge tutarı kontrol edilip onaylanınca tedarikçi borcu doğar. Farklar sessizce düzeltilmez. Ödemeler ayrı hareketlerle bakiyeyi azaltır.

## Cihaz ve bağlantı davranışı

- İnternet gerekli değildir; aynı WLAN/LAN'daki cihazlar birbirleriyle çalışır. Ana bilgisayarın kapanması kalan cihazları durdurmaz. Tek aktif cihazla satış mümkündür.
- Yerel ağdan tamamen kopmuş cihaz yeni işlem açmaz. Açık ekranı ve kayıtları korur; yeniden bağlanınca eşitlenir.
- Her işlem, ödeme, stok ve cari hareketi benzersiz kimlik ve tekrar uygulamayı engelleyen işlem anahtarı taşır. Finansal çatışmalarda son yazan kazanır kuralı kullanılmaz.
- Cihaz aktif/pasif yapılabilir. Pasiften dönüşte veri karşılaştırması tamamlanmadan satış açılmaz.
- İnternet varken yedekleme yapılır; durumu ve geri yükleme sonucu yönetimde görünür. Tek cihazın fiziksel veri ve yedek kaybı yazılımla telafi edilemez.

## Uygulama sırası

1. Mevcut kod ve veri sözleşmesini çıkar; çalışan işlevleri koru, sahte ve kullanılmayan ekranları ayıkla.
2. Cihaz kaydı, eşitleme, tekrar işleme koruması ve ödeme çakışması kurallarını doğrula.
3. Menü yönetimini gerçek backend komutlarıyla tamamla.
4. Stok ve reçete akışını mal kabulünden satış maliyetine kadar tamamla.
5. Müşteri ve tedarikçi carisini satış ve mal kabulüyle bağla.
6. Personel, bahşiş, yönetici onayı ve kritik işlemleri tamamla.
7. Masa, mutfak, tezgâh, bölünmüş ödeme, iade ve gün sonunu uçtan uca doğrula.
8. Cihaz kaybı, bağlantı kesilmesi, tekrar deneme, yedekleme ve geri yükleme senaryolarını üretim kapısı olarak çalıştır.

## Üretim kapısı

Derleme ve birim testlerine ek olarak gerçek cihazlarda iki terminalin aynı masaya eşzamanlı erişimi, ödeme sırasında cihaz kapanması, internet kesintisi, tek cihazla çalışma, stok/maliyet mutabakatı, cari ekstre ve yedekten geri yükleme doğrulanmadan üretime çıkılmaz.
