import React, { useCallback, useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { errorText, localDate } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { AdvanceForm } from '../payroll/AdvanceForm';
import { LeavePanel } from '../payroll/LeavePanel';
import { RuleEditor, type PayrollRule } from '../payroll/RuleEditor';
import { ShiftPlanPanel } from '../payroll/ShiftPlanPanel';
import { SectionTabs, type SectionTab } from '../SectionTabs';
import { ROLE_LABEL, type StaffMember } from '../StaffFormModal';

export interface ProfileRow {
  userId: string;
  fullName: string;
  baseSalaryCents: number | null;
  phone: string | null;
  birthDate: string | null;
  hireDate: string | null;
  nationalId: string | null;
  address: string | null;
  emergencyContact: string | null;
  notes: string | null;
}

interface Kpi {
  orderCount: number;
  itemCount: number;
  grossSalesCents: number;
  avgTicketCents: number;
  voidCount: number;
  topProduct: string | null;
}

interface MoneySummary {
  advances: { id: string; amountCents: number; createdAt: string }[];
  tipCents: number;
}

type CardTab = 'PROFILE' | 'PERFORMANCE' | 'SHIFTS' | 'LEAVE' | 'ADVANCE' | 'SALARY' | 'TIPS';

interface StaffCardProps {
  member: StaffMember;
  profile: ProfileRow | undefined;
  isOwner: boolean;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}

const Fact: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <dt className="text-xs text-[var(--text-secondary)]">{label}</dt>
    <dd className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">{value}</dd>
  </div>
);

const month = () => localDate(new Date()).slice(0, 7);

