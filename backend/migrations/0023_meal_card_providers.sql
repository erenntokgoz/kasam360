-- Yemek kartı markaları: işletmenin hangi markaları kabul ettiği.
-- Satır yoksa marka açık sayılır; kapatmak açık bir kayıttır.
CREATE TABLE IF NOT EXISTS meal_card_providers (
    tenant_id TEXT NOT NULL,
    code TEXT NOT NULL
        CHECK (code IN ('MULTINET', 'PLUXEE', 'EDENRED', 'SETCARD', 'METROPOL', 'OTHER')),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    PRIMARY KEY (tenant_id, code)
);
