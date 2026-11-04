-- 0012'nin ilk hali uygulanmış kurulumlarda sütunlar eksik kaldı.
ALTER TABLE stations ADD COLUMN printer_name TEXT;
ALTER TABLE stations ADD COLUMN user_ids TEXT NOT NULL DEFAULT '';
