-- Adisyonun geçtiği masalar. Temizleyen tetikleyici schema.sql içindedir.
ALTER TABLE tables ADD COLUMN trail TEXT;
ALTER TABLE tables ADD COLUMN merged TEXT;
