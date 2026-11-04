-- Hakediş dönemi kişiye aittir; tutar bu döneme göre okunur. Var olan kurallar aylıktı.
ALTER TABLE payroll_rules ADD COLUMN pay_period TEXT NOT NULL DEFAULT 'MONTHLY';
