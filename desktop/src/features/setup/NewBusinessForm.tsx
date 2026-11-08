import { ErrorToast } from '../../ui/ErrorToast';
import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { useSetupStore, type SetupDraft } from '../../stores/setupStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Numpad } from '../../ui/Numpad';

const FIELDS: { key: keyof SetupDraft; label: string; required?: boolean }[] = [
  { key: 'businessName', label: 'İşletme Adı', required: true },
  { key: 'ownerName', label: 'İşletme Sahibi Adı Soyadı', required: true },
  { key: 'email', label: 'E-posta', required: true },
  { key: 'taxId', label: 'Vergi Numarası' },
  { key: 'phone', label: 'Telefon' },
  { key: 'address', label: 'Adres' },
];

const PIN_MAX = 8;
const PIN_MIN = 4;
const PASSWORD_MIN = 8;

interface NewBusinessFormProps {
  onBack: () => void;
  /** Sitede doğrulanan şifre; aynı şifre bu cihazda da geçerli olur. */
  verifiedPassword?: string;
}

export const NewBusinessForm: React.FC<NewBusinessFormProps> = ({ onBack, verifiedPassword }) => {
  const { draft, saveProgress, completeNew } = useSetupStore();
  const [form, setForm] = useState<SetupDraft>(draft);
  const [step, setStep] = useState<'INFO' | 'PIN' | 'CONFIRM'>('INFO');
  // Şifre taslağa yazılmaz: yarım kalan kurulum diskte sır bırakmaz.
  const [typedPassword, setPassword] = useState('');
  // Form, hesap doğrulaması bitmeden bir an önce açılabilir; ilk değeri kopyalamak alanı gizleyip
  // şifreyi boş bırakıyordu. Doğrulanmış şifre geldiği an doğrudan o kullanılır.
  const password = verifiedPassword ?? typedPassword;
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const ready =
    form.businessName.trim().length >= 2 &&
    form.ownerName.trim().length >= 2 &&
    form.email.includes('@') &&
    password.length >= PASSWORD_MIN;
  const entry = step === 'PIN' ? pin : pinConfirm;
  const setEntry = step === 'PIN' ? setPin : setPinConfirm;

  const goToPin = async () => {
    setError(null);
    setOperationError(null);
    try {
      await saveProgress('NEW', form);
      setStep('PIN');
    } catch (caught) {
      setOperationError(errorText(caught));
    }
  };

  const finish = async () => {
    if (pin !== pinConfirm) {
      setError('PIN ve tekrarı aynı değil. Yeniden belirleyin.');
      setPin('');
      setPinConfirm('');
      setStep('PIN');
      return;
    }
    setIsBusy(true);
    setError(null);
    setOperationError(null);
    try {
      await completeNew(form, password, pin, pinConfirm);
    } catch (caught) {
      setOperationError(errorText(caught));
      setPin('');
      setPinConfirm('');
      setStep('PIN');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <ErrorToast message={operationError} />
      {error ? (
        <div role="alert" className="p-3 rounded-lg text-xs font-medium border bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red-border)] flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {step === 'INFO' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map(({ key, label, required }) => (
              <div key={key}>
                <label htmlFor={`setup-${key}`} className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
                  {label}
                  {required ? ' *' : ''}
                </label>
                <Input
                  id={`setup-${key}`}
                  className="min-h-12"
                  value={form[key]}
                  onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                  maxLength={key === 'address' ? 300 : 120}
                />
              </div>
            ))}
            {verifiedPassword ? null : (
              <div>
                <label htmlFor="setup-password" className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
                  Şifre (en az {PASSWORD_MIN} karakter) *
                </label>
                <Input id="setup-password" type="password" className="min-h-12" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" className="min-h-12" onClick={onBack}>
              Geri
            </Button>
            <Button type="button" variant="primary" className="min-h-12" disabled={!ready} onClick={() => void goToPin()}>
              PIN Belirle
            </Button>
          </div>
        </>
      ) : (
        <div className="w-full max-w-[320px] mx-auto flex flex-col gap-4">
          <div className="text-center">
            <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">
              {step === 'PIN' ? 'Sahip PIN kodunu belirleyin' : 'PIN kodunu tekrar girin'}
            </h2>
          </div>
          <div aria-label="Girilen hane sayısı" className="h-12 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] flex items-center justify-center text-xl font-bold tracking-[0.4em] text-[var(--text-primary)]">
            {'•'.repeat(entry.length)}
          </div>
          <Numpad
            onDigit={(digit) => {
              if (entry.length < PIN_MAX) setEntry(entry + digit);
            }}
            onClear={() => setEntry('')}
            onBackspace={() => setEntry(entry.slice(0, -1))}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-12"
              onClick={() => {
                setPin('');
                setPinConfirm('');
                setStep('INFO');
              }}
            >
              Geri
            </Button>
            {step === 'PIN' ? (
              <Button type="button" variant="primary" className="min-h-12" disabled={pin.length < PIN_MIN} onClick={() => setStep('CONFIRM')}>
                Devam
              </Button>
            ) : (
              <Button type="button" variant="primary" className="min-h-12" disabled={pinConfirm.length < PIN_MIN} isLoading={isBusy} onClick={() => void finish()}>
                Kurulumu Tamamla
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
