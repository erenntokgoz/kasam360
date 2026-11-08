import { ErrorToast } from '../../../ui/ErrorToast';
import { useEffect, useRef, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatDateTime } from '../../../lib/date';
import { SYNC_STATE_LABEL, useSyncStore, type SyncMember } from '../../../stores/syncStore';
import { Button } from '../../../ui/Button';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { Input } from '../../../ui/Input';
import { Modal } from '../../../ui/Modal';
import { RecordCard } from '../RecordCard';

export function DeviceSettings({ canManage }: { canManage: boolean }) {
  const { status, statusError, refresh, createPairingCode, setDevicePassive, takeOver } = useSyncStore();
  const [pairing, setPairing] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [passive, setPassive] = useState<SyncMember | null>(null);
  const [takeover, setTakeover] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const selected = status?.members.find((member) => member.deviceId === selectedId);

  useEffect(() => { void refresh(); }, [refresh]);

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try { await action(); }
    catch (caught) { setError(errorText(caught)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return (
    <section className="work-surface rounded-lg border border-[var(--border)] p-4 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Yerel Ağ</h2>
          <p className="text-sm text-[var(--text-secondary)]">{status ? SYNC_STATE_LABEL[status.state] : 'Durum alınamadı'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void refresh()}>Yenile</Button>
          {canManage && status ? <Button variant="primary" onClick={() => {
            setName(''); setCode(null); setError(null); setPairing(true);
          }}>Cihaz Eşleştir</Button> : null}
        </div>
      </header>
      {statusError ? <ErrorToast message={errorText(statusError)} /> : null}
      {status?.members.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {status.members.map((member) => (
            <li key={member.deviceId}>
              <RecordCard title={member.name}
                description={member.isLocal ? 'Bu cihaz' : member.connected ? 'Bağlı' : 'Bağlantı yok'}
                onOpen={() => setSelectedId(member.deviceId)} />
            </li>
          ))}
        </ul>
      ) : status?.mode === 'SINGLE' ? <p>Bu cihaz tek başına çalışıyor.</p> : null}
      {canManage && status?.mode === 'CLUSTER' && status.state === 'NO_CONNECTION' ? (
        <Button variant="secondary" onClick={() => { setPin(''); setError(null); setTakeover(true); }}>Bu Cihazla Tek Başına Devam Et</Button>
      ) : null}
      {selected && !passive ? (
        <Modal cardFlow isOpen title={selected.name} maxWidth="sm" onClose={() => setSelectedId(null)}>
          <div className="space-y-3">
            <dl className="grid gap-2 text-sm">
              <div><dt className="font-semibold">Bağlantı</dt><dd>{selected.isLocal ? 'Bu cihaz' : selected.connected ? 'Yerel ağa bağlı' : 'Bağlantı yok'}</dd></div>
              {selected.isAuthority ? <div><dt className="font-semibold">Ağ görevi</dt><dd>Ana cihaz</dd></div> : null}
              {selected.lastSeen ? <div><dt className="font-semibold">Son bağlantı</dt><dd className="tabular-nums">{formatDateTime(selected.lastSeen)}</dd></div> : null}
            </dl>
            {canManage && !selected.isLocal ? (
              <div className="flex justify-end"><Button variant="secondary" onClick={() => setPassive(selected)}>Pasife Al</Button></div>
            ) : null}
          </div>
        </Modal>
      ) : null}
      {passive && canManage ? <ConfirmDialog cardFlow title={`${passive.name} pasife alınsın mı?`}
        message="Cihaz yeniden eşleştirilene kadar bu işletmeye yazamaz."
        confirmLabel="Pasife Al" onClose={() => setPassive(null)} onConfirm={async () => { await setDevicePassive(passive.deviceId); setSelectedId(null); }} /> : null}
      <Modal cardFlow isOpen={pairing && canManage} title="Cihaz Eşleştir" maxWidth="sm" onClose={() => { if (!busy) setPairing(false); }}>
        {code ? (
          <div className="space-y-2">
            <p>Bu kodu yeni cihazdaki eşleştirme ekranına girin.</p>
            <Input aria-label="Eşleştirme kodu" readOnly value={code.code} onFocus={(event) => event.currentTarget.select()} />
            <p className="text-sm tabular-nums">Geçerlilik sonu: {formatDateTime(code.expiresAt)}</p>
          </div>
        ) : <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void run(async () => setCode(await createPairingCode(name.trim())));
        }}>
          <label className="block space-y-1"><span className="text-sm font-semibold">Cihaz adı</span>
            <Input aria-label="Yeni cihaz adı" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} required />
          </label>
          {error ? <ErrorToast message={error} /> : null}
          <Button type="submit" variant="primary" isLoading={busy} disabled={!name.trim()}>Kod Oluştur</Button>
        </form>}
      </Modal>
      <Modal cardFlow isOpen={takeover && canManage} title="Bu Cihazla Tek Başına Devam Et" maxWidth="sm" onClose={() => {
        if (!busy) { setPin(''); setTakeover(false); }
      }}>
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => { await takeOver(pin); setPin(''); setTakeover(false); });
        }}>
          <p>Bu işlemi yalnız diğer cihazlara kalıcı olarak erişilemiyorsa kullanın. Geçici ağ kesintisinde devam etmeyin.</p>
          <Input aria-label="Patron PIN’i" type="password" inputMode="numeric" pattern="[0-9]{4,8}" value={pin}
            maxLength={8} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} required />
          {error ? <ErrorToast message={error} /> : null}
          <Button type="button" disabled={busy} onClick={() => { setPin(''); setTakeover(false); }}>Vazgeç</Button>
          <Button type="submit" variant="danger" isLoading={busy} disabled={pin.length < 4}>Devral</Button>
        </form>
      </Modal>
    </section>
  );
}
