// Menü Yeni Modifiye Grubu Ekleme Modalı
// Açık ve koyu tema tam uyumlu, CSS tema değişkenleriyle desteklenir.

import React, { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { NumberInput } from '../../ui/NumberInput';
import { useMenuStore } from '../../stores/menuStore';
import { Modal } from '../../ui/Modal';

interface MenuModifierModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MenuModifierModal: React.FC<MenuModifierModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { createModifierGroup, busy } = useMenuStore();
  const [name, setName] = useState('');
  const [minSel, setMinSel] = useState(0);
  const [maxSel, setMaxSel] = useState(1);
  const [isRequired, setIsRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const createdId = useRef<string | null>(null);
  const productId = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    createdId.current = null;
    const state = useMenuStore.getState();
    productId.current = state.detailMode === 'new' ? null : state.selectedProductId;
    setName(''); setMinSel(0); setMaxSel(1); setIsRequired(false); setError(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || busy) return;
    if (!name.trim()) {
      setError('Grup adı zorunludur.');
      return;
    }

    // "Zorunlu" en az bir seçim demektir; ikisi çelişirse ürün zorunlu seçimsiz satılıyordu.
    const required = isRequired || minSel > 0;
    const min = required ? Math.max(1, minSel) : 0;
    if (maxSel < min) {
      setError('En fazla seçim, en az seçimden küçük olamaz.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (!createdId.current) {
        const success = await createModifierGroup(name.trim(), min, maxSel, required, (group) => { createdId.current = group.id; });
        if (!success) throw new Error(useMenuStore.getState().error ?? 'Seçenek grubu oluşturulamadı.');
      }
      const id = createdId.current;
      if (!id) throw new Error('Grup kimliği alınamadı.');
      const state = useMenuStore.getState();
      // Bağlama reddedilirse aynı grup ile tekrar denenir; ikinci grup açılmaz.
      if (productId.current) {
        const linked = await state.setProductModifierGroupIds(productId.current, [...new Set([...state.productModifierGroupIds, id])]);
        if (!linked) throw new Error(useMenuStore.getState().error ?? 'Grup oluşturuldu ancak ürüne bağlanamadı. Yeniden deneyin.');
      }
      onClose();
    } catch (caught) {
      setError(String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={() => { if (!saving) onClose(); }} title="Yeni Seçenek Grubu" maxWidth="sm">
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-2 text-xs rounded-lg bg-[var(--accent-red-soft)] border border-[var(--accent-red-border)] text-[var(--accent-red)]">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-1">
              Grup Adı
            </label>
            <input
              disabled={!!createdId.current}
              aria-label="Grup adı"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Örn: Sos Tercihi, Pişme Derecesi"
              className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md min-h-12 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-1">
                Min Seçim
              </label>
              <NumberInput kind="integer"
                disabled={!!createdId.current}
                value={minSel}
                onValueChange={(text) => setMinSel(Number.parseInt(text, 10) || 0)}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-1">
                Max Seçim
              </label>
              <NumberInput kind="integer"
                disabled={!!createdId.current}
                value={maxSel}
                onValueChange={(text) => setMaxSel(Number.parseInt(text, 10) || 0)}
                className="w-full"
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
            <span className="text-xs font-semibold text-[var(--text-primary)]">Zorunlu Seçim mi?</span>
            <input
              type="checkbox"
              disabled={!!createdId.current}
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
              className="w-4 h-4 rounded cursor-pointer accent-[var(--brand)]"
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-sm font-bold text-[var(--text-primary)] border border-[var(--border)] cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={busy || saving}
              className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-sm font-bold text-white flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{createdId.current ? 'Ürüne Bağla' : 'Oluştur'}</span>
            </button>
          </div>
        </form>
    </Modal>
  );
};
