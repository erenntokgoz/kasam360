import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useEffect, useRef, useState } from 'react';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { useStationStore, type Station } from '../../../stores/stationStore';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Modal } from '../../../ui/Modal';
import { RecordCard } from '../RecordCard';

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const selected = stations.find((station) => station.id === selectedId);
  const [draft, setDraft] = useState<Station | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { tenantId, actorRole } = sessionArgs();
    void load().catch((caught) => setError(String(caught)));
    void invokeIPC<string[]>('list_printers').then(setPrinters).catch((caught) => setError(String(caught)));
    void invokeIPC<StaffOption[]>('get_staff', { tenantId, actorRole, includeInactive: false }).then(setStaff).catch((caught) => setError(String(caught)));
  }, [load]);

  const save = async () => {
    if (!draft?.name.trim() || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { tenantId, actorRole } = sessionArgs();
      await invokeIPC('save_station', { actorRole, tenantId, input: { ...draft, id: draft.id || null } });
      setDraft(null);
      await load();
    } catch (caught) {
      setError(String(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const remove = async (stationId: string) => {
    const { tenantId, actorRole } = sessionArgs();
    await invokeIPC('delete_station', { actorRole, tenantId, stationId });
    setSelectedId(null);
    await load().catch((caught) => setError(String(caught)));
  };

  const toggleUser = (id: string, isOn: boolean) =>
    setDraft((current) =>
      current && { ...current, userIds: isOn ? [...current.userIds, id] : current.userIds.filter((userId) => userId !== id) },
    );

  return (
    <div className="space-y-4">
      {error && !draft ? <ErrorToast message={error} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="print-title">Mutfak İstasyonları</h3>
        <Button variant="primary" disabled={busy} onClick={() => { setError(null); setDraft(EMPTY); }}>İstasyon Ekle</Button>
      </div>
      {stations.length === 0 ? <p className="text-sm">Tanımlı istasyon yok.</p> : null}
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {stations.map((station) => (
          <li key={station.id}>
            <RecordCard title={station.name}
              description={`${station.printerName ?? 'Yazıcı yok'} · ${station.userIds.length} kullanıcı`}
              onOpen={() => { setError(null); setSelectedId(station.id); }} />
          </li>
        ))}
      </ul>

      {!deleting && (draft || selected) ? (
        <Modal cardFlow isOpen onClose={() => {
          if (!inFlight.current) { setSelectedId(null); setDraft(null); setError(null); }
        }} title={selected?.name ?? 'İstasyon Ekle'} maxWidth="sm">
          {draft ? (
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <label className="block space-y-1 text-sm font-semibold">
              <span>İstasyon adı</span>
              <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
            </label>
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
            {error ? <ErrorToast message={error} /> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" disabled={busy} onClick={() => { setDraft(null); setError(null); }}>Vazgeç</Button>
              <Button type="submit" variant="primary" disabled={!draft.name.trim()} isLoading={busy}>Kaydet</Button>
            </div>
          </form>
          ) : selected ? (
            <div className="space-y-3">
              <dl className="grid gap-2 text-sm">
                <div><dt className="font-semibold">Yazıcı</dt><dd>{selected.printerName ?? 'Yazıcı yok'}</dd></div>
                <div>
                  <dt className="font-semibold">Personel</dt>
                  <dd>{staff.filter((person) => selected.userIds.includes(person.id)).map((person) => person.name).join(', ') || 'Aktif personel yok'}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => setDeleting(true)}>İstasyonu Sil</Button>
                <Button variant="primary" disabled={busy} onClick={() => setDraft(selected)}>Düzenle</Button>
              </div>
            </div>
          ) : null}
        </Modal>
      ) : null}
      {deleting && selected ? (
        <ConfirmDialog cardFlow title={`${selected.name} silinsin mi?`}
          onClose={() => setDeleting(false)} onConfirm={() => remove(selected.id)} />
      ) : null}
    </div>
  );
};
