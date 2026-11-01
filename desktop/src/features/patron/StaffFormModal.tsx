import React, { useState } from 'react';
import { NumberInput } from '../../ui/NumberInput';
import { errorText } from '../../lib/cariInput';
import { parseCents } from '../../lib/moneyInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';

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

interface StaffFormModalProps {
  member: StaffMember | null;
  phone: string;
  salaryCents: number | null;
  canSetSalary: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Yeni personelde PIN zorunludur; düzenlemede boş bırakılırsa PIN değişmez. */
export const StaffFormModal: React.FC<StaffFormModalProps> = ({
  member,
  phone: initialPhone,
  salaryCents,
  canSetSalary,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState(member?.name ?? '');
  const [role, setRole] = useState(member?.role ?? 'WAITER');
  const [isActive, setIsActive] = useState(member?.is_active ?? true);
  const [pin, setPin] = useState('');
  const [phone, setPhone] = useState(initialPhone);
  const [salary, setSalary] = useState(salaryCents === null ? '' : (salaryCents / 100).toFixed(2).replace('.', ','));
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [askDelete, setAskDelete] = useState(false);

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
    setIsBusy(true);
    setError(null);
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
          phone: phone.trim() || undefined,
        },
      });
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={member ? 'Personeli Düzenle' : 'Personel Ekle'} maxWidth="sm">
      <form onSubmit={(event) => void save(event)} className="space-y-3">
        <label className="block text-xs font-semibold text-[var(--text-secondary)]">
          Ad Soyad
          <Input id="staff-name" className="min-h-12 mt-1" value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <div className="grid grid-cols-2 gap-2">
          {ROLES.map((option) => (
            <Button key={option} type="button" variant={role === option ? 'selected' : 'secondary'} className="min-h-12" onClick={() => setRole(option)}>
              {ROLE_LABEL[option]}
            </Button>
          ))}
        </div>
        <label className="block text-xs font-semibold text-[var(--text-secondary)]">
          {member ? 'Yeni PIN (değişmeyecekse boş)' : 'PIN (4-8 hane)'}
          <NumberInput kind="digits" id="staff-pin" type="password" className="min-h-12 mt-1" value={pin} onValueChange={setPin} />
        </label>
        <label className="block text-xs font-semibold text-[var(--text-secondary)]">
          Telefon
          <NumberInput id="staff-phone" kind="digits" maxLength={15} className="mt-1" value={phone} onValueChange={setPhone} />
        </label>
        {canSetSalary ? (
          <label className="block text-xs font-semibold text-[var(--text-secondary)]">
            Aylık Maaş (₺)
            <NumberInput id="staff-salary" className="min-h-12 mt-1" value={salary} onValueChange={setSalary} />
          </label>
        ) : null}
        {member ? (
          <label className="flex items-center gap-3 min-h-12 text-sm text-[var(--text-primary)] cursor-pointer">
            <input type="checkbox" className="w-6 h-6" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            <span>Çalışıyor (kapatılırsa giriş yapamaz)</span>
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" className="w-full min-h-12" isLoading={isBusy}>
          Kaydet
        </Button>
        {member ? (
          <Button type="button" variant="danger" className="w-full min-h-12" onClick={() => setAskDelete(true)}>
            Personeli Sil
          </Button>
        ) : null}
      </form>
      {member && askDelete ? (
        <ConfirmDialog
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
    </Modal>
  );
};
