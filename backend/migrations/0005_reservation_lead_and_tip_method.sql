-- Rezervasyonlu masanın kaç dakika önce kapanacağı işletme ayarıdır.
CREATE TABLE IF NOT EXISTS reservation_settings (
    tenant_id TEXT PRIMARY KEY,
    lead_minutes INTEGER NOT NULL DEFAULT 60 CHECK (lead_minutes BETWEEN 30 AND 120 AND lead_minutes % 15 = 0)
);

-- Bahşiş hangi yöntemle alındıysa kaydı onu söyler.
ALTER TABLE tip_pool_entries ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'CASH';
