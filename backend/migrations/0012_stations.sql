-- İstasyon yazıcıya ve görevlilere bağlanır.
ALTER TABLE stations ADD COLUMN printer_name TEXT;
ALTER TABLE stations ADD COLUMN user_ids TEXT NOT NULL DEFAULT '';
