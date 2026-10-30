# Yerel Ağ Eşitlemesi

Durum: Cari işlemler için aktarım uygulandı; gerçek cihaz testi yapılmadı, üretime hazır değildir.

## Hedef

İnternet kesildiğinde aynı WLAN/LAN üzerindeki cihazlar sipariş, ödeme, stok ve cari işlemlerini sürdürebilir. Bir cihaz kapandığında onaylanmış işlemler kaybolmaz. Tek cihazlı işletme çalışabilir. Ağdan tümüyle kopmuş cihaz yeni işlem açmaz.

## Mevcut durum

- Tek cihazlı kurulum eşleştirme gerektirmez; cari işlemler yine de işlem günlüğünden geçer.
- Eşitlenen işlemler: cari kart, borç açma ve banka/kart ödemesi. Küme üyeliği de aynı günlükten geçer.
- Kod `backend/src/services/lan_sync` altındadır: işlem günlüğü (`op_log`), otorite ve çoğunluk (`engine`), şifreli kanal (`secure_channel`), eşleştirme (`pairing`), TCP çalışma döngüsü (`runtime`, `transport`).
- Sipariş, ödeme, kasa, vardiya, gün sonu, personel bordrosu ve stok henüz günlüğe taşınmadı. Bu yüzden iki veya daha fazla cihaz eşleştirildiğinde bu yazmalar `SYNC_UNSUPPORTED` ile durur; nakit cari hareketi ve tedarikçi belgesi de vardiya ve stok eşitlenene kadar kapalıdır.
- `outbox` harici sistem teslimatı içindir; cihazlar arası eşitlemede kullanılmaz.

## Güvenlik ve süreklilik kuralı

Bir cihazın bozulması ile cihazlar arasındaki ağın bölünmesi diğer cihaz açısından her zaman ayırt edilemez. Bu nedenle yalnız iki aktif cihazdan biri aniden görünmez olduğunda kalan cihazın tek başına **hem** kesintisiz finansal yazma yapması **hem** çift işlem ihtimalini sıfıra indirmesi garanti edilemez. Ürün bunu gizlemez:

- Tek cihazlı kurulumda yerel SQLite kalıcı yazımı işlem için yeterlidir. Otomatik yedekleme ayrıca izlenir.
- Çok cihazlı kurulumda kritik yazma için tek bir güncel işlem otoritesi ve kalıcı çoğunluk onayı gerekir. Ağ bölünmesinde çoğunluğu kaybeden taraf yeni finansal işlem açamaz; mevcut ekranı ve kayıtlarını korur.
- Üç veya daha fazla aktif cihazda tek cihaz kaybı çoğunluğu bozmaz. İki cihazlı kurulumda ani cihaz/ağ kaybı finansal yazmayı durdurabilir; cihazın planlı olarak pasife alınması kalan cihazı güvenle tek cihaz moduna geçirir.
- “İşlem tamamlandı” cevabı yalnızca kalıcı kayıt ve gereken onaylar alındıktan sonra verilir. Zaman aşımında kullanıcı işlem kimliğiyle sonucu sorgular; körlemesine ikinci kez ödeme göndermez.

## İşlem sözleşmesi

1. Her cihaz kalıcı, ön ekli benzersiz kimlik taşır. Cihaz anahtarı ve kiracı kapsamı eşleşmeden ağ isteği kabul edilmez.
2. Her değişiklik `operation_id`, `tenant_id`, `device_id`, hedef kayıt ID'si, beklenen sürüm, tür ve kanonik veri taşır. Aynı `operation_id` tekrar geldiğinde aynı sonuç döner.
3. Otorite, aynı adisyon için değişiklikleri tek sıra halinde doğrular. Ödeme yalnızca kalan tutar ve kalem/adet tahsisleriyle uyumluysa kabul edilir.
4. Kabul edilen işlem, ilgili iş kayıtları ve denetim kaydıyla aynı SQLite transaction içinde yazılır. Ağ bildirimi transaction sonrasında yapılır.
5. Diğer cihazlar kabul edilmiş işlemleri sıra numarasıyla alır, kimliğe göre tek kez uygular ve kalıcı son konumunu yazar. Eksik sıra varsa arayı doldurmadan yeni durumu göstermez.
6. Menü, stok ve cari hareketleri aynı doğrulanmış işlem akışına alınır. Fiyat ve reçete sürümü sipariş kaleminde korunur; sonradan yapılan değişiklik geçmiş satışı değiştirmez.
7. Cihaz pasiften aktife alınırken tüm eksik kayıtlar ve denetim zinciri doğrulanır; tamamlanmadan yeni işlem açılamaz.

## Kullanıcı arayüzü

- Durum çubuğu: `Hazır`, `Eşitleniyor`, `Bağlantı yok`, `İşlem sonucu doğrulanıyor`, `Müdahale gerekli`.
- Her başarısız işlemde işlem kimliği ve güvenli tekrar/sonuç sorgulama seçeneği görünür.
- Gün sonu; açık adisyon, eksik sıra, bekleyen ödeme, eşitlenmemiş hareket ve kasa farkı kalmadığında tamamlanır.
- Cihazlar ekranı; aktif/pasif durumunu, son görülme zamanını ve son eşitlenen işlemi gösterir.

## Uygulama dilimleri

1. İki ayrı SQLite dosyası ve iki süreçle çalışan test düzeneği kur; aynı kimliğin tekrar uygulanmadığını ve hata anında sonuç sorgulanabildiğini kanıtla.
2. Kalıcı cihaz kimliği, eşleştirme ve kimliği doğrulanmış yerel ağ bağlantısını kur.
3. Tek otorite, sürüm kontrolü ve kalıcı çoğunluk onayını ekle; iki/üç cihaz arızası testlerini yaz.
4. Sipariş ve ödeme işlemlerini taşı; aynı masa ve aynı adette eşzamanlı tahsilatı sınayarak çift yazmayı engelle.
5. Menü, stok, cari, personel ve denetim işlemlerini aynı sözleşmeye geçir.
6. Yeniden katılım, aktif/pasif geçişi, yedekten geri dönüş ve gün sonu kapısını gerçek cihazlarda doğrula.

Her dilim kendi testleri ve çalışan uygulama davranışıyla tamamlanır. Bütün finansal yazmalar bu sözleşmeye taşınmadan çok cihazlı kullanım üretime açılmaz.
