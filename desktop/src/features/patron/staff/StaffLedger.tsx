import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { invokeIPC } from '../../../services/tauriClient';
import { useAuthStore } from '../../../stores/authStore';
import { sessionArgs } from '../../../stores/cariStore';
import { useLedgerStore } from '../../../stores/ledgerStore';
import { foldText } from '../../../lib/searchText';
import { Input } from '../../../ui/Input';
import { Button } from '../../../ui/Button';
import { LeavePanel } from '../payroll/LeavePanel';
import { PayrollPanel } from '../payroll/PayrollPanel';
import { RecordCard } from '../RecordCard';
import { SectionTabs, type SectionTab } from '../SectionTabs';
import { ROLE_LABEL, StaffFormModal, type StaffMember } from '../StaffFormModal';
import { TipPoolPanel } from '../TipPoolPanel';
import { StaffCard, type ProfileRow } from './StaffCard';

type LedgerSection = 'PEOPLE' | 'PAYROLL' | 'TIPS' | 'LEAVE_REQUESTS';

const SECTIONS: SectionTab<LedgerSection>[] = [
  { id: 'PEOPLE', label: 'Kişiler' },
  { id: 'PAYROLL', label: 'Bordro' },
  { id: 'LEAVE_REQUESTS', label: 'İzin Onayları' },
  { id: 'TIPS', label: 'Bahşiş Havuzu' },
];

/** Personel ve bordro tek defter. Pasif personel listede kalır: geçmiş kayıtlar ona bağlıdır. */
export const StaffLedger: React.FC = () => {
  const role = useAuthStore((state) => state.user?.role);
  const isOwner = role === 'OWNER';
  const canViewPayroll = isOwner || role === 'MANAGER';
  const erpSection = useLedgerStore((state) => state.erpSection);
  const [section, setSection] = useState<LedgerSection>('PEOPLE');
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [search, setSearch] = useState('');
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
      // Patron işletmenin sahibidir; maaş, izin ve avans kaydı tutulan personel değildir.
      setStaff(rows.filter((member) => member.role !== 'OWNER' && member.role !== 'MASTER'));
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
    if (erpSection === 'LEAVE_REQUESTS') setSection('LEAVE_REQUESTS');
  }, [erpSection]);

  const selected = staff?.find((member) => member.id === selectedId) ?? null;
  const query = foldText(search);
  const visible = staff?.filter((member) => foldText(member.name).includes(query) || (profiles[member.id]?.phone ?? '').includes(query)) ?? [];
  const active = staff?.filter((member) => member.is_active) ?? [];
  const editingProfile = editing && editing !== 'NEW' ? profiles[editing.id] : undefined;

  return (
    <div className="space-y-4">
      <SectionTabs
        label="Personel Defteri"
        tabs={SECTIONS}
        active={section}
        onChange={setSection}
      />

      {error ? <><p className="text-sm text-[var(--text-secondary)]">Personel okunamadı.</p><ErrorToast message={`Personel okunamadı: ${error}`} /></> : null}

      {section === 'PEOPLE' ? (
        selected ? (
          <div className="space-y-3">
            <Button variant="ghost" onClick={() => setSelectedId(null)}>Personel Listesine Dön</Button>
            <StaffCard key={selected.id} member={selected} profile={profiles[selected.id]}
              isOwner={isOwner} canViewPayroll={canViewPayroll} onEdit={() => setEditing(selected)} onChanged={load} />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input type="search" aria-label="Personel ara"
                className="min-w-40 flex-1" value={search} onChange={(event) => setSearch(event.target.value)} />
              <Button variant="primary" onClick={() => setEditing('NEW')}>Personel Ekle</Button>
            </div>
            {staff === null && !error ? <p role="status">Personel yükleniyor.</p> : null}
            {staff && visible.length === 0 ? <p>{search.trim() ? 'Eşleşen personel yok.' : 'Henüz personel yok.'}</p> : null}
            {visible.length > 0 ? <ul className="grid gap-2 md:grid-cols-2">
              {visible.map((member) => (
                <li key={member.id}>
                  <RecordCard title={member.name}
                    description={`${ROLE_LABEL[member.role] ?? member.role}${member.is_active ? '' : ' · Pasif'}`}
                    onOpen={() => setSelectedId(member.id)} />
                </li>
              ))}
            </ul> : null}
          </div>
        )
      ) : null}

      {section === 'LEAVE_REQUESTS' ? <LeavePanel staff={staff ?? []} /> : null}

      {section === 'PAYROLL' && canViewPayroll ? <PayrollPanel /> : null}

      {section === 'TIPS' ? <TipPoolPanel canDistribute={role === 'OWNER'} staff={active} /> : null}

      {editing ? (
        <StaffFormModal
          member={editing === 'NEW' ? null : editing}
          profile={editingProfile}
          canSetSalary={role === 'OWNER'}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
};
