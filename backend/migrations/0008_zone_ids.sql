-- Masalar bölüm adını, kroki servisi bölüm kimliğini tutuyordu. Kimlik içerikten türetilir:
-- aynı migration'ı çalıştıran cihazlar eşitlemede farklı bölüm üretmez.
INSERT OR IGNORE INTO floor_zones (id, tenant_id, name, sort_order, is_active, created_at, updated_at)
SELECT
    'zone_' || lower(hex(tenant_id || '|' || COALESCE(NULLIF(trim(zone), ''), 'Salon'))),
    tenant_id,
    COALESCE(NULLIF(trim(zone), ''), 'Salon'),
    0,
    1,
    datetime('now'),
    datetime('now')
FROM tables
WHERE substr(id, 1, 12) != 'tbl_counter_'
  AND (zone IS NULL OR zone NOT IN (SELECT id FROM floor_zones))
GROUP BY tenant_id, COALESCE(NULLIF(trim(zone), ''), 'Salon');

UPDATE tables
SET zone = 'zone_' || lower(hex(tenant_id || '|' || COALESCE(NULLIF(trim(zone), ''), 'Salon')))
WHERE substr(id, 1, 12) != 'tbl_counter_'
  AND (zone IS NULL OR zone NOT IN (SELECT id FROM floor_zones));
