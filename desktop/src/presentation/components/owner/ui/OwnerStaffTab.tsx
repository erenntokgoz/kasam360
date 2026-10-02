import { useState } from 'react';
import {
  Users,
  Wallet,
  Coins,
  CalendarDays,
  ChartNoAxesColumn,
  PackageOpen,
} from 'lucide-react';
import { StaffDirectoryTab } from '../staff/StaffDirectoryTab';
import { PayrollTab } from '../staff/PayrollTab';
import { TipPoolTab } from '../staff/TipPoolTab';
import { ShiftAndLeaveTab } from '../staff/ShiftAndLeaveTab';
import { PerformanceTab } from '../staff/PerformanceTab';
import { CustodyAndIncidentTab } from '../staff/CustodyAndIncidentTab';

type SekmeId = 'PERSONEL' | 'MAAS' | 'BAHSIS' | 'VARDIYA' | 'PERFORMANS' | 'ZIMMET';

const SEKMELER: { id: SekmeId; label: string; icon: React.ReactNode }[] = [
  { id: 'PERSONEL', label: 'Personel', icon: <Users size={14} /> },
  { id: 'MAAS', label: 'Maaş', icon: <Wallet size={14} /> },
  { id: 'BAHSIS', label: 'Bahşiş', icon: <Coins size={14} /> },
  { id: 'VARDIYA', label: 'Vardiya ve İzin', icon: <CalendarDays size={14} /> },
  { id: 'PERFORMANS', label: 'Performans', icon: <ChartNoAxesColumn size={14} /> },
  { id: 'ZIMMET', label: 'Zimmet ve Sicil', icon: <PackageOpen size={14} /> },
];

/**
 * Patron Paneli — Personel 360°.
 *
 * Altı sekme tek bir alanı bölüyor: kim çalışıyor, ne kazanıyor, ne kadar
 * bahşiş aldı, ne zaman çalışıyor, ne kadar sattı, ne teslim edildi.
 * Altı ayrı menü girdisi olsaydı patron paneli taşardı ve altı da birbirini
 * görmezdi.
 */
export function OwnerStaffTab() {
  const [sekme, setSekme] = useState<SekmeId>('PERSONEL');

  return (
    <div className="flex flex-col gap-6" data-testid="owner-staff-360">
      <nav
        aria-label="Personel bölümleri"
        className="flex items-center gap-1.5 overflow-x-auto rounded-3xl border border-black/[0.08] bg-white/75 p-1.5 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]"
      >
        {SEKMELER.map((s) => (
          <button
            key={s.id}
            onClick={() => setSekme(s.id)}
            aria-current={sekme === s.id ? 'page' : undefined}
            className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-2xl px-4 py-2 text-xs font-semibold transition-all ${
              sekme === s.id
                ? 'border border-black/[0.08] bg-white text-[#007AFF] shadow-sm dark:border-white/10 dark:bg-white/15 dark:text-[#409CFF]'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
            }`}
          >
            {s.icon}
            <span>{s.label}</span>
          </button>
        ))}
      </nav>

      {sekme === 'PERSONEL' && <StaffDirectoryTab />}
      {sekme === 'MAAS' && <PayrollTab />}
      {sekme === 'BAHSIS' && <TipPoolTab />}
      {sekme === 'VARDIYA' && <ShiftAndLeaveTab />}
      {sekme === 'PERFORMANS' && <PerformanceTab />}
      {sekme === 'ZIMMET' && <CustodyAndIncidentTab />}
    </div>
  );
}