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

## 10. Otomatik kurulum

`develop` dalına her push'ta GitHub Actions, imajlar GHCR'ye gidince sunucuya bağlanıp o commit'i kurar. Kurulum betiği önceki etiketleri kaydeder, yeni etiketi çeker, duman testini en çok 90 saniye dener ve başarısız olursa önceki sürüme döner (çıkış kodu 1). Anahtar yalnız bu betiği çalıştırabilir.

Anahtar çiftini kendi bilgisayarında (PowerShell) üret; özel anahtar sunucuya hiç girmez.
```powershell
ssh-keygen -t ed25519 -N '""' -C kasam360-deploy -f "$env:USERPROFILE\.ssh\kasam360_deploy"
```

Açık anahtarı göster ve kopyala (tek satır, `ssh-ed25519 ...` ile başlar).
```powershell
Get-Content "$env:USERPROFILE\.ssh\kasam360_deploy.pub"
```

Sunucuda root olarak betiği kurulum konumuna al; sahibi root, yalnız root yazabilir.
```bash
curl -fsSL https://raw.githubusercontent.com/erenntokgoz/kasam360/develop/deploy/kasam360-next-up -o /usr/local/sbin/kasam360-next-up && chown root:root /usr/local/sbin/kasam360-next-up && chmod 755 /usr/local/sbin/kasam360-next-up
```

`kasamdeploy` yalnız bu betiği parolasız çalıştırabilsin; dosya `visudo -cf` ile doğrulanmadan yerinde bırakılmaz.
```bash
echo 'kasamdeploy ALL=(root) NOPASSWD: /usr/local/sbin/kasam360-next-up *' > /etc/sudoers.d/kasamdeploy.tmp && visudo -cf /etc/sudoers.d/kasamdeploy.tmp && chown root:root /etc/sudoers.d/kasamdeploy.tmp && chmod 440 /etc/sudoers.d/kasamdeploy.tmp && mv /etc/sudoers.d/kasamdeploy.tmp /etc/sudoers.d/kasamdeploy
```

Açık anahtarı kısıtlı satırla ekle. `AÇIK_ANAHTAR` yerine PC'de kopyaladığın satırın tamamını yaz (komut satırının ortasında `ssh-ed25519 ...` olacak).
```bash
install -d -m 700 -o kasamdeploy -g kasamdeploy /home/kasamdeploy/.ssh && echo 'command="sudo /usr/local/sbin/kasam360-next-up $SSH_ORIGINAL_COMMAND",no-port-forwarding,no-agent-forwarding,no-pty,no-X11-forwarding AÇIK_ANAHTAR' >> /home/kasamdeploy/.ssh/authorized_keys && chown kasamdeploy:kasamdeploy /home/kasamdeploy/.ssh/authorized_keys && chmod 600 /home/kasamdeploy/.ssh/authorized_keys
```

Sunucunun ana makine anahtarını al (çıktı `DEPLOY_KNOWN_HOSTS` olacak). `SUNUCU_ADRESI` yerine sunucunun IP'sini ya da alan adını yaz.
```bash
ssh-keyscan -t ed25519 SUNUCU_ADRESI
```

GitHub'da iki depoya da (`erenntokgoz/kasam360` ve `erenntokgoz/360labs`) Settings, Secrets and variables, Actions, New repository secret yolundan aynı üç gizli değeri gir.

- `DEPLOY_SSH_KEY`: PC'deki `kasam360_deploy` dosyasının (`.pub` olmayan özel anahtar) tüm içeriği, `-----BEGIN` ve `-----END` satırları dahil.
- `DEPLOY_HOST`: sunucunun IP'si ya da alan adı (`kasamdeploy@` öneki olmadan).
- `DEPLOY_KNOWN_HOSTS`: `ssh-keyscan` çıktısındaki `ssh-ed25519` satırı.

Elle deneme: PC'den bir commit'i kurmak için aşağıdaki biçim kullanılır; betik yalnız 40 haneli küçük harfli hex commit kabul eder (Labs için başına `labs:` konur).
```powershell
ssh -i "$env:USERPROFILE\.ssh\kasam360_deploy" kasamdeploy@SUNUCU_ADRESI 0123456789abcdef0123456789abcdef01234567
```

Yayınlanan etiket `.env` dosyasına değil `/opt/kasam360-next/deploy/current-tag` (api ve web) ile `current-labs-tag` (Labs) dosyalarına yazılır; `.env` içindeki `IMAGE_TAG` değerine dokunulmaz. Sunucuda daha önce geçici olarak oluşturulmuş `compose.override.yaml` varsa sil; kurulum artık `compose.yaml` ile çalışır.
```bash
rm -f /opt/kasam360-next/deploy/compose.override.yaml
```

Sürüm kontrolü: API için `curl -fsS http://127.0.0.1:4100/version`, web için `curl -fsS http://127.0.0.1:3100/version.json`, Labs için sunucu içinden `curl -fsS http://127.0.0.1:3610/version` (Nginx üzerinden gelen istekte 404 döner).
