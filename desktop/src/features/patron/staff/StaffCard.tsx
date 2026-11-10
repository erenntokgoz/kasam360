import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useCallback, useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { errorText, localDate } from '../../../lib/cariInput';
import { formatDay, formatInstantDay } from '../../../lib/date';
import { formatMoney } from '../../../lib/formatMoney';
import { formatNumber } from '../../../lib/numberText';
import { recentPeriods } from '../../../lib/payPeriod';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { Modal } from '../../../ui/Modal';
import { RecordCard } from '../RecordCard';
import { AdvanceForm } from '../payroll/AdvanceForm';
import { LeavePanel } from '../payroll/LeavePanel';
import { RuleEditor, type PayrollRule } from '../payroll/RuleEditor';
import { ShiftPlanPanel } from '../payroll/ShiftPlanPanel';
import { StaffDebtPanel } from '../payroll/StaffDebtPanel';
import { WorkSessionPanel } from '../payroll/WorkSessionPanel';
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
  advances: { id: string; expenseId: string; amountCents: number; paymentMethod: string; createdAt: string }[];
  tipCents: number;
}

type CardTab = 'PROFILE' | 'PERFORMANCE' | 'SHIFTS' | 'LEAVE' | 'ADVANCE' | 'SALARY' | 'DEBT' | 'TIPS';

interface StaffCardProps {
  member: StaffMember;
  profile: ProfileRow | undefined;
  isOwner: boolean;
  canViewPayroll: boolean;
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
const METHOD_LABEL: Record<string, string> = { CASH: 'Nakit', BANK_TRANSFER: 'Havale' };

/** Kişiye ait her şey tek kartta. Tutar ve kimlik sekmeleri müdürde hiç açılmaz. */
export const StaffCard: React.FC<StaffCardProps> = ({ member, profile, isOwner, canViewPayroll, onEdit, onChanged }) => {
  const [tab, setTab] = useState<CardTab>('PROFILE');
  // Avans ve bahşiş sekmeleri aynı ayı gösterir: geçmiş ayın avansı da düzeltilebilsin.
  const [moneyPeriod, setMoneyPeriod] = useState(month());
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [money, setMoney] = useState<MoneySummary | null>(null);
  const [rules, setRules] = useState<PayrollRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedAdvance, setSelectedAdvance] = useState<MoneySummary['advances'][number] | null>(null);
  const [deletingAdvance, setDeletingAdvance] = useState<MoneySummary['advances'][number] | null>(null);
  const [editingAdvance, setEditingAdvance] = useState<MoneySummary['advances'][number] | null>(null);
  const [debtKey, setDebtKey] = useState(0);

