import React, { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, DollarSign, TrendingDown, Check } from 'lucide-react';
import { useLedgerStore } from '../../stores/ledgerStore';
import { formatMoney } from '../../lib/formatMoney';
import { errorText, parseCents } from '../../lib/cariInput';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import type { PatronActionType } from '../../types/ledger';

export const PatronWizardTab: React.FC = () => {
  const { directories, executePatronAction } = useLedgerStore();

  const [selectedAction, setSelectedAction] = useState<PatronActionType | null>(null);
  const [amountLiras, setAmountLiras] = useState('');
  const [selectedDirectoryId, setSelectedDirectoryId] = useState('');
  const [category, setCategory] = useState('Dükkan Masrafı');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const wizardActions: Array<{
    type: PatronActionType;
    label: string;
    sub: string;
    icon: React.ComponentType<{ className?: string }>;
    variant: 'outline-emerald' | 'outline-amber' | 'secondary' | 'danger';
    colorClass: string;
  }> = [
    {
      type: 'BORC',
      label: 'BORÇ ALDIM',
      sub: 'Kişiden veya kurumdan borç nakit aldım',
      icon: ArrowDownLeft,
      variant: 'outline-amber',
      colorClass: 'text-[var(--accent-amber)]',
    },
    {
      type: 'ALACAK',
      label: 'BORÇ VERDİM',
      sub: 'Kişiye veya personele borç nakit verdim',
      icon: ArrowUpRight,
      variant: 'secondary',
      colorClass: 'text-[var(--accent-blue)]',
    },
    {
      type: 'GELIR',
      label: 'KASA GİRİŞİ (GELİR)',
      sub: 'Ekstra işletme dışı gelir girişi',
      icon: DollarSign,
      variant: 'outline-emerald',
      colorClass: 'text-[var(--accent-emerald)]',
    },
    {
      type: 'GIDER',
      label: 'KASA ÇIKIŞI (GİDER)',
      sub: 'Fatura, pazar, kira, dükkan masrafı',
      icon: TrendingDown,
      variant: 'secondary',
      colorClass: 'text-[var(--accent-red)]',
    },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAction) return;
    const cents = parseCents(amountLiras);
    if (!cents) {
      setErrorMsg('Geçerli bir tutar girin.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await executePatronAction(selectedAction, cents, selectedDirectoryId, category, description);
      setSuccessMsg(`İşlem başarıyla kaydedildi (${formatMoney(cents)}).`);
      setSelectedAction(null);
      setAmountLiras('');
      setDescription('');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (error) {
      setErrorMsg(errorText(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-[var(--text-primary)]">
          Hızlı Kasa & Hareket Sihirbazı
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
          Tek dokunuşla borç alma, borç verme veya masraf girişlerini deftere işleyin.
        </p>
      </div>

      {successMsg ? (
        <div className="p-3 rounded-xl bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald)] border border-[var(--accent-emerald-border)] text-xs font-bold flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>{successMsg}</span>
        </div>
      ) : null}

      {errorMsg ? (
        <div
          role="alert"
          className="p-3 rounded-xl bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red)] text-xs font-bold"
        >
          {errorMsg}
        </div>
      ) : null}

      {/* 4 Devasa Buton Izgarası */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {wizardActions.map((act) => {
          const Icon = act.icon;
          const isSelected = selectedAction === act.type;

          return (
            <button
              key={act.type}
              type="button"
              onClick={() => setSelectedAction(act.type)}
              className={`p-5 rounded-2xl border text-left flex items-start gap-4 cursor-pointer transition-all ${
                isSelected
                  ? 'bg-[var(--bg-card)] border-[var(--accent-amber)] shadow-lg ring-2 ring-[var(--accent-amber)]/20'
                  : 'bg-[var(--bg-card)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <div className={`p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] ${act.colorClass}`}>
                <Icon className="w-6 h-6" />
              </div>

              <div>
                <span className="text-sm font-bold text-[var(--text-primary)] block">
                  {act.label}
                </span>
                <span className="text-xs text-[var(--text-secondary)] mt-1 block">
                  {act.sub}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Seçilen Eylemin Detay Formu */}
      {selectedAction ? (
        <form
          onSubmit={handleSubmit}
          className="bg-[var(--bg-panel)] border border-[var(--accent-amber-border)] rounded-2xl p-5 space-y-4 shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
            <span className="text-sm font-bold text-[var(--accent-amber)]">
              {wizardActions.find((a) => a.type === selectedAction)?.label} Formu
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelectedAction(null)}
              className="text-xs"
            >
              Vazgeç
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                Tutar (₺)
              </label>
              <Input
                type="number"
                min="1"
                step="1"
                value={amountLiras}
                onChange={(e) => setAmountLiras(e.target.value)}
                placeholder="Örn: 1000"
                className="text-lg font-bold tabular-nums"
                required
                autoFocus
              />
            </div>

            {selectedAction === 'BORC' || selectedAction === 'ALACAK' ? (
              <div>
                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                  İlgili Kişi / Tedarikçi / Cari
                </label>
                <select
                  value={selectedDirectoryId}
                  onChange={(e) => setSelectedDirectoryId(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border)] text-xs outline-none"
                  required
                >
                  <option value="">Cari seçin...</option>
                  {directories.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.type === 'SUPPLIER' ? 'Tedarikçi' : 'Müşteri'})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                  Gider / Gelir Kategorisi
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border)] text-xs outline-none"
                >
                  <option value="Dükkan Masrafı">Dükkan Masrafı</option>
                  <option value="Kira / Aidat">Kira / Aidat</option>
                  <option value="Elektrik / Su / Gaz">Elektrik / Su / Gaz</option>
                  <option value="Pazar / Manav">Pazar / Manav Alışverişi</option>
                  <option value="Ekipman & Tamirat">Ekipman & Tamirat</option>
                  <option value="Diğer">Diğer</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
              Açıklama / Not
            </label>
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="İşlem açıklaması girin..."
              className="text-xs"
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full font-bold text-sm"
            isLoading={isSubmitting}
          >
            Hareketi Kaydet ve Kasaya İşle
          </Button>
        </form>
      ) : null}
    </div>
  );
};
