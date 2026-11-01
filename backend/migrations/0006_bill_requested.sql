-- Müşterinin hesap istediği an. Adisyona bağlıdır: masa boşalınca kendiliğinden biter.
ALTER TABLE orders ADD COLUMN bill_requested_at TEXT;
