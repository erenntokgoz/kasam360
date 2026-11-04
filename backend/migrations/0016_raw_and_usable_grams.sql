-- Hammadde satış kataloğundan ayrılır. Eski kurulumda stoktan açılan fiyatsız ve
-- satışa kapalı kalemler hammadde sayılır: bunlar menüye hiç çıkmamıştı.
ALTER TABLE products ADD COLUMN is_raw INTEGER NOT NULL DEFAULT 0;
UPDATE products SET is_raw = 1
 WHERE price_cents = 0 AND is_active = 0 AND is_86 = 0
   AND id NOT IN (SELECT product_id FROM recipes WHERE tenant_id = products.tenant_id);
-- Adetle alınan üründe partinin bir adedinden çıkan kullanılabilir gram.
ALTER TABLE inventory_batches ADD COLUMN usable_grams_per_unit REAL;
