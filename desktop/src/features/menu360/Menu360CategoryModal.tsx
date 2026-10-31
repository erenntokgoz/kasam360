// Menü Yeni Kategori Ekleme Modalı
// Açık ve koyu tema tam uyumlu, CSS tema değişkenleriyle desteklenir.

import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useMenu360Store } from '../../stores/menu360Store';

interface Menu360CategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Menu360CategoryModal: React.FC<Menu360CategoryModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { createCategory, busy } = useMenu360Store();
  const [name, setName] = useState('');
  const [station, setStation] = useState('BAR');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Kategori adı zorunludur.');
      return;
    }

    const success = await createCategory(name.trim(), station);
    if (success) {
      setName('');
      onClose();
    } else {
      setError('Kategori oluşturulamadı.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-96 paper border border-[var(--border)] rounded-xl overflow-hidden select-none shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-panel)]">
          <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">+ Yeni Kategori Ekle</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-2 text-xs rounded-lg bg-[var(--accent-red-soft)] border border-[var(--accent-red-border)] text-[var(--accent-red)]">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase mb-1">
              Kategori Adı
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Örn: Sıcak İçecekler"
              className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase mb-1">
              Varsayılan İstasyon
            </label>
            <div className="grid grid-cols-3 gap-2">
              {['BAR', 'MUTFAK', 'TATLI'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStation(st)}
                  className={`py-2 px-1 text-xs font-bold rounded-md border cursor-pointer text-center transition-colors ${
                    station === st
                      ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border-[var(--accent-blue)] shadow-[inset_0_0_0_1px_var(--accent-blue)]'
                      : 'bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-xs font-bold text-[var(--text-primary)] border border-[var(--border)] cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={busy}
              className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-xs font-bold text-white flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>Oluştur</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
