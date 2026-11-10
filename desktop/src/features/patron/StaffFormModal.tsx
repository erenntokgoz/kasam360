import { ErrorToast } from '../../ui/ErrorToast';
import { capitalizeRecordName } from '../../lib/recordName';
import React, { useEffect, useState } from 'react';
import { NumberInput } from '../../ui/NumberInput';
import { errorText, localDate } from '../../lib/cariInput';
import { parseCents } from '../../lib/moneyInput';
import { PAY_PERIODS, amountLabelOf, type PayPeriod } from '../../lib/payPeriod';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import type { PayrollRule } from './payroll/RuleEditor';

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  is_active: boolean;
  can_approve: boolean;
}

export const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Patron',
  MANAGER: 'Müdür',
  CASHIER: 'Kasiyer',
  WAITER: 'Garson',
  KITCHEN: 'Mutfak',
};

const ROLES = ['MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'];

export interface StaffProfile {
  baseSalaryCents: number | null;
  phone: string | null;
  birthDate: string | null;
  hireDate: string | null;
  nationalId: string | null;
  address: string | null;
  emergencyContact: string | null;
  notes: string | null;
}

interface StaffFormModalProps {
  member: StaffMember | null;
  profile: StaffProfile | undefined;
  canSetSalary: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Yeni personelde PIN zorunludur; düzenlemede boş bırakılırsa PIN değişmez. */
/** T.C. kimlik numarası resmi denetim haneleriyle doğrulanır. */
function isValidTcKimlik(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = value.split('').map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  const eleventh = d.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10;
  return d[9] === tenth && d[10] === eleventh;
}

export const StaffFormModal: React.FC<StaffFormModalProps> = ({
  member,
  profile,
  canSetSalary,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState(member?.name ?? '');
  const [role, setRole] = useState(member?.role ?? 'WAITER');
  const [isActive, setIsActive] = useState(member?.is_active ?? true);
  const [pin, setPin] = useState('');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [salary, setSalary] = useState(profile?.baseSalaryCents == null ? '' : (profile.baseSalaryCents / 100).toFixed(2).replace('.', ','));
  const [hireDate, setHireDate] = useState(() => profile?.hireDate || localDate(new Date()));
  const [nationalId, setNationalId] = useState(profile?.nationalId ?? '');
  const [address, setAddress] = useState(profile?.address ?? '');
  const [emergency, setEmergency] = useState(profile?.emergencyContact ?? '');
  const [error, setError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [rule, setRule] = useState<PayrollRule | null>(null);
  const [payPeriod, setPayPeriod] = useState<PayPeriod>('MONTHLY');

  useEffect(() => {
    if (!member || !canSetSalary) return;
    const { actorRole, tenantId } = sessionArgs();
    invokeIPC<PayrollRule[]>('get_payroll_rules', { tenantId, actorRole })
      .then((rules) => {
        const found = rules.find((item) => item.userId === member.id) ?? null;
        setRule(found);
        if (found) setPayPeriod(found.payPeriod);
      })
      .catch((caught) => setOperationError(errorText(caught)));
  }, [member, canSetSalary]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const baseSalaryCents = salary.trim() ? parseCents(salary) : null;
    if (salary.trim() && baseSalaryCents === null) {
      setError('Maaşı rakamla girin.');
      return;
    }
    if (!member && !/^\d{4,8}$/.test(pin)) {
      setError('PIN 4-8 haneli olmalıdır.');
      return;
    }
    // Eksik ya da uydurma kimlik numarası bordro ve SGK bildiriminde geri döner.
    if (nationalId && !isValidTcKimlik(nationalId)) {
      setError('T.C. kimlik no 11 haneli ve geçerli olmalıdır.');
      return;
    }
    setIsBusy(true);
    setError(null);
    setOperationError(null);
    try {
      const { actorId, actorRole, tenantId } = sessionArgs();
      const created = member
        ? null
        : await invokeIPC<{ id: string }>('create_staff_member', { actorRole, actorId, tenantId, name: name.trim(), role, pin });
      const userId = member?.id ?? created!.id;
      if (member) {
        await invokeIPC('update_staff_member', {
          actorRole,
          actorId,
          tenantId,
          staffId: member.id,
          name: name.trim(),
          role,
          isActive,
        });
        if (pin) {
          await invokeIPC('reset_staff_pin', { actorRole, actorId, tenantId, staffId: member.id, newPin: pin });
        }
      }
      await invokeIPC('save_staff_profile', {
        actorRole,
        actorId,
        tenantId,
        input: {
          userId,
          fullName: name.trim(),
          baseSalaryCents: canSetSalary ? baseSalaryCents : undefined,
          phone: phone.trim() || null,
          birthDate: profile?.birthDate ?? null,
          hireDate: hireDate || null,
          nationalId: canSetSalary ? nationalId || null : null,
          address: canSetSalary ? address.trim() || null : null,
          emergencyContact: canSetSalary ? emergency.trim() || null : null,
          notes: profile?.notes ?? null,
        },
      });
      // Bordro kuraldan hesaplanır: kayıttaki tutar ve dönem aynı anda kurala yazılır.
      if (canSetSalary && baseSalaryCents !== null) {
        const isHourly = rule?.model === 'HOURLY';
        await invokeIPC('set_payroll_rule', {
          tenantId,
          actorId,
          actorRole,
          input: {
            userId,
            model: rule?.model ?? 'FIXED',
            baseSalaryCents: isHourly ? 0 : baseSalaryCents,
            hourlyRateCents: rule?.hourlyRateCents ?? 0,
            tipMultiplierPercent: rule?.tipMultiplierPercent ?? 100,
            payPeriod,
          },
        });
      }
      onSaved();
    } catch (caught) {
      setOperationError(errorText(caught));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <>
      <Modal cardFlow isOpen={!askDelete} onClose={() => { if (!isBusy) onClose(); }} title={member ? 'Personeli Düzenle' : 'Personel Ekle'} maxWidth="2xl">
        <form onSubmit={(event) => void save(event)} className="space-y-4">
          <fieldset disabled={isBusy} className="rounded-lg border border-[var(--border)] px-3 pb-3 space-y-3">
            <legend className="px-1 text-sm font-bold">Kimlik ve Yetki</legend>
            <label className="block text-xs font-semibold text-[var(--text-secondary)]">
              Ad Soyad
              <Input id="staff-name" className="min-h-12 mt-1" value={name} onBlur={(event) => setName(capitalizeRecordName(event.currentTarget.value))} onChange={(event) => setName(event.target.value)} required />
            </label>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Personel rolü">
              {ROLES.map((option) => (
                <Button key={option} type="button" aria-pressed={role === option} variant={role === option ? 'selected' : 'secondary'} className="min-h-12" onClick={() => setRole(option)}>
                  {ROLE_LABEL[option]}
                </Button>
              ))}
            </div>
          </fieldset>
          <fieldset disabled={isBusy} className="rounded-lg border border-[var(--border)] px-3 pb-3 grid gap-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-bold">Personel Bilgileri</legend>
            <label className="block text-xs font-semibold text-[var(--text-secondary)]">
              {member ? 'Yeni PIN (değişmeyecekse boş)' : 'PIN (4-8 hane)'}
              <NumberInput kind="digits" id="staff-pin" type="password" className="min-h-12 mt-1" value={pin} onValueChange={setPin} />
            </label>
            <label className="block text-xs font-semibold text-[var(--text-secondary)]">
              Telefon
              <NumberInput id="staff-phone" kind="digits" maxLength={15} className="mt-1" value={phone} onValueChange={setPhone} />
            </label>
            <label className="block text-xs font-semibold text-[var(--text-secondary)]">
              İşe Giriş
              <Input id="staff-hire" type="date" className="min-h-12 mt-1" value={hireDate} onChange={(event) => setHireDate(event.target.value)} />
            </label>
            {canSetSalary ? (
              <>
                <div className="sm:col-span-2">
                  <span className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">Hakediş</span>
                  <div className="grid grid-cols-3 gap-2">
                    {PAY_PERIODS.map((item) => (
                      <Button key={item.id} type="button" aria-pressed={payPeriod === item.id} variant={payPeriod === item.id ? 'selected' : 'secondary'} className="min-h-12" onClick={() => setPayPeriod(item.id)}>
                        {item.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)]">
                  {amountLabelOf(payPeriod)} (₺)
                  <NumberInput id="staff-salary" className="min-h-12 mt-1" value={salary} onValueChange={setSalary} />
                </label>
                <label className="block text-xs font-semibold text-[var(--text-secondary)]">
                  T.C. Kimlik No
                  <NumberInput id="staff-national-id" kind="digits" maxLength={11} className="mt-1" value={nationalId} onValueChange={setNationalId} />
                </label>
                <label className="block text-xs font-semibold text-[var(--text-secondary)]">
                  Acil Durum Kişisi
                  <Input id="staff-emergency" className="min-h-12 mt-1" value={emergency} onChange={(event) => setEmergency(event.target.value)} />
                </label>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] sm:col-span-2">
                  Adres
                  <Input id="staff-address" className="min-h-12 mt-1" value={address} onChange={(event) => setAddress(event.target.value)} />
                </label>
              </>
            ) : null}
          </fieldset>
          {member ? (
            <label className="flex items-center gap-3 min-h-12 text-sm text-[var(--text-primary)] cursor-pointer">
              <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
              <span>Çalışıyor (kapatılırsa giriş yapamaz)</span>
            </label>
          ) : null}
          <ErrorToast message={operationError} />
          {error ? (
            <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {member ? (
              <Button type="button" variant="danger" disabled={isBusy} className="mr-auto" onClick={() => setAskDelete(true)}>
                Personeli Sil
              </Button>
            ) : null}
            <Button type="button" disabled={isBusy} onClick={onClose}>Vazgeç</Button>
            <Button type="submit" variant="primary" isLoading={isBusy}>Kaydet</Button>
          </div>
        </form>
      </Modal>
      {member && askDelete ? (
        <ConfirmDialog cardFlow
          title={`${member.name} silinsin mi?`}
          message="Giriş yapamaz. Geçmiş kayıtları raporlarda kalır."
          onConfirm={async () => {
            const { actorId, actorRole, tenantId } = sessionArgs();
            await invokeIPC('delete_staff_member', { actorRole, actorId, tenantId, staffId: member.id });
            onSaved();
          }}
          onClose={() => setAskDelete(false)}
        />
      ) : null}
    </>
  );
};
