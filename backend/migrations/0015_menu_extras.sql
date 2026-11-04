-- Ürün kendi istasyonunu taşıyabilir, web menüsüne açılabilir ve elle dizilebilir.
ALTER TABLE products ADD COLUMN station TEXT;
ALTER TABLE products ADD COLUMN on_web INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
-- Alt kategori tek seviyedir.
ALTER TABLE categories ADD COLUMN parent_id TEXT;
