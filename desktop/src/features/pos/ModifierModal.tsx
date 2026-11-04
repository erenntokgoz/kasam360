import React, { useEffect, useState } from 'react';
import type { Product, OrderItemModifier } from '../../types/pos';
import { formatMoney } from '../../lib/formatMoney';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';

export interface ModifierModalProps {
  isOpen: boolean;
  product: Product | null;
  onClose: () => void;
  onConfirm: (data: {
    selectedModifiers: OrderItemModifier[];
    cookingDegree?: string;
    notes?: string;
  }) => void;
}

export const ModifierModal: React.FC<ModifierModalProps> = ({
  isOpen,
  product,
  onClose,
  onConfirm,
}) => {
  // Pişirme derecesi seçilmeden gelir: hazır seçili değer her ürüne istenmemiş not yazıyordu.
  const [cookingDegree, setCookingDegree] = useState('');
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [selectedMods, setSelectedMods] = useState<OrderItemModifier[]>([]);

  // Modal açık kalır, ürün değişir: önceki ürünün seçimi yeni ürüne taşınmasın.
  const productId = product?.id;
  useEffect(() => {
    setSelectedMods([]);
    setSelectedNotes([]);
    setCookingDegree('');
  }, [productId]);

  if (!product) return null;

  const selectedIn = (groupId: string) => {
    const options = product.modifierGroups?.find((g) => g.id === groupId)?.options ?? [];
    return selectedMods.filter((m) => options.some((o) => o.id === m.optionId)).length;
  };
  const missingRequired = product.modifierGroups?.some((g) => selectedIn(g.id) < g.minSelections) ?? false;

  const quickNotes = ['Soğansız', 'Acısız', 'Sos Ayrı', 'Az Tuzlu', 'Paket'];

  const toggleNote = (note: string) => {
    setSelectedNotes((prev) =>
      prev.includes(note) ? prev.filter((n) => n !== note) : [...prev, note]
    );
  };

  const toggleModifier = (groupId: string, maxSelections: number, mod: OrderItemModifier) => {
    setSelectedMods((prev) => {
      const exists = prev.some((m) => m.optionId === mod.optionId);
      if (exists) {
        return prev.filter((m) => m.optionId !== mod.optionId);
      }
      if (maxSelections === 1) {
        // Tekli seçim: bu gruptaki diğer opsiyonu kaldırıp bunu koy
        const groupOptionIds = product.modifierGroups
          ?.find((g) => g.id === groupId)
          ?.options.map((o) => o.id) || [];
        const cleaned = prev.filter((m) => !groupOptionIds.includes(m.optionId));
        return [...cleaned, mod];
      }
      return selectedIn(groupId) >= maxSelections ? prev : [...prev, mod];
    });
  };

  const handleConfirm = () => {
    onConfirm({
      selectedModifiers: selectedMods,
      cookingDegree: product.station === 'MUTFAK' && cookingDegree ? cookingDegree : undefined,
      notes: selectedNotes.length > 0 ? selectedNotes.join(', ') : undefined,
    });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={product.name}
      maxWidth="md"
    >
      <div className="space-y-4">
        {/* Pişirme Derecesi (Yalnızca Mutfak / Izgara ürünlerinde) */}
        {product.station === 'MUTFAK' ? (
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[var(--text-secondary)]">
              Pişirme Derecesi
            </label>
            <div className="grid grid-cols-3 gap-2">
              {['Az Pişmiş', 'Orta Pişmiş', 'İyi Pişmiş'].map((deg) => (
                <Button
                  key={deg}
                  type="button"
                  variant={cookingDegree === deg ? 'selected' : 'secondary'}
                  size="sm"
                  onClick={() => setCookingDegree(cookingDegree === deg ? '' : deg)}
                  className="min-h-12 text-sm font-semibold"
                >
                  {deg}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Opsiyonel / Zorunlu Modifiyer Grupları */}
        {product.modifierGroups && product.modifierGroups.length > 0 ? (
          <div className="space-y-3 pt-1 border-t border-[var(--border)]">
            {product.modifierGroups.map((group) => (
              <div key={group.id} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">
                    {group.name}
                  </label>
                  <span className="text-xs text-[var(--text-muted)]">
                    {group.maxSelections === 1 ? 'Tek Seçim' : `Maksimum ${group.maxSelections}`}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {group.options.map((opt) => {
                    const isSelected = selectedMods.some((m) => m.optionId === opt.id);
                    return (
                      <Button
                        key={opt.id}
                        type="button"
                        variant={isSelected ? 'selected' : 'secondary'}
                        size="sm"
                        onClick={() =>
                          toggleModifier(group.id, group.maxSelections, {
                            optionId: opt.id,
                            name: opt.name,
                            priceDeltaCents: opt.priceDeltaCents,
                          })
                        }
                        className="min-h-12 justify-between text-sm font-semibold !px-2.5"
                      >
                        <span className="truncate">{opt.name}</span>
                        {opt.priceDeltaCents > 0 ? (
                          <span className="tabular-nums font-bold text-[var(--text-secondary)] shrink-0 ml-1">
                            +{formatMoney(opt.priceDeltaCents)}
                          </span>
                        ) : null}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Mutfak Notları */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-[var(--text-secondary)]">
            Hızlı İstasyon Notu
          </label>
          <div className="flex flex-wrap gap-1.5">
            {quickNotes.map((note) => {
              const active = selectedNotes.includes(note);
              return (
                <Button
                  key={note}
                  type="button"
                  variant={active ? 'selected' : 'secondary'}
                  size="sm"
                  onClick={() => toggleNote(note)}
                  className="!min-h-12 !px-3 text-sm"
                >
                  {note}
                </Button>
              );
            })}
          </div>
        </div>

        <Button
          type="button"
          variant="success"
          size="lg"
          className="w-full mt-2"
          onClick={handleConfirm}
          disabled={missingRequired}
        >
          Sepete Ekle
        </Button>
      </div>
    </Modal>
  );
};
