import React, { useCallback, useState } from 'react';
import { Loader2, User, Save, AlertTriangle } from 'lucide-react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../../store/useAuthStore';
import { formatCurrency, formatDateTime } from '../helpers';

// record_owner_personal yaniti (backend/src/ledger_commands/owner_personal.rs)
export interface OwnerPersonalDto {
  debtId: string;
  directoryName: string;
  amountCents: number;
  amountLabel: string;
  movementKind: string;
  ledgerLabel: string;
  excludedFromProfit: boolean;
  createdAt: string;
}

interface OwnerPersonalPanelProps {
  directoryId: string;
  onNotify: (message: string, type: 'success' | 'error') => void;
}

type MovementKind = 'SERMAYE_CEKIMI' | 'BORC';

/**
 * Patron Sahsi hesabi paneli.
 * K-4: bu hareketler P&L'e girmez, rozet zorunludur.
 * AGENTS.md 6: panel yalnizca OWNER rolune gorunur.
 */
export const OwnerPersonalPanel: React.FC<OwnerPersonalPanelProps> = ({ directoryId, onNotify }) => {
  const user = useAuthStore((state) => state.user);
  const actorRole = user?.role ?? 'Cashier';

  const [amountStr, setAmountStr] = useState('');
  const [movementKind, setMovementKind] = useState<MovementKind>('BORC');
  const [note, setNote] = useState('');
  const [lastEntry, setLastEntry] = useState<OwnerPersonalDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const canRecord = actorRole.toLowerCase() === 'owner';

  const resetForm = useCallback(() => {
    setAmountStr('');
    setNote('');
    setFormError(null);
  }, []);

  const handleSubmit = async () => {
    // Para alani once tam sayi kuruşa cevrilir; float üzerinden işlem yapılmaz.
    const parsed = Number(amountStr.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setFormError('Gecerli bir tutar giriniz (kuruş cinsinden tam sayi).');
      return;
    }
    const amountCents = Math.round(parsed * 100);
    if (!Number.isSafeInteger(amountCents)) {
      setFormError('Tutar guvenli araligin disinda.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const result = await invoke<OwnerPersonalDto>('record_owner_personal', {
        directoryId,
        amountCents,
        movementKind,
        note: note.trim() || null,
      });
      setLastEntry(result);
      onNotify(`${result.ledgerLabel} kaydedildi (${result.amountLabel}).`, 'success');
      resetForm();
    } catch (e) {
      setFormError(String(e));
      onNotify(`Patron Sahsi islemi kaydedilemedi: ${String(e)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!canRecord) {
    return (
      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl">
        <div className="flex items-center gap-2.5">
          <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-zinc-500 rounded-2xl border dark:border-white/10 border-black/[0.08]">
            <User size={18} />
          </div>
          <h2 className="text-base font-semibold dark:text-white text-zinc-900">Patron Sahsi Hesabi</h2>
        </div>
        <p className="text-sm dark:text-zinc-400 text-zinc-500 mt-3 flex items-center gap-2">
          <AlertTriangle size={14} />
          Bu panel yalnizca isletme sahibi (OWNER) rolu tarafindan kullanilabilir.
        </p>
      </div>
    );
  }

  return (
    <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-purple-600 dark:text-purple-400 rounded-2xl border dark:border-white/10 border-black/[0.08]">
          <User size={18} />
        </div>
        <h2 className="text-base font-semibold dark:text-white text-zinc-900">Patron Sahsi Hesabi</h2>
      </div>
      <p className="text-xs dark:text-zinc-400 text-zinc-500 mb-4">
        Bu hareketler gelir-gider defterine girmez, P&amp;L&apos;de zarar sanilmaz.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500">Tutar (TL)</span>
          <input
            type="text"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="0,00"
            className="mt-1 w-full h-10 px-3 rounded-xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 text-sm focus:outline-none focus:border-[#007AFF]/60"
          />
        </label>

        <label className="block">
          <span className="text-[11px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500">Hareket Tipi</span>
          <select
            value={movementKind}
            onChange={(e) => setMovementKind(e.target.value as MovementKind)}
            className="mt-1 w-full h-10 px-3 rounded-xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 text-xs focus:outline-none"
          >
            <option value="BORC">Patron Sahsi Borcu</option>
            <option value="SERMAYE_CEKIMI">Sermaye Cekimi</option>
          </select>
        </label>

        <label className="block">
          <span className="text-[11px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500">Aciklama</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Istege bagli"
            className="mt-1 w-full h-10 px-3 rounded-xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 text-sm focus:outline-none focus:border-[#007AFF]/60"
          />
        </label>
      </div>

      {formError && (
        <p data-testid="owner-personal-error" className="text-xs text-red-600 dark:text-red-400 mt-2">
          {formError}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={saving}
        className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold bg-[#007AFF] hover:bg-[#0071E3] text-white shadow-lg shadow-[#007AFF]/20 transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        <span>{saving ? 'Kaydediliyor...' : 'Patron Sahsi Hareketi Kaydet'}</span>
      </button>

      {lastEntry && (
        <div
          data-testid="owner-personal-last"
          className="mt-4 p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/25"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-purple-700 dark:text-purple-300">{lastEntry.ledgerLabel}</p>
            {/* K-4: rozet zorunlu */}
            {lastEntry.excludedFromProfit && (
              <span
                data-testid="owner-personal-excluded-badge"
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-500/30"
              >
                P&amp;L Disi
              </span>
            )}
          </div>
          <p className="text-sm font-semibold tabular-nums dark:text-white text-zinc-900 mt-1">
            {lastEntry.amountLabel}
          </p>
          <p className="text-[11px] dark:text-zinc-400 text-zinc-500">
            {lastEntry.directoryName} &bull; {formatDateTime(lastEntry.createdAt)}
          </p>
          <p className="text-[11px] dark:text-zinc-400 text-zinc-500 mt-1">
            Kayit tutari: {formatCurrency(lastEntry.amountCents)}
          </p>
        </div>
      )}
    </div>
  );
};

export default OwnerPersonalPanel;