  const loadRules = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    setRules(await invokeIPC<PayrollRule[]>('get_payroll_rules', { tenantId, actorRole }));
  }, []);

  const loadMoney = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    setMoney(await invokeIPC<MoneySummary>('get_staff_money_summary', { tenantId, actorRole, userId: member.id, period: moneyPeriod }));
  }, [member.id, moneyPeriod]);

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

  const toggleApproval = async () => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    setError(null);
    try {
      await invokeIPC('set_staff_approval', { staffId: member.id, canApprove: !member.can_approve, actorId, actorRole, tenantId });
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
    ...(canViewPayroll
      ? ([
          { id: 'ADVANCE', label: 'Avans' },
          { id: 'SALARY', label: 'Maaş' },
          { id: 'DEBT', label: 'Borç' },
        ] as SectionTab<CardTab>[])
      : []),
    ...(isOwner ? ([{ id: 'TIPS', label: 'Bahşiş' }] as SectionTab<CardTab>[]) : []),
  ];

  return (
    <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-4 min-w-0 self-start">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">{member.name}</h3>
          <p className="text-xs text-[var(--text-secondary)]">{ROLE_LABEL[member.role] ?? member.role}{member.is_active ? '' : ' · Pasif'}</p>
        </div>
        {member.role !== 'OWNER' ? (
          <Button variant="secondary" className="min-h-12 text-sm" onClick={onEdit} aria-label={`${member.name} düzenle`}>
            <Pencil className="w-4 h-4 mr-1" />
            <span>Düzenle</span>
          </Button>
        ) : null}
      </div>

      <SectionTabs label="Personel kartı" tabs={tabs} active={tab} onChange={setTab} />

      {error ? <ErrorToast message={error} /> : null}

      {tab === 'PROFILE' ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-3">
            <Fact label="Rol" value={ROLE_LABEL[member.role] ?? member.role} />
            <Fact label="Telefon" value={profile?.phone || 'Girilmedi'} />
            <Fact label="İşe giriş" value={profile?.hireDate ? formatDay(profile.hireDate) : 'Girilmedi'} />
            {isOwner ? (
              <>
                <Fact label="T.C. kimlik no" value={profile?.nationalId || 'Girilmedi'} />
                <Fact label="Acil durum kişisi" value={profile?.emergencyContact || 'Girilmedi'} />
                <Fact label="Adres" value={profile?.address || 'Girilmedi'} />
              </>
            ) : null}
          </dl>
          {isOwner && member.role !== 'MANAGER' ? (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
              <span className="text-sm font-semibold text-[var(--text-primary)]">Onay yetkisi</span>
              <Button variant={member.can_approve ? 'selected' : 'secondary'} className="min-h-12" onClick={() => void toggleApproval()}>
                {member.can_approve ? 'Yetkiyi Kaldır' : 'Yetki Ver'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'PERFORMANCE' ? (
        kpi ? (
          <dl className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Fact label="Sipariş" value={formatNumber(kpi.orderCount)} />
            <Fact label="Kalem" value={formatNumber(kpi.itemCount)} />
            <Fact label="Satış" value={formatMoney(kpi.grossSalesCents)} />
            <Fact label="Ortalama Adisyon" value={formatMoney(kpi.avgTicketCents)} />
            <Fact label="İptal" value={formatNumber(kpi.voidCount)} />
            <Fact label="En Çok Sattığı" value={kpi.topProduct ?? '-'} />
          </dl>
        ) : <p className="text-sm text-[var(--text-secondary)]">Bu ay sipariş kaydı yok.</p>
      ) : null}

      {tab === 'SHIFTS' ? (
        <div className="space-y-4">
          <ShiftPlanPanel userId={member.id} />
          <div className="border-t border-[var(--border)] pt-3">
            <WorkSessionPanel userId={member.id} fullName={member.name} onSettled={() => setDebtKey((key) => key + 1)} />
          </div>
        </div>
      ) : null}
      {tab === 'LEAVE' ? <LeavePanel userId={member.id} /> : null}

      {tab === 'ADVANCE' || tab === 'TIPS' ? (
        <div className="flex flex-wrap gap-2">
          {recentPeriods('MONTHLY').map((item) => (
            <Button
              key={item.key}
              variant={moneyPeriod === item.key ? 'selected' : 'secondary'}
              className="min-h-12 text-sm tabular-nums"
              onClick={() => {
                setMoneyPeriod(item.key);
                setEditingAdvance(null);
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
      ) : null}

      {tab === 'ADVANCE' ? (
        <div className="space-y-3">
          <AdvanceForm
            key={`${editingAdvance?.id ?? 'new'}-${moneyPeriod}`}
            userId={member.id}
            period={moneyPeriod}
            editing={editingAdvance}
            onCancelEdit={() => setEditingAdvance(null)}
            onSaved={() => {
              setEditingAdvance(null);
              void loadMoney().catch((caught) => setError(errorText(caught)));
            }} />
          {money && money.advances.length > 0 ? (
            <ul className="grid gap-2 md:grid-cols-2">
              {money.advances.map((advance) => (
                <li key={advance.id}>
                  <RecordCard title={METHOD_LABEL[advance.paymentMethod] ?? advance.paymentMethod}
                    description={formatInstantDay(advance.createdAt)} value={formatMoney(advance.amountCents)}
                    onOpen={() => setSelectedAdvance(advance)} />
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-[var(--text-secondary)]">{moneyPeriod} döneminde avans yok.</p>}
        </div>
      ) : null}

      {selectedAdvance ? (
        <Modal cardFlow isOpen title="Avans Detayı" subtitle={formatInstantDay(selectedAdvance.createdAt)}
          maxWidth="sm" onClose={() => setSelectedAdvance(null)}>
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3">
              <Fact label="Ödeme Şekli" value={METHOD_LABEL[selectedAdvance.paymentMethod] ?? selectedAdvance.paymentMethod} />
              <Fact label="Tutar" value={formatMoney(selectedAdvance.amountCents)} />
            </dl>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => { setEditingAdvance(selectedAdvance); setSelectedAdvance(null); }}>Düzenle</Button>
              {isOwner ? <Button type="button" variant="danger" onClick={() => { setDeletingAdvance(selectedAdvance); setSelectedAdvance(null); }}>Sil</Button> : null}
            </div>
          </div>
        </Modal>
      ) : null}

      {deletingAdvance ? (
        <ConfirmDialog cardFlow
          title="Avans silinsin mi?"
          message={formatMoney(deletingAdvance.amountCents)}
          onConfirm={async () => {
            const { actorId, actorRole, tenantId } = sessionArgs();
            await invokeIPC('void_expense', { expenseId: deletingAdvance.expenseId, reason: 'Avans silindi', actorId, actorRole, tenantId });
            await loadMoney();
          }}
          onClose={() => setDeletingAdvance(null)}
        />
      ) : null}

      {tab === 'SALARY' ? <RuleEditor userId={member.id} rules={rules} onSaved={loadRules} /> : null}

      {tab === 'DEBT' ? <StaffDebtPanel userId={member.id} refreshKey={debtKey} /> : null}

      {tab === 'TIPS' ? <Fact label={`${moneyPeriod} dağıtılan bahşiş`} value={money ? formatMoney(money.tipCents) : '-'} /> : null}
    </section>
  );
};