/** Kişiye ait her şey tek kartta. Tutar ve kimlik sekmeleri müdürde hiç açılmaz. */
export const StaffCard: React.FC<StaffCardProps> = ({ member, profile, isOwner, onEdit, onChanged }) => {
  const [tab, setTab] = useState<CardTab>('PROFILE');
  const [hireDate, setHireDate] = useState(profile?.hireDate ?? '');
  const [nationalId, setNationalId] = useState(profile?.nationalId ?? '');
  const [address, setAddress] = useState(profile?.address ?? '');
  const [emergency, setEmergency] = useState(profile?.emergencyContact ?? '');
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [money, setMoney] = useState<MoneySummary | null>(null);
  const [rules, setRules] = useState<PayrollRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    setRules(await invokeIPC<PayrollRule[]>('get_payroll_rules', { tenantId, actorRole }));
  }, []);

  const loadMoney = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    setMoney(await invokeIPC<MoneySummary>('get_staff_money_summary', { tenantId, actorRole, userId: member.id, period: month() }));
  }, [member.id]);

  useEffect(() => {
    const { actorRole, tenantId } = sessionArgs();
    const fail = (caught: unknown) => setError(errorText(caught));
    setError(null);
    if (tab === 'PERFORMANCE') {
      const period = month();
      invokeIPC<Kpi[]>('get_staff_kpi', { tenantId, actorRole, from: `${period}-01`, to: `${localDate(new Date())}T23:59:59`, userId: member.id })
        .then((rows) => setKpi(rows[0] ?? null))
        .catch(fail);
    }
    if (tab === 'SALARY') loadRules().catch(fail);
    if (tab === 'ADVANCE' || tab === 'TIPS') loadMoney().catch(fail);
  }, [tab, member.id, loadRules, loadMoney]);

  const saveProfile = async () => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    setError(null);
    setNotice(null);
    try {
      await invokeIPC('save_staff_profile', {
        tenantId,
        actorId,
        actorRole,
        input: {
          userId: member.id,
          fullName: member.name,
          birthDate: profile?.birthDate ?? null,
          hireDate: hireDate || null,
          phone: profile?.phone ?? null,
          nationalId: isOwner ? nationalId || null : null,
          address: isOwner ? address || null : null,
          emergencyContact: isOwner ? emergency || null : null,
          notes: profile?.notes ?? null,
        },
      });
      setNotice('Kaydedildi.');
      await onChanged();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const tabs: SectionTab<CardTab>[] = [
    { id: 'PROFILE', label: 'Profil' },
    { id: 'PERFORMANCE', label: 'Performans' },
    { id: 'SHIFTS', label: 'Vardiya' },
    { id: 'LEAVE', label: 'İzin' },
    ...(isOwner
      ? ([
          { id: 'ADVANCE', label: 'Avans' },
          { id: 'SALARY', label: 'Maaş' },
          { id: 'TIPS', label: 'Bahşiş' },
        ] as SectionTab<CardTab>[])
      : []),
  ];

  return (
    <section className="paper min-h-full p-4 space-y-3 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="print-title text-xl">{member.name}</h3>
          <p className="text-xs text-[var(--text-secondary)]">{ROLE_LABEL[member.role] ?? member.role}{member.is_active ? '' : ' · Pasif'}</p>
        </div>
        {member.role !== 'OWNER' ? (
          <Button variant="secondary" className="min-h-12 text-xs" onClick={onEdit} aria-label={`${member.name} düzenle`}>
            <Pencil className="w-4 h-4 mr-1" />
            <span>Düzenle</span>
          </Button>
        ) : null}
      </div>

      <SectionTabs label="Personel kartı" tabs={tabs} active={tab} onChange={setTab} />

      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}

      {tab === 'PROFILE' ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-3">
            <Fact label="Rol" value={ROLE_LABEL[member.role] ?? member.role} />
            <Fact label="Telefon" value={profile?.phone || 'Girilmedi'} />
          </dl>
          <div className="flex flex-wrap gap-2 items-end">
            <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
              İşe giriş
              <Input aria-label="İşe giriş" type="date" className="min-h-12 !w-44" value={hireDate} onChange={(event) => setHireDate(event.target.value)} />
            </label>
            {isOwner ? (
              <>
                <Input aria-label="T.C. kimlik no" placeholder="T.C. kimlik no" className="min-h-12 !w-44" value={nationalId} onChange={(event) => setNationalId(event.target.value)} />
                <Input aria-label="Adres" placeholder="Adres" className="min-h-12 !w-56" value={address} onChange={(event) => setAddress(event.target.value)} />
                <Input aria-label="Acil durum kişisi" placeholder="Acil durum kişisi" className="min-h-12 !w-48" value={emergency} onChange={(event) => setEmergency(event.target.value)} />
              </>
            ) : null}
            <Button variant="primary" className="min-h-12 text-xs font-bold" onClick={() => void saveProfile()}>Kaydet</Button>
          </div>
          {notice ? <p className="text-xs font-semibold text-[var(--accent-emerald)]">{notice}</p> : null}
        </div>
      ) : null}

      {tab === 'PERFORMANCE' ? (
        kpi ? (
          <dl className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Fact label="Sipariş" value={String(kpi.orderCount)} />
            <Fact label="Kalem" value={String(kpi.itemCount)} />
            <Fact label="Satış" value={formatMoney(kpi.grossSalesCents)} />
            <Fact label="Ortalama Adisyon" value={formatMoney(kpi.avgTicketCents)} />
            <Fact label="İptal" value={String(kpi.voidCount)} />
            <Fact label="En Çok Sattığı" value={kpi.topProduct ?? '-'} />
          </dl>
        ) : <p className="text-sm text-[var(--text-secondary)]">Bu ay sipariş kaydı yok.</p>
      ) : null}

      {tab === 'SHIFTS' ? <ShiftPlanPanel userId={member.id} /> : null}
      {tab === 'LEAVE' ? <LeavePanel userId={member.id} /> : null}

      {tab === 'ADVANCE' ? (
        <div className="space-y-3">
          <AdvanceForm userId={member.id} period={month()} onSaved={() => void loadMoney().catch((caught) => setError(errorText(caught)))} />
          {money && money.advances.length > 0 ? (
            <ul className="text-sm divide-y divide-[var(--border)]">
              {money.advances.map((advance) => (
                <li key={advance.id} className="flex justify-between py-2">
                  <span className="text-[var(--text-secondary)]">{advance.createdAt.slice(0, 10)}</span>
                  <span className="font-bold tabular-nums">{formatMoney(advance.amountCents)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-[var(--text-secondary)]">Bu ay avans yok.</p>}
        </div>
      ) : null}

      {tab === 'SALARY' ? <RuleEditor userId={member.id} rules={rules} onSaved={loadRules} /> : null}

      {tab === 'TIPS' ? <Fact label="Bu ay dağıtılan bahşiş" value={money ? formatMoney(money.tipCents) : '-'} /> : null}
    </section>
  );
};
