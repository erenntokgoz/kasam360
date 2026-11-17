import React, { useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { formatMoney } from '../../lib/formatMoney';
import { centsToText, parseCents } from '../../lib/moneyInput';
import { orderCode, PAYMENT_LABEL, settlementTotals } from '../../lib/packageModel';
import { settleCourier, usePackageStore } from '../../stores/packageStore';
import { useUIStore } from '../../stores/uiStore';
import type { PackageCourier, PackageDelivery } from '../../types/packageService';
import { Button } from '../../ui/Button';
import { InlineAlert } from '../../ui/InlineAlert';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import { NumberInput } from '../../ui/NumberInput';

interface CourierSettleModalProps {
  courier: PackageCourier;
  /** Kuryenin teslim ettiği, parası alınmamış kapıda tahsilatlı siparişler. */
  rows: PackageDelivery[];
  onClose: () => void;
}

const labelClass = 'block text-xs font-semibold mb-1 text-[var(--text-secondary)]';

/**
 * Kurye mutabakatı: beklenen nakit ve kart sipariş satırlarından gelir, kasiyer eline geçen
 * tutarı yazar. Fark varsa açıklama zorunludur; fark kasa kapanışında açık olarak görünür.
 */
export const CourierSettleModal: React.FC<CourierSettleModalProps> = ({ courier, rows, onClose }) => {
  const load = usePackageStore((state) => state.load);
  const loadCouriers = usePackageStore((state) => state.loadCouriers);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rows.map((row) => row.id)));
  const chosen = rows.filter((row) => selected.has(row.id));
  const expected = settlementTotals(chosen);
  const [cash, setCash] = useState<string | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Alan elle değiştirilmediyse beklenen tutarı gösterir; seçim değişince birlikte güncellenir.
  const cashText = cash ?? centsToText(expected.cashCents);
  const cardText = card ?? centsToText(expected.cardCents);
  const receivedCash = parseCents(cashText);
  const receivedCard = parseCents(cardText);
  const valid = chosen.length > 0 && receivedCash !== null && receivedCard !== null;
  const cashDiff = (receivedCash ?? 0) - expected.cashCents;
  const cardDiff = (receivedCard ?? 0) - expected.cardCents;
  const hasDifference = valid && (cashDiff !== 0 || cardDiff !== 0);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setCash(null);
    setCard(null);
  };

  const save = async () => {
    if (receivedCash === null || receivedCard === null) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await settleCourier({
        courierId: courier.userId, deliveryIds: chosen.map((row) => row.id),
        receivedCashCents: receivedCash, receivedCardCents: receivedCard, note,
      });
      useUIStore.getState().showNotice(`${courier.name}: ${result.orderCount} sipariş kasaya işlendi.`);
      await Promise.all([load(), loadCouriers()]);
      onClose();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={() => { if (!isSaving) onClose(); }} title={`${courier.name} mutabakatı`} maxWidth="2xl" cardFlow>
      <div className="space-y-4">
        <ul className="divide-y" aria-label="Teslim edilen siparişler">
          {rows.map((row) => (
            <li key={row.id}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" className="size-5" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                <span className="min-w-0 flex-1 break-words">#{orderCode(row.id)} · {row.customerName} · {PAYMENT_LABEL[row.paymentMethod]}</span>
                <strong className="tabular-nums">{formatMoney(row.totalCents)}</strong>
              </label>
            </li>
          ))}
        </ul>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="settle-cash" className={labelClass}>Teslim alınan nakit (beklenen {formatMoney(expected.cashCents)})</label>
            <NumberInput id="settle-cash" kind="money" value={cashText} onValueChange={setCash} pinpadTitle="Teslim alınan nakit" />
          </div>
          <div>
            <label htmlFor="settle-card" className={labelClass}>Kart slip toplamı (beklenen {formatMoney(expected.cardCents)})</label>
            <NumberInput id="settle-card" kind="money" value={cardText} onValueChange={setCard} pinpadTitle="Kart slip toplamı" />
          </div>
        </div>
        {hasDifference ? (
          <div className="space-y-2">
            <p role="status" className="text-sm font-bold text-[var(--accent-red)]">
              Fark: nakit {formatMoney(cashDiff)}, kart {formatMoney(cardDiff)}
            </p>
            <label htmlFor="settle-note" className={labelClass}>Fark açıklaması</label>
            <Input id="settle-note" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
          </div>
        ) : null}
        {error ? <InlineAlert message={error} onDismiss={() => setError(null)} /> : null}
        <Button variant="primary" size="lg" className="w-full" isLoading={isSaving} disabled={!valid || (hasDifference && !note.trim())} onClick={() => void save()}>
          Parayı teslim al
        </Button>
      </div>
    </Modal>
  );
};
