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
