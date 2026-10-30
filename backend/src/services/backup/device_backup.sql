CREATE TABLE IF NOT EXISTS device_backup (
    slot INTEGER PRIMARY KEY CHECK (slot = 1),
    mirror_dir TEXT,
    last_backup_at TEXT,
    last_error TEXT,
    last_sequence INTEGER,
    last_restored_at TEXT,
    restored_from TEXT,
    restore_audit_pending INTEGER NOT NULL DEFAULT 0
);
