# Sunucu kurulum adımları

Komutlar Tabby'de root olarak, sırayla çalıştırılır. Eski uygulama (3000) ve Mailu (8080/8443, 465/587) bu adımlarda durdurulmaz ve değiştirilmez.

## 1. Ön kontrol

Eski servislerin çalıştığını gör.
```bash
docker ps
```

Boş RAM'i kontrol et (yaklaşık 2,5 GB boş olmalı).
```bash
free -h
```

Yeni portların boş olduğunu doğrula.
```bash
ss -ltnp | grep -E ':(3100|4100|3610)\b' || echo "portlar bos"
```

## 2. Dosyaları alma

Kurulum dizinini aç.
```bash
mkdir -p /opt/kasam360-next/deploy && cd /opt/kasam360-next/deploy
```

Depo public olduğu için dosyalar doğrudan indirilir.
```bash
curl -fsSL https://raw.githubusercontent.com/erenntokgoz/kasam360/develop/deploy/compose.yaml -o compose.yaml
curl -fsSL https://raw.githubusercontent.com/erenntokgoz/kasam360/develop/deploy/.env.example -o .env.example
```

## 3. GHCR girişi

Paketler private olabilir (Labs reposu private olduğundan labs360 paketi de öyle). GitHub'da `read:packages` yetkili bir token üret; bu token kasam360-api, kasam360-web ve labs360 paketlerinin üçünü de kapsar; token'ı sohbete yazma, komut sorunca terminale yapıştır.
```bash
read -rs -p "GHCR token: " GHCR_TOKEN; echo
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u erenntokgoz --password-stdin
unset GHCR_TOKEN
```

## 4. .env oluşturma

Örnek dosyayı kopyala ve izinleri kısıtla.
```bash
cp .env.example .env && chmod 600 .env
```

Sırları üretip ekrana yazdırmadan ilgili satırlara yaz.
```bash
for k in AUTH_SECRET LABS_CUSTOMER_SECRET LABS_SECRET_KEY LABS_SUPPORT_TOKEN LABS_CATALOG_TOKEN; do
  sed -i "s|^${k}=.*|${k}=$(openssl rand -hex 32)|" .env
done
```

Kalan değerleri (SITE_URL, ALLOWED_ORIGINS, LABS_APP_ORIGIN, Labs yönetici e-postası ve parolası) nano ile doldur.

Compose içinde Labs, API'ye Docker iç ağından `http://api:4000` ile bağlanır; bu yüzden `LABS_INTERNAL_HTTP_HOSTS: api` tanımlıdır ve yalnız noktasız tek etiketli ad için düz HTTP kabul edilir.
```bash
nano .env
```

## 5. Çekme ve başlatma

Görüntüleri indir.
```bash
docker compose -p kasam360next pull
```

Servisleri başlat.
```bash
docker compose -p kasam360next up -d
```

Not: Sunucuda geçici olarak oluşturulmuş bir `compose.override.yaml` varsa, bir sonraki compose güncellemesinden sonra silinebilir (`API_ORIGIN` artık `compose.yaml` içinde).

## 6. Duman testi

API sağlık ucu `{"ok":true}` dönmeli.
```bash
curl -fsS http://127.0.0.1:4100/health
```

Web ve Labs yanıt vermeli.
```bash
curl -fsSI http://127.0.0.1:3100/ | head -1
curl -fsSI http://127.0.0.1:3610/giris | head -1
```

Bellek kullanımını gör.
```bash
docker stats --no-stream
```

## 7. Mailu noreply hesabı

Mailu yönetim arayüzünde `noreply@kasam360.com.tr` kullanıcısını oluştur ve parolayı not et; parolayı sonra Labs panelindeki E-posta sayfasına gireceksin.

## 8. Geri alma

Yalnız yeni yığını durdurup kaldırır; volume'lar (veri) silinmez, eski uygulama ve Mailu etkilenmez.
```bash
cd /opt/kasam360-next/deploy && docker compose -p kasam360next down
```

## 9. Alan adı ve TLS

Nginx site dosyalarını GitHub'dan `sites-available` altına al; mevcut `kasam360` ve `mailu.conf` dosyalarına dokunulmaz.
```bash
curl -fsSL https://raw.githubusercontent.com/erenntokgoz/kasam360/develop/deploy/nginx/kasam360next.conf -o /etc/nginx/sites-available/kasam360next.conf
```

Labs site dosyasını aynı dizine al.
```bash
curl -fsSL https://raw.githubusercontent.com/erenntokgoz/kasam360/develop/deploy/nginx/labs360.conf -o /etc/nginx/sites-available/labs360.conf
```

Yeni dosyaları `sites-enabled` altına sembolik bağla.
```bash
ln -s /etc/nginx/sites-available/kasam360next.conf /etc/nginx/sites-enabled/kasam360next.conf && ln -s /etc/nginx/sites-available/labs360.conf /etc/nginx/sites-enabled/labs360.conf
```

Yapılandırmayı doğrula ve Nginx'i yeniden yükle; restart kullanılmaz, eski bağlantılar kesilmez.
```bash
nginx -t && systemctl reload nginx
```

Certbot kurulu mu kontrol et; yoksa kur.
```bash
which certbot || apt install -y certbot python3-certbot-nginx
```

Ana alan adları ve alt alanlar için sertifika al ve 443 bloklarını ekletirken HTTP'den HTTPS'e yönlendirmeyi seç.
```bash
certbot --nginx -d kasam360.com.tr -d www.kasam360.com.tr -d menu.kasam360.com.tr -d api.kasam360.com.tr
```

Labs alan adı için ayrı sertifika al.
```bash
certbot --nginx -d 360labs.com.tr
```

Ana sitenin HTTPS üzerinden yanıt verdiğini doğrula.
```bash
curl -I https://kasam360.com.tr
```

API sağlık ucunun HTTPS üzerinden yanıt verdiğini doğrula.
```bash
curl -fsS https://api.kasam360.com.tr/health
```

Labs'ın HTTPS üzerinden yanıt verdiğini doğrula.
```bash
curl -I https://360labs.com.tr
```

Ortam değişkenlerini kamu alan adlarına göre güncelle.
```bash
cd /opt/kasam360-next/deploy && sed -i -e 's|^SITE_URL=.*|SITE_URL=https://kasam360.com.tr|' -e 's|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://kasam360.com.tr,https://www.kasam360.com.tr,https://menu.kasam360.com.tr|' .env
```

Yeni ortam değerleriyle yığını başlat.
```bash
docker compose -p kasam360next up -d
```

Labs'a ilk yönetici girişini yaptıktan sonra bootstrap bilgilerini .env'den boşalt.
```bash
sed -i -e 's|^LABS_ADMIN_BOOTSTRAP_EMAIL=.*|LABS_ADMIN_BOOTSTRAP_EMAIL=|' -e 's|^LABS_ADMIN_BOOTSTRAP_PASSWORD=.*|LABS_ADMIN_BOOTSTRAP_PASSWORD=|' .env
```

Boşaltılan değerleri Labs servisine yeniden okutmak için yalnız labs servisini yeniden oluştur.
```bash
cd /opt/kasam360-next/deploy && docker compose -p kasam360next up -d labs
```

Geri almak için yalnız yeni site bağlantılarını kaldır ve Nginx'i yeniden yükle; eski uygulama ve Mailu etkilenmez.
```bash
rm /etc/nginx/sites-enabled/kasam360next.conf /etc/nginx/sites-enabled/labs360.conf && nginx -t && systemctl reload nginx
```
