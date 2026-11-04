import React, { useState } from 'react';
import { Banknote, CreditCard, Utensils, BookOpen } from 'lucide-react';
import type { PaymentMethod } from '../../types/payment';
import type { DirectoryContact } from '../../types/ledger';
import { formatMoney } from '../../lib/formatMoney';
import { errorText } from '../../lib/cariInput';
import type { PaymentPlan } from '../../lib/paymentMath';
import { parseCents } from '../../lib/moneyInput';
import { Button } from '../../ui/Button';

/** Kuruşu giriş alanının ham biçimine çevirir ("300" ya da "300,50"); kayan nokta kullanılmaz. */
const centsToRaw = (cents: number) => {
  const lira = Math.floor(cents / 100);
  const kurus = cents % 100;
  return kurus === 0 ? String(lira) : `${lira},${String(kurus).padStart(2, '0')}`;
};
import { Input } from '../../ui/Input';
import { NumberInput } from '../../ui/NumberInput';
import type { PinpadInfo } from '../../ui/PinpadModal';

const CHANNELS = [
  { id: 'CASH' as const, label: 'Nakit', icon: Banknote },
  { id: 'CARD' as const, label: 'Kart', icon: CreditCard },
  { id: 'MEAL_CARD' as const, label: 'Yemek Kartı', icon: Utensils },
  { id: 'VERESIYE' as const, label: 'Cari', icon: BookOpen },
];

export interface PaymentChannelSectionProps {
  channel: PaymentMethod;
  onSelectChannel: (channel: PaymentMethod) => void;
  plan: PaymentPlan;
  receivedText: string;
  onChangeReceived: (text: string) => void;
  pinpadInfo: PinpadInfo[];
  directories: DirectoryContact[];
  selectedDirectoryId: string;
  onSelectDirectory: (id: string) => void;
  onCreateContact: (name: string, phone: string) => Promise<void>;
}

export const PaymentChannelSection: React.FC<PaymentChannelSectionProps> = ({
  channel,
  onSelectChannel,
  plan,
  receivedText,
  onChangeReceived,
  pinpadInfo,
  directories,
  selectedDirectoryId,
  onSelectDirectory,
  onCreateContact,
}) => {
  const [showQuickAddCari, setShowQuickAddCari] = useState(false);
  const [newCariName, setNewCariName] = useState('');
  const [newCariPhone, setNewCariPhone] = useState('');
  const [cariError, setCariError] = useState<string | null>(null);

  const handleCreateCariSubmit = async () => {
    if (!newCariName) return;
    // Benzer kart reddi burada görünür; form kapanırsa kullanıcı nedenini göremez.
    try {
      await onCreateContact(newCariName, newCariPhone);
      setCariError(null);
      setNewCariName('');
      setNewCariPhone('');
      setShowQuickAddCari(false);
    } catch (error) {
      setCariError(errorText(error));
    }
  };

  // Yazılan tutar yazıldığı anda görünür: para üstü pencere kapanmadan okunur.
  const changeRow = (raw: string): PinpadInfo[] => {
    const received = parseCents(raw);
    if (received === null) return [];
    return received >= plan.dueCents
      ? [{ label: 'Para Üstü', value: formatMoney(received - plan.dueCents) }]
      : [{ label: 'Eksik', value: formatMoney(plan.dueCents - received) }];
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {CHANNELS.map(({ id, label, icon: Icon }) => (
          <Button key={id} type="button" variant={channel === id ? 'selected' : 'secondary'} size="lg" onClick={() => onSelectChannel(id)}>
            <Icon className="w-5 h-5 shrink-0" />
            <span>{label}</span>
          </Button>
        ))}
      </div>

      {channel === 'CASH' ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="payment-received" className="block text-sm font-semibold mb-1.5 text-[var(--text-secondary)]">
              Alınan Nakit (₺)
            </label>
            <NumberInput
              id="payment-received"
              aria-label="Alınan Nakit"
              value={receivedText}
              onValueChange={onChangeReceived}
              placeholder={formatMoney(plan.dueCents).replace(' ₺', '')}
              pinpadTitle="Alınan Nakit"
              pinpadInfo={pinpadInfo}
              pinpadLiveInfo={changeRow}
            />
          </div>
          {/* Banknotlar toplanır: müşteri 200 + 100 verince ikisine de basılır. */}
          <div className="grid grid-cols-3 gap-1.5">
            <Button variant="secondary" className="whitespace-nowrap !px-1" onClick={() => onChangeReceived(centsToRaw(plan.dueCents))}>
              Tam Tutar
            </Button>
            {[20, 50, 100, 200, 500].map((banknote) => (
              <Button
                key={banknote}
                variant="secondary"
                className="tabular-nums whitespace-nowrap !px-1"
                onClick={() => onChangeReceived(centsToRaw((parseCents(receivedText) ?? 0) + banknote * 100))}
              >
                +{banknote.toLocaleString('tr-TR')} ₺
              </Button>
            ))}
          </div>
          {plan.shortCents > 0 ? (
            <div className="rounded-lg bg-[var(--accent-red-soft)] p-3">
              <span className="block text-sm text-[var(--text-secondary)]">Eksik</span>
              <span className="block text-2xl font-extrabold tabular-nums text-[var(--accent-red)]">{formatMoney(plan.shortCents)}</span>
            </div>
          ) : (
            <div className="rounded-lg bg-[var(--accent-emerald-soft)] p-3">
              <span className="block text-sm text-[var(--text-secondary)]">Para Üstü</span>
              <span className="block text-2xl font-extrabold tabular-nums">{formatMoney(plan.changeCents)}</span>
            </div>
          )}
        </div>
      ) : null}

      {channel === 'VERESIYE' ? (
        <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--text-secondary)]">Cari Müşteri</span>
            <button
              type="button"
              onClick={() => setShowQuickAddCari(!showQuickAddCari)}
              className="min-h-12 px-2 text-sm font-semibold text-[var(--text-secondary)] hover:underline cursor-pointer"
            >
              {showQuickAddCari ? 'Listeye Dön' : 'Yeni Cari Ekle'}
            </button>
          </div>

          {showQuickAddCari ? (
            <div className="space-y-3">
              <Input aria-label="Müşteri adı" value={newCariName} onChange={(e) => setNewCariName(e.target.value)} placeholder="Müşteri Adı" />
              <NumberInput aria-label="Telefon" kind="digits" value={newCariPhone} onValueChange={setNewCariPhone} placeholder="Telefon" maxLength={15} />
              {cariError ? <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{cariError}</p> : null}
              <Button variant="primary" onClick={() => void handleCreateCariSubmit()} disabled={!newCariName} className="w-full">
                Kaydet ve Seç
              </Button>
            </div>
          ) : (
            <select
              aria-label="Cari müşteri"
              value={selectedDirectoryId}
              onChange={(e) => onSelectDirectory(e.target.value)}
              className="w-full min-h-12 px-3 rounded-lg bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border)] text-sm outline-none"
            >
              <option value="">Cari müşteri seçin</option>
              {directories
                .filter((d) => d.type === 'CUSTOMER')
                .map((dir) => (
                  <option key={dir.id} value={dir.id}>
                    {dir.name} · Bakiye: {formatMoney(dir.balanceCents)}
                  </option>
                ))}
            </select>
          )}
        </div>
      ) : null}
    </div>
  );
};
