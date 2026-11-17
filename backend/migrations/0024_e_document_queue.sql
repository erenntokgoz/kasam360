-- e-Adisyon ayarları ve kalıcı belge kuyruğu.
-- Belge adisyon başına tek satırdır (ETTN ve adisyon tekil); gönderim sağlayıcıya ETTN ile
-- idempotent yapılır. Tutarlar tamsayı kuruştur.
CREATE TABLE IF NOT EXISTS e_document_settings (
    tenant_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    tax_id TEXT NOT NULL DEFAULT '',
    legal_name TEXT NOT NULL DEFAULT '',
    tax_office TEXT NOT NULL DEFAULT '',
    series_code TEXT NOT NULL DEFAULT 'ADS',
    street TEXT NOT NULL DEFAULT '',
    district TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS e_document_sequences (
    tenant_id TEXT NOT NULL,
    year INTEGER NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0),
    PRIMARY KEY (tenant_id, year)
);
CREATE TABLE IF NOT EXISTS e_document_queue (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    ettn TEXT NOT NULL,
    session_ettn TEXT NOT NULL,
    document_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING', 'SENT', 'FAILED')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error TEXT,
    xml TEXT NOT NULL,
    xml_sha256 TEXT NOT NULL,
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    provider_ref TEXT,
    remote_status TEXT,
    sent_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_e_document_queue_order ON e_document_queue(tenant_id, order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_e_document_queue_ettn ON e_document_queue(tenant_id, ettn);
CREATE UNIQUE INDEX IF NOT EXISTS idx_e_document_queue_number ON e_document_queue(tenant_id, document_number);
CREATE INDEX IF NOT EXISTS idx_e_document_queue_status ON e_document_queue(tenant_id, status, created_at);
