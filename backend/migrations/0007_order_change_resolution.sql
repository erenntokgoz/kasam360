-- Onaylanan değişiklik talebi, düzeltme yapılana ya da iadesiz kapatılana kadar açık kalır.
ALTER TABLE order_change_requests ADD COLUMN resolved_by TEXT;
ALTER TABLE order_change_requests ADD COLUMN resolved_at TEXT;
