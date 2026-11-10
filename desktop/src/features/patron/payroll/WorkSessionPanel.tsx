import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { fromDateTimeLocalValue, toDateTimeLocalValue, toLocalRfc3339 } from '../../../lib/localTime';
import { createPrefixedId } from '../../../lib/prefixedId';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { NumberInput } from '../../../ui/NumberInput';
import { SettlementDialog } from './SettlementDialog';
import { netWorkedSeconds, type SessionSettlement } from './settlement';

interface WorkSession {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  breakMinutes: number;
  status: 'OPEN' | 'CLOSED';
}

const clock = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
/** Kayıtlı UTC anı yerel takvim gününe çevirir; saat yerel gösterilirken gün UTC kalırsa 01:47 önceki güne düşerdi. */
const localDay = (value: string) => new Date(value).toLocaleDateString('tr-TR');

interface WorkSessionPanelProps {
  userId: string;
  fullName: string;
  /** Çıkışta hesap kesildiğinde; borç listesi yenilensin. */
  onSettled: () => void;
}

/**
 * Fiili giriş ve çıkış. Çıkış gece yarısını aşabilir: süre iki an arasındaki farktır.
 * Çıkış kaydı ücreti hesaplar ve "Ödeme yapıldı mı?" sorusunu açar.
 */
export const WorkSessionPanel: React.FC<WorkSessionPanelProps> = ({ userId, fullName, onSettled }) => {
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [exitAt, setExitAt] = useState(() => toDateTimeLocalValue(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SessionSettlement | null>(null);
  const open = sessions.find((session) => session.status === 'OPEN');

  const load = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    setSessions(await invokeIPC<WorkSession[]>('list_staff_work_sessions', { tenantId, actorRole, userId }));
  }, [userId]);

  useEffect(() => {
    load().catch((caught) => setError(errorText(caught)));
  }, [load]);

  const save = async (session: WorkSession): Promise<SessionSettlement | null> => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    setSaving(true);
    setError(null);
    try {
      const reply = await invokeIPC<SessionSettlement>('save_staff_work_session', {
        tenantId, actorId, actorRole,
        // Giriş yerel ofsetle gönderilir: sunucu vardiya gününü yazılan ofsetten çıkarır, kayıtlı UTC metin gün kaydırırdı.
        input: { id: session.id, userId, startedAt: toLocalRfc3339(new Date(session.startedAt)), endedAt: session.endedAt, breakMinutes: session.breakMinutes },
      });
      await load();
      return reply;
    } catch (caught) {
      setError(errorText(caught));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const clockIn = async () => {
    setExitAt(toDateTimeLocalValue(new Date()));
    await save({ id: createPrefixedId('wks'), userId, startedAt: toLocalRfc3339(new Date()), endedAt: null, breakMinutes: 0, status: 'OPEN' });
  };

  const clockOut = async () => {
    if (!open) return;
    const exit = fromDateTimeLocalValue(exitAt);
    const minutes = Number(breakMinutes);
    if (!exit || netWorkedSeconds(open.startedAt, exit, minutes) === null) {
      setError('Çıkış girişten sonra olmalı, en çok 24 saat sürebilir ve mola süreden uzun olamaz.');
      return;
    }
    const reply = await save({ ...open, endedAt: toLocalRfc3339(exit), breakMinutes: minutes });
    if (!reply) return;
    setBreakMinutes('0');
    setResult(reply);
    onSettled();
  };

  const range = (session: WorkSession) => {
    const start = `${localDay(session.startedAt)} ${clock(session.startedAt)}`;
    if (!session.endedAt) return `${start} → Açık`;
    const sameDay = new Date(session.startedAt).toDateString() === new Date(session.endedAt).toDateString();
    return `${start} → ${sameDay ? '' : `${localDay(session.endedAt)} `}${clock(session.endedAt)}`;
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">Fiili giriş ve çıkış</h4>
      {error ? <ErrorToast message={error} /> : null}
      {open ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-xs">Çıkış zamanı
            <Input type="datetime-local" aria-label="Çıkış zamanı" className="min-h-12 mt-1" value={exitAt} onChange={(event) => setExitAt(event.target.value)} />
          </label>
          <label className="block text-xs">Mola (dakika)
            <NumberInput kind="integer" aria-label="Mola dakikası" className="min-h-12 mt-1" value={breakMinutes} onValueChange={setBreakMinutes} />
          </label>
          <Button type="button" variant="primary" isLoading={saving} onClick={() => void clockOut()}>Çıkışı Kaydet</Button>
        </div>
      ) : (
        <Button type="button" variant="primary" isLoading={saving} onClick={() => void clockIn()}>Giriş Kaydet</Button>
      )}
      <ul className="space-y-1 text-xs text-[var(--text-secondary)] tabular-nums">
        {sessions.slice(0, 8).map((session) => (
          <li key={session.id}>{range(session)} · mola {session.breakMinutes} dk</li>
        ))}
      </ul>
      {result ? <SettlementDialog result={result} fullName={fullName} onClose={() => { setResult(null); onSettled(); }} /> : null}
    </div>
  );
};
