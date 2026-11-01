// Menü Ürün Detay Paneli - Modifiye ve Opsiyonlar Alt Sekmesi
// Ürünün seçenek grupları, seçenek ekleme/silme ve fiyat farkları.

import React, { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import type { ModifierGroupDto } from '../../types/menu360';
import { formatMoney } from '../../lib/formatMoney';
import { parseMoneyToCents } from '../../stores/menu360Store';

interface Menu360DetailModifiyeProps {
  modifierGroups: ModifierGroupDto[];
  assignedGroupIds: string[];
  loading: boolean;
  onToggleGroup: (groupId: string, checked: boolean) => void;
  onOpenModifierModal?: () => void;
  deleteModifierGroup: (groupId: string) => Promise<boolean>;
  addModifierOption: (
    groupId: string,
    name: string,
    priceDeltaCents: number
  ) => Promise<boolean>;
}

export const Menu360DetailModifiye: React.FC<Menu360DetailModifiyeProps> = ({
  modifierGroups,
  assignedGroupIds,
  loading,
  onToggleGroup,
  onOpenModifierModal,
  deleteModifierGroup,
  addModifierOption,
}) => {
  const [addingOptionGroupId, setAddingOptionGroupId] = useState<string | null>(null);
  const [optName, setOptName] = useState('');
  const [optDeltaInput, setOptDeltaInput] = useState('');

  const handleAddOptionSubmit = async (groupId: string) => {
    if (!optName.trim()) return;
    let deltaCents = 0;
    if (optDeltaInput.trim()) {
      try {
        deltaCents = parseMoneyToCents(optDeltaInput);
      } catch {
        return;
      }
    }
    const ok = await addModifierOption(groupId, optName.trim(), deltaCents);
    if (ok) {
      setOptName('');
      setOptDeltaInput('');
      setAddingOptionGroupId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-[var(--text-secondary)]">Bu Ürünün Seçenek Grupları</span>
        {onOpenModifierModal && (
          <button
            type="button"
            onClick={onOpenModifierModal}
            className="text-xs font-bold text-[var(--accent-blue)] hover:underline cursor-pointer"
          >
            + Grup Ekle
          </button>
        )}
      </div>
      <p className="text-xs text-[var(--text-muted)]">POS'ta gösterilecek grupları seçin; seçim hemen kaydedilir.</p>

      {modifierGroups.length === 0 ? (
        <div className="p-4 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-center text-xs text-[var(--text-muted)]">
          Tanımlı modifiye grubu bulunmuyor.
        </div>
      ) : (
        modifierGroups.map((grp) => (
          <div
            key={grp.id}
            className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] space-y-2"
          >
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={assignedGroupIds.includes(grp.id)}
                  disabled={loading}
                  onChange={(event) => onToggleGroup(grp.id, event.target.checked)}
                  aria-label={`${grp.name} grubunu ürüne bağla`}
                />
                <span>
                <span className="text-xs font-bold text-[var(--text-primary)] block">
                  {grp.name}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {grp.isRequired ? 'Zorunlu' : 'İsteğe Bağlı'} (Max: {grp.maxSelections ?? 'Sınırsız'})
                </span>
                </span>
              </label>
              <button
                type="button"
                onClick={() => deleteModifierGroup(grp.id)}
                className="w-12 h-12 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-red)] cursor-pointer"
                title="Grubu tüm menüden sil"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-1">
              {grp.options.map((opt) => (
                <div
                  key={opt.id}
                  className="flex items-center justify-between text-xs py-1 px-2 rounded paper border border-[var(--border)] text-[var(--text-secondary)]"
                >
                  <span>{opt.name}</span>
                  <span className="font-mono tabular-nums text-[var(--text-primary)]">
                    +{formatMoney(opt.priceCents ?? opt.priceDeltaCents ?? 0)}
                  </span>
                </div>
              ))}
            </div>

            {/* Seçenek Ekle Alanı */}
            {addingOptionGroupId === grp.id ? (
              <div className="pt-2 border-t border-[var(--border)] space-y-2">
                <input
                  type="text"
                  value={optName}
                  onChange={(e) => setOptName(e.target.value)}
                  placeholder="Seçenek adı (örn: Ekstra Sos)"
                  className="w-full paper border border-[var(--border)] rounded min-h-12 px-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
                  autoFocus
                />
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={optDeltaInput}
                    onChange={(e) => setOptDeltaInput(e.target.value)}
                    placeholder="Fiyat farkı (TL)"
                    className="flex-1 paper border border-[var(--border)] rounded min-h-12 px-2.5 text-xs tabular-nums text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddOptionSubmit(grp.id)}
                    className="min-h-12 px-3 rounded bg-[var(--accent-blue)] text-white text-xs font-bold cursor-pointer"
                  >
                    Ekle
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingOptionGroupId(null)}
                    className="min-h-12 px-3 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    İptal
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAddingOptionGroupId(grp.id);
                  setOptName('');
                  setOptDeltaInput('');
                }}
                className="min-h-12 text-xs font-semibold text-[var(--accent-blue)] hover:underline flex items-center gap-1 cursor-pointer pt-1"
              >
                <Plus className="w-3 h-3" />
                <span>Seçenek Ekle</span>
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
};
