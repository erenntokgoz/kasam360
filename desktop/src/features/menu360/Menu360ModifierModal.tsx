// Menü Yeni Modifiye Grubu Ekleme Modalı
// Açık ve koyu tema tam uyumlu, CSS tema değişkenleriyle desteklenir.

import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useMenu360Store } from '../../stores/menu360Store';

interface Menu360ModifierModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Menu360ModifierModal: React.FC<Menu360ModifierModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { createModifierGroup, busy } = useMenu360Store();
  const [name, setName] = useState('');
  const [minSel, setMinSel] = useState(0);
  const [maxSel, setMaxSel] = useState(1);
  const [isRequired, setIsRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Grup adı zorunludur.');
      return;
    }

    const success = await createModifierGroup(name.trim(), minSel, maxSel, isRequired);
    if (success) {
      setName('');
      setMinSel(0);
      setMaxSel(1);
      setIsRequired(false);
      onClose();
    } else {
      setError('Modifiye grubu oluşturulamadı.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-96 bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl overflow-hidden select-none shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-panel)]">
          <h3 className="text-sm font-bold text-[var(--text-primary)]">+ Yeni Modifiye Grubu</h3>
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
              Grup Adı
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Örn: Sos Tercihi, Pişme Derecesi"
              className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase mb-1">
                Min Seçim
              </label>
              <input
                type="number"
                min={0}
                value={minSel}
                onChange={(e) => setMinSel(parseInt(e.target.value, 10) || 0)}
                className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase mb-1">
                Max Seçim
              </label>
              <input
                type="number"
                min={1}
                value={maxSel}
                onChange={(e) => setMaxSel(parseInt(e.target.value, 10) || 1)}
                className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
            <span className="text-xs font-semibold text-[var(--text-primary)]">Zorunlu Seçim mi?</span>
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
              className="w-4 h-4 rounded cursor-pointer accent-[var(--brand)]"
            />
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
