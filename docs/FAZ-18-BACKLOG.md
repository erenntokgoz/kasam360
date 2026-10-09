# Faz 18 — Backlog (G7 · Item 27)

Son guncelleme: 2026-10-09

## 1. Theoretical vs Actual COGS
- Reçete tabanli teorik maliyet x gerçek satilan adet
- Fark raporu (reçete cost - FIFO cost)
- Feature flag: feat_theoretical_cogs

## 2. Multi-branch isolation
- Her subenin kendi ledger'i, kasasi, vardiya kapanisi
- Cross-branch transfer (stok, para)
- Feature flag: feat_multi_branch

## 3. Dynamic KDS routing
- Tarifeye göre istasyon rotalamasi (pisirme -> servis)
- Acil siparis oncelik sirasi
- Feature flag: feat_kds_routing

## 4. Menu engineering matrix
- ABC analizi (satis x kar)
- Fiyat esneklik modeli
- Feature flag: feat_menu_engineering

## 5. Hardware abstraction layer
- Thermal printer, barkod okuyucu, para kutusu, ekran
- Donanim bagimsizligi (USB/serial/Bluetooth)
- Feature flag: feat_hardware_hal

## 6. Caller ID, Delivery, WhatsApp bot
- Telefon entegrasyonu (gelen arama -> masa)
- Kurye takibi
- WhatsApp siparis botu
- Feature flag: feat_caller_id, feat_delivery

## 7. Sadakat/hediye karti
- Puan sistemi
- Hediye karti basimi
- Feature flag: feat_loyalty

## 8. e-Arşiv gerçek entegratör
- GİB e-Arşiv API entegrasyonu
- e-Fatura, e-Arşiv senkronizasyonu
- Feature flag: feat_earchive

## 9. ÖKC/fiscal gerçek protokol
- ÖKC terminal protokolü (real hardware)
- Fiscal raporlama
- Feature flag: feat_okc_fiscal
