# Değişiklik Günlüğü (Changelog)

Bu dosya, KASAM360'nin tüm&oelig;zellik ve düzeltmelerini takip eder.
Format: [Sürüm] - [Tarih] - [Açıklama]. Sürüm numaraları SEMVER'e göre.

## [0.1.0] — 2026-10-09

### G6 — DevOps + Dayanıklılık
- **CI/CD**: `.github/workflows/ci.yml` eklendi. Her PR'da otomatik:
  `cargo check --all-targets`, `cargo test`, `cargo clippy -D warnings`,
  `cargo fmt --check`, `npx tsc --noEmit`, `npx vitest run`.
  Ek taramalar: emoji, gradient, `unwrap()` finansal kapıları.
- **Property-based test (proptest)**: 15+ test eklendi. Kapsam:
  kuruş taşması, split payment bakiye denklemi, ULID format + uniqueness,
  tenant isolation (cross-tenant sorgu hata döner), ID generator uniqueness
  (1000 üretim → hepsi unique).
- **Yedekleme servisi**: `services/backup/backup_service.rs` eklendi.
  Gün sonu `VACUUM INTO`, SHA-256 checksum, zaman damgalı arşiv,
  startup chain verification, backup + restore testi.
- **Auto-updater**: `tauri-plugin-updater` Cargo.toml'a eklendi. Update
  manifest URL config, imzalı paket doğrulama.
- **Repo hijyen**: `LICENSE` (MIT), `README.md` (kök), `rust-toolchain.toml`,
  `CONTRIBUTING.md`, `CHANGELOG.md`.

### G5 — Onay + G6 Geçidi
- Onay akışı tamamlandı, G6'ya geçildi.