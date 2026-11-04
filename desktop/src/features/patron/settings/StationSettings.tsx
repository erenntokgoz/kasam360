import React, { useEffect, useState } from 'react';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { useStationStore, type Station } from '../../../stores/stationStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Modal } from '../../../ui/Modal';

interface StaffOption {
  id: string;
  name: string;
}

const field = 'min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm text-[var(--text-primary)]';

const EMPTY: Station = { id: '', name: '', printerName: null, userIds: [] };

export const StationSettings: React.FC = () => {
  const { stations, load } = useStationStore();
  const [printers, setPrinters] = useState<string[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [draft, setDraft] = useState<Station | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { tenantId, actorRole } = sessionArgs();
    void load().catch((caught) => setError(String(caught)));
    void invokeIPC<string[]>('list_printers').then(setPrinters).catch((caught) => setError(String(caught)));
    void invokeIPC<StaffOption[]>('get_staff', { tenantId, actorRole, includeInactive: false }).then(setStaff).catch((caught) => setError(String(caught)));
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await load();
      setDraft(null);
    } catch (caught) {
      setError(String(caught));
    }
  };

  const save = () => {
    if (!draft?.name.trim()) return;
    const { tenantId, actorRole } = sessionArgs();
    void run(() => invokeIPC('save_station', { actorRole, tenantId, input: { ...draft, id: draft.id || null } }));
  };

  const remove = (stationId: string) => {
    const { tenantId, actorRole } = sessionArgs();
    void run(() => invokeIPC('delete_station', { actorRole, tenantId, stationId }));
  };

  const toggleUser = (id: string, isOn: boolean) =>
    setDraft((current) =>
      current && { ...current, userIds: isOn ? [...current.userIds, id] : current.userIds.filter((userId) => userId !== id) },
    );

  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
      <Button variant="primary" className="min-h-12" onClick={() => setDraft(EMPTY)}>İstasyon Ekle</Button>
      <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] paper">
        {stations.length === 0 ? <li className="p-4 text-sm">Tanımlı istasyon yok.</li> : null}
        {stations.map((station) => (
          <li key={station.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="min-w-0">
              <span className="block font-bold">{station.name}</span>
              <span className="block text-xs text-[var(--text-secondary)]">
                {station.printerName ?? 'Yazıcı yok'} · {station.userIds.length} kullanıcı
              </span>
            </span>
            <span className="flex gap-2">
              <Button variant="secondary" className="min-h-12" onClick={() => setDraft(station)}>Düzenle</Button>
              <Button variant="secondary" className="min-h-12" onClick={() => remove(station.id)}>Sil</Button>
            </span>
          </li>
        ))}
      </ul>

      {draft ? (
        <Modal isOpen onClose={() => setDraft(null)} title={draft.id ? 'İstasyonu Düzenle' : 'İstasyon Ekle'} maxWidth="sm">
          <div className="space-y-3">
            <Input aria-label="İstasyon adı" placeholder="İstasyon adı" className="min-h-12" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            <select aria-label="Yazıcı" className={field} value={draft.printerName ?? ''} onChange={(event) => setDraft({ ...draft, printerName: event.target.value || null })}>
              <option value="">Yazıcı yok</option>
              {printers.map((printer) => <option key={printer} value={printer}>{printer}</option>)}
            </select>
            <div className="max-h-56 overflow-y-auto">
              {staff.map((person) => (
                <label key={person.id} className="flex min-h-12 items-center gap-2 text-sm">
                  <input type="checkbox" checked={draft.userIds.includes(person.id)} onChange={(event) => toggleUser(person.id, event.target.checked)} />
                  <span className="truncate">{person.name}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1 min-h-12" onClick={() => setDraft(null)}>Vazgeç</Button>
              <Button variant="primary" className="flex-1 min-h-12" disabled={!draft.name.trim()} onClick={save}>Kaydet</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
};
