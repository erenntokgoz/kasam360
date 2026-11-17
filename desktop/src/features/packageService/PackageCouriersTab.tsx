import React, { useEffect, useState } from 'react';
import { formatMoney } from '../../lib/formatMoney';
import { awaitingSettlement } from '../../lib/packageModel';
import { useAuthStore } from '../../stores/authStore';
import { usePackageStore } from '../../stores/packageStore';
import type { PackageCourier } from '../../types/packageService';
import { Button } from '../../ui/Button';
import { InlineAlert } from '../../ui/InlineAlert';
import { CourierSettleModal } from './CourierSettleModal';

const ROLE_NAME: Record<string, string> = { OWNER: 'İşletme sahibi', MANAGER: 'Müdür', CASHIER: 'Kasiyer', WAITER: 'Garson' };

/**
 * Kuryeler ve yoldaki işleri. Kurye etiketini sahip ve müdür verir; parayı yalnız tahsilat yetkili
 * roller (sahip, kasiyer) kuryeden teslim alır.
 */
export const PackageCouriersTab: React.FC = () => {
  const role = useAuthStore((state) => state.user?.role);
  const { couriers, rows, actionError, loadError, loadCouriers, setCourierFlag, dismissActionError } = usePackageStore();
  const [settling, setSettling] = useState<PackageCourier | null>(null);
  const canTag = role === 'OWNER' || role === 'MANAGER';
  const canCollect = role === 'OWNER' || role === 'CASHIER';

  useEffect(() => { void loadCouriers(); }, [loadCouriers]);

  const active = couriers.filter((courier) => courier.isCourier);
  const others = couriers.filter((courier) => !courier.isCourier);

  return (
    <div className="space-y-6">
      {loadError ? <InlineAlert message={`Kuryeler okunamadı: ${loadError}`} /> : null}
      {actionError ? <InlineAlert message={actionError} onDismiss={dismissActionError} /> : null}

      <section aria-label="Kuryeler" className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--text-secondary)]">Kuryeler</h2>
        {active.length === 0 ? <p className="text-sm">Kurye tanımlı değil.{canTag ? ' Aşağıdaki personelden birini kurye yapın.' : ''}</p> : (
          <div className="table-wrap work-surface overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th>Kurye</th><th className="text-right">Yolda</th><th className="text-right">Bekleyen nakit</th><th className="text-right">Bekleyen kart</th><th /></tr></thead>
              <tbody>
                {active.map((courier) => (
                  <tr key={courier.userId}>
                    <td className="font-bold">{courier.name}<span className="block text-xs font-normal text-[var(--text-secondary)]">{ROLE_NAME[courier.role] ?? courier.role}</span></td>
                    <td className="text-right tabular-nums">{courier.onRouteCount}</td>
                    <td className="text-right tabular-nums">{formatMoney(courier.unsettledCashCents)}</td>
                    <td className="text-right tabular-nums">{formatMoney(courier.unsettledCardCents)}</td>
                    <td className="space-x-2 text-right whitespace-nowrap">
                      {canCollect && courier.unsettledCount > 0 ? (
                        <Button variant="primary" size="sm" onClick={() => setSettling(courier)}>Mutabakat ({courier.unsettledCount})</Button>
                      ) : null}
                      {canTag ? <Button size="sm" onClick={() => void setCourierFlag(courier.userId, false)}>Kuryelikten çıkar</Button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canTag && others.length > 0 ? (
        <section aria-label="Personel" className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--text-secondary)]">Personel</h2>
          <ul className="divide-y">
            {others.map((person) => (
              <li key={person.userId} className="flex flex-wrap items-center justify-between gap-3 py-1 text-sm">
                <span><strong>{person.name}</strong> · {ROLE_NAME[person.role] ?? person.role}</span>
                <Button size="sm" onClick={() => void setCourierFlag(person.userId, true)}>Kurye yap</Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {settling ? <CourierSettleModal courier={settling} rows={awaitingSettlement(rows, settling.userId)} onClose={() => setSettling(null)} /> : null}
    </div>
  );
};
