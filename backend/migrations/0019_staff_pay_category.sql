-- Personel ücret ödemesi genel giderde kendi kategorisini alır. SQLite CHECK kısıtını
-- değiştiremediği için tablo yeniden kurulur; satırlar olduğu gibi taşınır.
CREATE TABLE general_expenses_staff_pay (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    category TEXT NOT NULL CHECK(category IN ('RENT', 'UTILITIES', 'SUPPLIER', 'STAFF_ADVANCE', 'STAFF_PAY', 'TAX', 'PERSONAL', 'MAINTENANCE', 'OTHER')),
    amount_cents INTEGER NOT NULL,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'VERESIYE')),
    directory_id TEXT,
    shift_id TEXT,
    actor_id TEXT NOT NULL,
    description TEXT,
    expense_date DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    recurring_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (directory_id) REFERENCES directories(id)
);
INSERT INTO general_expenses_staff_pay
    (id, tenant_id, category, amount_cents, payment_method, directory_id, shift_id,
     actor_id, description, expense_date, recurring_id, created_at)
SELECT id, tenant_id, category, amount_cents, payment_method, directory_id, shift_id,
       actor_id, description, expense_date, recurring_id, created_at
  FROM general_expenses;
DROP TABLE general_expenses;
ALTER TABLE general_expenses_staff_pay RENAME TO general_expenses;
CREATE INDEX IF NOT EXISTS idx_general_expenses_tenant_cat ON general_expenses(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_general_expenses_date ON general_expenses(expense_date);
