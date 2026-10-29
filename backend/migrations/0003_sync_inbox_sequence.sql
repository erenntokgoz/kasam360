-- Önceki kurulumlarda gelen işlemlere kaynak sıra alanı eklenir.
ALTER TABLE sync_inbox ADD COLUMN source_sequence INTEGER CHECK (source_sequence > 0);
