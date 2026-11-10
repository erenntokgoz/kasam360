# KASAM360 ve 360 Labs ilk staging çalıştırması

Bu runbook, GitHub Actions'ın ürettiği Linux `amd64` image'larını sunucuda yüklemek ve yalnızca loopback'te smoke kontrolü yapmak içindir. Sunucuda image build etmez; Nginx, DNS, 80/443, mevcut 3000 servisi veya Mailu'yu değiştirmez. Otomatik dağıtım tanımlamaz.

## Doğrulanmış Actions çıktıları

| Repo | Başarılı `workflow_dispatch` koşusu | Artifact | Image etiketi |
|---|---|---|---|
| `erenntokgoz/kasam360` | [42495655034](https://github.com/erenntokgoz/kasam360/actions/runs/42495655034), SHA `6522d02e0d5d2483911a629a28bd039a1396944a` | `kasam360-linux-amd64-6522d02e0d5d2483911a629a28bd039a1396944a` | `kasam360-api:6522d02e0d5d2483911a629a28bd039a1396944a`, `kasam360-web:6522d02e0d5d2483911a629a28bd039a1396944a` |
| `erenntokgoz/360labs` (private) | [42495385417](https://github.com/erenntokgoz/360labs/actions/runs/42495385417), SHA `82ff5fa3016206a48239fdcf8d9a0b2f100bb298` | `labs360-linux-amd64-82ff5fa3016206a48239fdcf8d9a0b2f100bb298` | `labs360:82ff5fa3016206a48239fdcf8d9a0b2f100bb298` |

Her artifact'in içeriği `images.tar`, `manifest.txt` ve `SHA256SUMS` dosyalarıdır. `SHA256SUMS`, `images.tar` dosyasının SHA-256 değerini taşır. Artifact'ler GitHub Actions'ta 14 gün saklanır; Labs artifact'i yalnızca private Labs deposundan yetkili hesapla indirilebilir.

## İş istasyonundan indirme ve sunucuya kopyalama

GitHub erişimi olan Windows iş istasyonunda PowerShell açın. `gh auth status` her iki depoya erişimi doğrulamalıdır. Komutlar image'ları build etmez; Actions artifact'lerini açıp `incoming` klasörüne kopyalar:

```powershell
$StagePath = 'C:\Users\Eren Tokgöz\Desktop\Projects\kasam360\work\deploy-artifacts'
New-Item -ItemType Directory -Force -Path "$StagePath\kasam360", "$StagePath\360labs", "$StagePath\deploy" | Out-Null
gh run download 42495655034 -R erenntokgoz/kasam360 -n kasam360-linux-amd64-6522d02e0d5d2483911a629a28bd039a1396944a -D "$StagePath\kasam360"
gh run download 42495385417 -R erenntokgoz/360labs -n labs360-linux-amd64-82ff5fa3016206a48239fdcf8d9a0b2f100bb298 -D "$StagePath\360labs"
Copy-Item 'C:\Users\Eren Tokgöz\Desktop\Projects\kasam360\deploy\compose.yaml' "$StagePath\deploy\compose.yaml"
Copy-Item 'C:\Users\Eren Tokgöz\Desktop\Projects\kasam360\deploy\.env.example' "$StagePath\deploy\.env.example"
Copy-Item 'C:\Users\Eren Tokgöz\Desktop\Projects\kasam360\deploy\kasam360-next-up' "$StagePath\deploy\kasam360-next-up"
scp -r "$StagePath\kasam360" "$StagePath\360labs" "$StagePath\deploy" kasamdeploy@109.236.51.239:/opt/kasam360-next/incoming/
```

Bu aktarımın hedefleri `/opt/kasam360-next/incoming/kasam360/{images.tar,manifest.txt,SHA256SUMS}`, `/opt/kasam360-next/incoming/360labs/{images.tar,manifest.txt,SHA256SUMS}` ve `/opt/kasam360-next/incoming/deploy/{compose.yaml,.env.example,kasam360-next-up}` olur. Transfer SSH üzerinden `kasamdeploy` ile yapılır; bu hesaba Docker grubu veya genel root yetkisi verilmez.

## Root terminalinde image yükleme

Yalnızca kullanıcıyla açılmış root terminalinde, mevcut servisleri durdurmadan:

```bash
cd /opt/kasam360-next
(cd incoming/kasam360 && sha256sum -c <(sed 's|artifact/||' SHA256SUMS))
(cd incoming/360labs && sha256sum -c <(sed 's|artifact/||' SHA256SUMS))
docker load -i incoming/kasam360/images.tar
docker load -i incoming/360labs/images.tar
docker image inspect kasam360-api:6522d02e0d5d2483911a629a28bd039a1396944a kasam360-web:6522d02e0d5d2483911a629a28bd039a1396944a labs360:82ff5fa3016206a48239fdcf8d9a0b2f100bb298 --format '{{.Os}}/{{.Architecture}} {{.Config.Labels.org.opencontainers.image.revision}}'
```

Manifest ve checksum geçmeden Compose başlatmayın. `docker load` mevcut image veya container'ları değiştirmez; yalnızca yeni SHA etiketlerini ekler.

## Compose ve loopback sınırları

Compose dosyası [deploy/compose.yaml](../deploy/compose.yaml) sabit `kasam360-next` proje adını kullanır. Varsayılan Compose ağı yalnız bu projenin servislerini birbirine bağlar; web API'ye `api:4000`, API Labs'e `labs:3600` üzerinden ulaşır. Host portları şu şekilde yalnız `127.0.0.1` adresinde yayımlanır:

| Servis | Host bind | Container port | Kalıcı veri |
|---|---|---:|---|
| Web | `127.0.0.1:3100` | 3000 | Yok |
| API | `127.0.0.1:4100` | 4000 | Dış MongoDB staging kümeleri |
| Labs | `127.0.0.1:3610` | 3600 | Compose named volume `kasam360-next_labs-data` → `/data` |

Eski `3000`, Mailu `8080/8443`, Nginx `80/443` portlarına bağlanma yoktur. Nginx upstream, alan adı, TLS ve DNS bu adımda değişmez. Docker'ın loopback port yayımı yalnız host üzerinden erişime izin verir; Compose servisleri arası iletişim host portu değil container portunu kullanır ([Docker Compose networking](https://docs.docker.com/compose/how-tos/networking/), [Docker port publishing](https://docs.docker.com/engine/network/port-publishing)).

## Ortam ve MongoDB önkoşulları

Örnek dosyayı sunucuda `/opt/kasam360-next/deploy/.env.example` konumundan root'a ait, `0600` izinli `/opt/kasam360-next/deploy/.env` dosyasına kopyalayıp `sudoedit` ile doldurun. Gerçek sırları Git'e veya sohbete yazmayın. `deploy/.env` repoda ignore edilir. İlk loopback denemesi için `SITE_URL` ve `ALLOWED_ORIGINS` örneği localhost'tur; gerçek alan adı/TLS açılmadan önce doğrulanmış HTTPS origin ile güncellenmelidir. `LABS_APP_ORIGIN` ilk salt-okuma smoke için loopback HTTPS değeridir; alan adı ve TLS öncesi Labs üzerinden oturum açma/POST kabulü yapılmaz.

API kaynak kodu `tenantMembership.ts`, `desktopTenantDevices.ts`, `lib/mongo.ts` ve `sync/store.ts` içinden Mongo `withTransaction` çağırır. MongoDB transaction'ları standalone sunucuda desteklenmez; her iki URI ayrı ve yalnız staging'e ait replica set veya sharded cluster'a gitmelidir ([MongoDB transaction gereksinimi](https://www.mongodb.com/docs/manual/data-modeling/enforce-consistency/transactions/)). Atlas kullanılıyorsa gerçek müşteri URI'leri bu yapılandırmaya konmaz; iki staging URI'si ayrıca sağlanana kadar API başlatma kapısı kapalı kalır. Örnek veritabanı adları `kasam360_account_staging` ve `kasam360_business_staging` yalnız önerilen isimlerdir.

## Başlatma ve localhost smoke

İki ayrı staging URI'si, `AUTH_SECRET`, geçici `LABS_ADMIN_BOOTSTRAP_EMAIL` / `LABS_ADMIN_BOOTSTRAP_PASSWORD` ve ilk smoke için belirtilen localhost origin'leri girildikten sonra root terminalinde:

```bash
cd /opt/kasam360-next
install -d -o root -g root -m 0750 deploy
install -o root -g root -m 0644 incoming/deploy/compose.yaml deploy/compose.yaml
install -o root -g root -m 0644 incoming/deploy/.env.example deploy/.env.example
if [ ! -e deploy/.env ]; then install -o root -g root -m 0600 deploy/.env.example deploy/.env; fi
sudoedit deploy/.env
docker compose --project-name kasam360-next --file deploy/compose.yaml --env-file deploy/.env config --quiet
docker compose --project-name kasam360-next --file deploy/compose.yaml --env-file deploy/.env up -d
curl --fail --silent --show-error http://127.0.0.1:4100/health
curl --fail --silent --show-error http://127.0.0.1:3100/ >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3100/api/auth/get-session
curl --fail --silent --show-error http://127.0.0.1:3610/giris >/dev/null
docker compose --project-name kasam360-next --file deploy/compose.yaml --env-file deploy/.env ps
```

`config --quiet` sırları terminale dökmeden Compose yapılandırmasını doğrular. Bu smoke yalnız yeni localhost endpoint'lerini kontrol eder. Başarılı yanıtlar alınmadan Nginx/HTTPS/alan adı aşamasına geçmeyin. Daha önce kullanıcı tarafından doğrulanan `ss` çıktısında `3100`, `4100`, `3610` boştu; başlatmadan hemen önce tekrar kontrol edin.
Labs ilk başlangıçta SQLite veritabanında yönetici yoksa geçici bootstrap e-postası ve parolası ister. Yönetici kurulumundan sonra iki `LABS_ADMIN_BOOTSTRAP_*` satırını `.env` dosyasından kaldırıp yalnız Labs servisini yeniden oluşturun; SQLite volume'u korunur. Bu parola ilk admin için en az 12 bayt olmalı ve sır yöneticisinde saklanmalıdır.

İlk root kontrollü smoke tamamlandıktan ve kullanıcı onayladıktan sonra, sınırlı tekrar başlatma yetkisi gerekirse [deploy/kasam360-next-up](../deploy/kasam360-next-up) `/opt/kasam360-next/bin/` altında `root:root`, `0750` ile kurulabilir. Bu wrapper argüman almaz; önce sabit Compose yapılandırmasını sessizce doğrular, sonra yalnız `kasam360next` projesinde GHCR image'larını çekip `up -d --no-build` yapar ve kullanıcı ortam değişkenlerini temizler. `kasamdeploy` Docker grubuna alınmaz. `/etc/sudoers.d` mevcut ve kullanıcı hesabı doğrulanmışsa, tek komut kuralı `kasamdeploy ALL=(root) NOPASSWD: /opt/kasam360-next/bin/kasam360-next-up` olabilir; root terminalinde `visudo` ile kurulup `visudo -c` ile doğrulanmadan etkinleştirilmemelidir.

## Açıkça bekleyen girdiler

- İki bağımsız staging MongoDB URI'si ve bu veritabanları için erişim yetkisi. Gerçek müşteri/veri kümeleri kullanılamaz.
- Üretim HTTPS alan adı (ana DNS `91.151.95.152` olarak kalır), ona ait TLS/Nginx değişikliği ve OAuth callback allowlist'i.
- SMTP, Google OAuth, Labs entegrasyon token'ları ve `LICENSE_SIGNING_KEY`; bu değerler boş kalırsa ilgili akışlar açılmaz/işlevsiz kalır.
- İlk çalıştırma ve erişilebilir Labs login testi için Labs bootstrap admin hesabının güvenli şekilde oluşturulması. Bootstrap sırrı kalıcı Compose env'inde tutulmamalı; oluşturma sonrası ortamdan kaldırılmalı.

Bu maddeler tamamlanmadan gerçek kullanıcı girişi/posta, ödeme, production veri bağlama, Nginx/DNS/TLS veya otomatik deploy yapılmaz.
