import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useFeatureStore } from '../../stores/featureStore';
import { usePackageStore } from '../../stores/packageStore';
import { useUIStore } from '../../stores/uiStore';
import { Bar, BarAction, BarTab } from '../../ui/Bar';
import { PackageBoard } from './PackageBoard';
import { PackageCouriersTab } from './PackageCouriersTab';
import { PackageCustomersTab } from './PackageCustomersTab';
import { PackageOrderModal } from './PackageOrderModal';
import { PackageReportTab } from './PackageReportTab';

type PackageTab = 'BOARD' | 'CUSTOMERS' | 'COURIERS' | 'REPORT';

/** Tahta açıkken sunucudan yenilenme aralığı; başka cihazın değişikliği bu sürede görünür. */
const REFRESH_MS = 15_000;
/** Süre ve gecikme vurgusu için saat tiki. */
const CLOCK_MS = 30_000;

/**
 * Paket servis. Personel (sahip, müdür, kasiyer) tahta, müşteri, kurye ve rapor sekmelerini görür;
 * kurye etiketli garson yalnız kendine atanmış siparişleri görür ve Yolda / Teslim işaretler.
 * Bayrak kapalıysa hiçbir şey çizilmez; sunucu da komutu reddeder.
 */
export const PackageModule: React.FC = () => {
  const role = useAuthStore((state) => state.user?.role);
  const enabled = useFeatureStore((state) => state.flags.feat_delivery);
  const activeModule = useUIStore((state) => state.activeModule);
  const load = usePackageStore((state) => state.load);
  const loadCouriers = usePackageStore((state) => state.loadCouriers);
  const rowCount = usePackageStore((state) => state.rows.length);
  const [tab, setTab] = useState<PackageTab>('BOARD');
  const [isOrdering, setIsOrdering] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const staff = role === 'OWNER' || role === 'MANAGER' || role === 'CASHIER';
  const reports = role === 'OWNER' || role === 'MANAGER';
  const visible = enabled && activeModule === 'DELIVERY';

  useEffect(() => {
    if (!visible) return undefined;
    void load();
    if (staff) void loadCouriers();
    const refresh = window.setInterval(() => { void load(); }, REFRESH_MS);
    const clock = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    setNow(Date.now());
    return () => { window.clearInterval(refresh); window.clearInterval(clock); };
  }, [visible, staff, load, loadCouriers]);

  if (!enabled) return null;

  if (!staff) {
    return (
      <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)] select-none">
        <Bar label="Paket" title="Teslimatlarım"><BarTab active>Atanan siparişler</BarTab></Bar>
        <div className="page-fill flex-1 min-h-0 overflow-y-auto p-4"><PackageBoard now={now} mode="COURIER" /></div>
      </section>
    );
  }

  const tabs: { id: PackageTab; label: string; count?: number }[] = [
    { id: 'BOARD', label: 'Siparişler', count: rowCount },
    { id: 'CUSTOMERS', label: 'Müşteriler' },
    { id: 'COURIERS', label: 'Kuryeler' },
    ...(reports ? [{ id: 'REPORT' as const, label: 'Rapor' }] : []),
  ];

  return (
    <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)] select-none">
      <Bar label="Paket" title="Paket Servis" actions={<BarAction tone="primary" onClick={() => setIsOrdering(true)}>Yeni paket siparişi</BarAction>}>
        {tabs.map((item) => (
          <BarTab key={item.id} id={`package-tab-${item.id}`} aria-controls="package-content" active={tab === item.id} count={item.id === 'BOARD' ? item.count : undefined} onClick={() => setTab(item.id)}>
            {item.label}
          </BarTab>
        ))}
      </Bar>
      <div id="package-content" role="tabpanel" aria-labelledby={`package-tab-${tab}`} className="motion-swap page-fill flex-1 min-h-0 overflow-y-auto p-4">
        {tab === 'BOARD' && <PackageBoard now={now} mode="STAFF" />}
        {tab === 'CUSTOMERS' && <PackageCustomersTab />}
        {tab === 'COURIERS' && <PackageCouriersTab />}
        {tab === 'REPORT' && reports && <PackageReportTab />}
      </div>
      {isOrdering ? <PackageOrderModal onClose={() => setIsOrdering(false)} /> : null}
    </section>
  );
};
