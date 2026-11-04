import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { errorText, localDate } from '../../../lib/cariInput';
import { formatDay } from '../../../lib/date';
import { formatMoney } from '../../../lib/formatMoney';
import { formatNumber } from '../../../lib/numberText';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
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
  advances: { id: string; expenseId: string; amountCents: number; createdAt: string }[];
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
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [money, setMoney] = useState<MoneySummary | null>(null);
  const [rules, setRules] = useState<PayrollRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deletingAdvance, setDeletingAdvance] = useState<MoneySummary['advances'][number] | null>(null);
  const [editingAdvance, setEditingAdvance] = useState<MoneySummary['advances'][number] | null>(null);

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
    ...(isOwner
      ? ([
          { id: 'ADVANCE', label: 'Avans' },
          { id: 'SALARY', label: 'Maaş' },
          { id: 'TIPS', label: 'Bahşiş' },
        ] as SectionTab<CardTab>[])
      : []),
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

      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}

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

      {tab === 'SHIFTS' ? <ShiftPlanPanel userId={member.id} /> : null}
      {tab === 'LEAVE' ? <LeavePanel userId={member.id} /> : null}

      {tab === 'ADVANCE' ? (
        <div className="space-y-3">
          <AdvanceForm
            key={editingAdvance?.id ?? 'new'}
            userId={member.id}
            period={month()}
            editing={editingAdvance}
            onCancelEdit={() => setEditingAdvance(null)}
            onSaved={() => {
              setEditingAdvance(null);
              void loadMoney().catch((caught) => setError(errorText(caught)));
            }} />
          {money && money.advances.length > 0 ? (
            <ul className="text-sm divide-y divide-[var(--border)]">
              {money.advances.map((advance) => (
                <li key={advance.id} className="flex items-center gap-3 py-2">
                  <span className="flex-1 text-[var(--text-secondary)]">{formatDay(advance.createdAt)}</span>
                  <span className="font-bold tabular-nums">{formatMoney(advance.amountCents)}</span>
                  <Button variant="ghost" aria-label="Avansı düzenle" onClick={() => setEditingAdvance(advance)}>
                    <Pencil className="w-5 h-5" />
                  </Button>
                  <Button variant="ghost" aria-label="Avansı sil" onClick={() => setDeletingAdvance(advance)}>
                    <Trash2 className="w-5 h-5" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-[var(--text-secondary)]">Bu ay avans yok.</p>}
        </div>
      ) : null}

      {deletingAdvance ? (
        <ConfirmDialog
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

      {tab === 'TIPS' ? <Fact label="Bu ay dağıtılan bahşiş" value={money ? formatMoney(money.tipCents) : '-'} /> : null}
    </section>
  );
};
