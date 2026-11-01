// Menü Yeni Kategori Ekleme Modalı
// Açık ve koyu tema tam uyumlu, CSS tema değişkenleriyle desteklenir.

import React, { useEffect, useState } from 'react';
import { X, Check } from 'lucide-react';
import { useMenu360Store } from '../../stores/menu360Store';
import type { CategoryDto } from '../../types/menu360';

interface Menu360CategoryModalProps {
  isOpen: boolean;
  /** Verilirse pencere düzenleme açılır. */
  category?: CategoryDto | null;
  onClose: () => void;
}

export const Menu360CategoryModal: React.FC<Menu360CategoryModalProps> = ({
  isOpen,
  category = null,
  onClose,
}) => {
  const { createCategory, updateCategory, busy } = useMenu360Store();
  const [name, setName] = useState('');
  const [station, setStation] = useState('BAR');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(category?.name ?? '');
    setStation(category?.defaultStation ?? 'BAR');
    setError(null);
  }, [isOpen, category]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Kategori adı zorunludur.');
      return;
    }

    const success = category
      ? await updateCategory(category, name.trim(), station)
      : await createCategory(name.trim(), station);
    if (success) {
      setName('');
      onClose();
    } else {
      setError('Kategori kaydedilemedi.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-96 paper border border-[var(--border)] rounded-xl overflow-hidden select-none shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-panel)]">
          <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">{category ? 'Kategoriyi Düzenle' : 'Yeni Kategori'}</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-12 h-12 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
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
            <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-1">
              Kategori Adı
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Örn: Sıcak İçecekler"
              className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md min-h-12 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-1">
              Varsayılan İstasyon
            </label>
            <div className="grid grid-cols-3 gap-2">
              {['BAR', 'MUTFAK', 'TATLI'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStation(st)}
                  className={`min-h-12 px-1 text-sm font-bold rounded-md border cursor-pointer text-center transition-colors ${
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
              className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-sm font-bold text-[var(--text-primary)] border border-[var(--border)] cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={busy}
              className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-sm font-bold text-white flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>Kaydet</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
