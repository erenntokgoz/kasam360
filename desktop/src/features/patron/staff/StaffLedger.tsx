import React, { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { invokeIPC } from '../../../services/tauriClient';
import { useAuthStore } from '../../../stores/authStore';
import { sessionArgs } from '../../../stores/cariStore';
import { useLedgerStore } from '../../../stores/ledgerStore';
import { BarAction } from '../../../ui/Bar';
import { PayrollPanel } from '../payroll/PayrollPanel';
import { SectionTabs, type SectionTab } from '../SectionTabs';
import { ROLE_LABEL, StaffFormModal, type StaffMember } from '../StaffFormModal';
import { TipPoolPanel } from '../TipPoolPanel';
import { StaffCard, type ProfileRow } from './StaffCard';

type LedgerSection = 'PEOPLE' | 'PAYROLL' | 'TIPS';

const SECTIONS: SectionTab<LedgerSection>[] = [
  { id: 'PEOPLE', label: 'Kişiler' },
  { id: 'PAYROLL', label: 'Bordro' },
  { id: 'TIPS', label: 'Bahşiş Havuzu' },
];

/** Personel ve bordro tek defter. Pasif personel listede kalır: geçmiş kayıtlar ona bağlıdır. */
export const StaffLedger: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const erpSection = useLedgerStore((state) => state.erpSection);
  const [section, setSection] = useState<LedgerSection>('PEOPLE');
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffMember | 'NEW' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      const [rows, details] = await Promise.all([
        invokeIPC<StaffMember[]>('get_staff', { actorRole, tenantId, includeInactive: true }),
        invokeIPC<ProfileRow[]>('list_staff_profiles', { actorRole, tenantId }),
      ]);
      setStaff(rows);
      setProfiles(Object.fromEntries(details.map((profile) => [profile.userId, profile])));
      setError(null);
    } catch (caught) {
      setStaff(null);
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (erpSection === 'PAYROLL') setSection('PAYROLL');
  }, [erpSection]);

  // Sağ taraf boş bir kutu olarak kalmasın: seçim yoksa ilk kişi açık gelir.
  const selected = staff?.find((member) => member.id === selectedId) ?? staff?.[0] ?? null;
  const active = staff?.filter((member) => member.is_active) ?? [];
  const editingProfile = editing && editing !== 'NEW' ? profiles[editing.id] : undefined;

  return (
    <div className="space-y-4">
      <SectionTabs
        label="Personel Defteri"
        tabs={SECTIONS}
        active={section}
        onChange={setSection}
        actions={<BarAction tone="primary" onClick={() => setEditing('NEW')}>Personel Ekle</BarAction>}
      />

      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">Personel okunamadı: {error}</p> : null}

      {section === 'PEOPLE' ? (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          <ul className="paper border border-[var(--border)] rounded-xl divide-y divide-[var(--border)] self-start">
            {(staff ?? []).map((member) => (
              <li key={member.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(member.id)}
                  aria-current={member.id === selected?.id}
                  className={`w-full min-h-12 px-4 py-2 text-left cursor-pointer ${member.id === selected?.id ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'} ${member.is_active ? '' : 'opacity-60'}`}
                >
                  <span className="block text-sm font-bold text-[var(--text-primary)] truncate">{member.name}</span>
                  <span className="block text-xs text-[var(--text-secondary)]">
                    {ROLE_LABEL[member.role] ?? member.role}{member.is_active ? '' : ' · Pasif'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected ? (
            <StaffCard
              key={selected.id}
              member={selected}
              profile={profiles[selected.id]}
              isOwner={isOwner}
              onEdit={() => setEditing(selected)}
              onChanged={load}
            />
          ) : (
            <p className="p-6 text-center text-xs text-[var(--text-muted)] paper border border-[var(--border)] rounded-xl">
              Henüz personel yok. Personel Ekle ile başlayın.
            </p>
          )}
        </div>
      ) : null}

      {section === 'PAYROLL' ? <PayrollPanel /> : null}

      {section === 'TIPS' ? <TipPoolPanel canDistribute={isOwner} staff={active} /> : null}

      {editing ? (
        <StaffFormModal
          member={editing === 'NEW' ? null : editing}
          phone={editingProfile?.phone ?? ''}
          salaryCents={editingProfile?.baseSalaryCents ?? null}
          canSetSalary={isOwner}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setSelectedId(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
};
