# KASAM360

Restoran/Kafe/Bar için Local-First POS + ERP.


## Mimari

- **desktop/** — React + Vite + TypeScript (UI)
- **backend/** — Tauri + Rust + SQLite (çekirdek)
- **mobile/** — boş (gelecek)
- **packages/contracts/** — Rust → TS tip üretimi (ts-rs)

## Hızlı Başlangıç

```bash
# Backend
cd backend
cargo check
cargo test

# Desktop
cd desktop
npm install
npx tsc --noEmit
npx vitest run
```

## Kurallar

Tüm geliştirme kuralları `AGENTS.md`'de belirtilmiştir. Okumadan önce mutlaka
okuyun: para INTEGER kuruş, kimlik Argon2id, FIFO gerçek parti/lot, audit
SHA-256 zinciri, prefixed ULID, multi-tenant zorunlu.

## Belgelediğimiz Şeyler

- `AGENTS.md` — proje anayasası (en üst otorite)
- `CONTRIBUTING.md` — katkı rehberi
- `CHANGELOG.md` — değişiklik daily
- `backend/README.md` — backend detayı
- `desktop/README.md` — desktop detayı

## Lisans

MIT — bakın `LICENSE`.