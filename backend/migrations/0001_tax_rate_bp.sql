-- Migration 0001: tax_rate_bp columns (REAL → INTEGER basis points)
-- AGENTS.md §2: Para INTEGER kuruş (*_cents), float YASAK.
-- KDV oranı basis-point (binde) cinsinden: %10 = 1000, %20 = 2000.
-- Formula: (subtotal * bp) / 10_000
--
-- Not: SQLite'da ALTER TABLE ile CHECK constraint eklenemez.
-- CHECK constraint'ler için tablo yeniden creation edilir (bkz. schema.sql).
-- Bu migration sadece kolon ekler; constraint'ler schema.sql'de kurulur.

-- products.tax_rate_bp: REAL → INTEGER basis points
ALTER TABLE products ADD COLUMN tax_rate_bp INTEGER NOT NULL DEFAULT 1000;

-- order_items.tax_rate_bp: kalem seviyesinde KDV oranı
ALTER TABLE order_items ADD COLUMN tax_rate_bp INTEGER NOT NULL DEFAULT 0;