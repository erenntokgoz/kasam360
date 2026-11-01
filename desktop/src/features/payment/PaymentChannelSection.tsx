import { parseMoneyToCents } from '../../lib/moneyParser';
import React, { useState } from 'react';
import { Banknote, CreditCard, Utensils, BookOpen } from 'lucide-react';
import type { PaymentMethod } from '../../types/payment';
import type { DirectoryContact } from '../../types/ledger';
import { formatMoney } from '../../lib/formatMoney';
import { errorText } from '../../lib/cariInput';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Numpad } from '../../ui/Numpad';

export interface PaymentChannelSectionProps {
  channel: PaymentMethod;
  onSelectChannel: (channel: PaymentMethod) => void;
  payNowCents: number;
  tenderedLiras: string;
  onChangeTendered: (liras: string) => void;
  directories: DirectoryContact[];
  selectedDirectoryId: string;
  onSelectDirectory: (id: string) => void;
  onCreateContact: (name: string, phone: string) => Promise<void>;
}

/** Yazım sürerken bozuk tutar para üstü göstermez; kuruş hesabı kayan noktaya girmez. */
function parseTenderedCents(text: string, fallback: number): number {
  try {
    return parseMoneyToCents(text);
  } catch {
    return fallback;
  }
}

export const PaymentChannelSection: React.FC<PaymentChannelSectionProps> = ({
  channel,
  onSelectChannel,
  payNowCents,
  tenderedLiras,
  onChangeTendered,
  directories,
  selectedDirectoryId,
  onSelectDirectory,
  onCreateContact,
}) => {
  const [showQuickAddCari, setShowQuickAddCari] = useState(false);
  const [newCariName, setNewCariName] = useState('');
  const [newCariPhone, setNewCariPhone] = useState('');
  const [cariError, setCariError] = useState<string | null>(null);

  const tenderedCents = tenderedLiras ? parseTenderedCents(tenderedLiras, payNowCents) : payNowCents;
  const changeDueCents = Math.max(0, tenderedCents - payNowCents);

  const handleBanknotePreset = (liras: number) => {
    onChangeTendered(liras.toString());
  };

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

  return (
    <div className="space-y-3">
      {/* Ödeme Kanalları */}
      <div className="space-y-1.5">
        <div className="grid grid-cols-2 gap-2">
          {[
            { id: 'CASH' as const, label: 'Nakit', icon: Banknote },
            { id: 'CARD' as const, label: 'Kart', icon: CreditCard },
            { id: 'MEAL_CARD' as const, label: 'Yemek Kartı', icon: Utensils },
            { id: 'VERESIYE' as const, label: 'Cari', icon: BookOpen },
          ].map((ch) => {
            const Icon = ch.icon;
            const isSelected = channel === ch.id;
            return (
              <Button
                key={ch.id}
                type="button"
                variant={isSelected ? 'primary' : 'secondary'}
                size="md"
                onClick={() => onSelectChannel(ch.id)}
                className="!min-h-14"
              >
                <Icon className="w-4 h-4 mr-1.5 shrink-0" />
                <span>{ch.label}</span>
              </Button>
            );
          })}
        </div>
      </div>

      {channel === 'CASH' ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-[var(--bg-subtle)] p-3">
              <span className="block text-sm text-[var(--text-secondary)]">Alınan</span>
              <span className="block text-2xl font-extrabold tabular-nums">{formatMoney(tenderedCents)}</span>
            </div>
            <div className="rounded-md bg-[var(--accent-emerald-soft)] p-3">
              <span className="block text-sm text-[var(--text-secondary)]">Para üstü</span>
              <span className="block text-2xl font-extrabold tabular-nums">{formatMoney(changeDueCents)}</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[100, 200, 500, 1000].map((banknote) => (
              <Button key={banknote} variant="secondary" size="sm" className="tabular-nums whitespace-nowrap !px-1" onClick={() => handleBanknotePreset(banknote)}>
                {banknote.toLocaleString('tr-TR')} ₺
              </Button>
            ))}
          </div>
          <Numpad
            buttonHeightClass="!min-h-14"
            onDigit={(digit) => {
              if (tenderedLiras.length < 7) onChangeTendered(tenderedLiras + digit);
            }}
            onClear={() => onChangeTendered('')}
            onBackspace={() => onChangeTendered(tenderedLiras.slice(0, -1))}
          />
        </div>
      ) : null}

      {/* Veresiye / Cari Seçimi */}
      {channel === 'VERESIYE' ? (
        <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-[var(--text-secondary)]">
              Cari Müşteri Seçin
            </label>
            <button
              type="button"
              onClick={() => setShowQuickAddCari(!showQuickAddCari)}
              className="text-xs font-semibold text-[var(--accent-amber)] hover:underline cursor-pointer"
            >
              {showQuickAddCari ? 'Listeye Dön' : '+ Yeni Cari Ekle'}
            </button>
          </div>

          {showQuickAddCari ? (
            <div className="space-y-2 pt-1 border-t border-[var(--border)]">
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={newCariName}
                  onChange={(e) => setNewCariName(e.target.value)}
                  placeholder="Müşteri Adı / Ünvan"
                  className="flex-1 text-xs"
                />
                <Input
                  type="text"
                  value={newCariPhone}
                  onChange={(e) => setNewCariPhone(e.target.value)}
                  placeholder="0532..."
                  className="w-32 text-xs"
                />
              </div>
              {cariError ? (
                <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
                  {cariError}
                </p>
              ) : null}
              <Button
                variant="primary"
                size="sm"
                onClick={handleCreateCariSubmit}
                disabled={!newCariName}
                className="w-full text-xs"
              >
                Kaydet ve Seç
              </Button>
            </div>
          ) : (
            <select
              value={selectedDirectoryId}
              onChange={(e) => onSelectDirectory(e.target.value)}
              className="w-full min-h-12 px-3 rounded-lg paper text-[var(--text-primary)] border border-[var(--border)] text-xs outline-none"
            >
              <option value="">Cari müşteri seçin...</option>
              {directories
                .filter((d) => d.type === 'CUSTOMER')
                .map((dir) => (
                  <option key={dir.id} value={dir.id}>
                    {dir.name} ({dir.phone || 'Tel Yok'}) · Bakiye: {formatMoney(dir.balanceCents)}
                  </option>
                ))}
            </select>
          )}
        </div>
      ) : null}
    </div>
  );
};
