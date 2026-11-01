import React, { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';

export const MustChangePinModal: React.FC = () => {
  const { mustChangePin, changeSelfPin, logout } = useAuthStore();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!mustChangePin) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(newPin)) {
      setError('Yeni PIN 4-8 haneli sayı olmalıdır.');
      return;
    }
    if (/^(\d)\1+$/.test(newPin)) {
      setError('Yeni PIN aynı rakamın tekrarı olamaz.');
      return;
    }

    setIsSubmitting(true);
    const success = await changeSelfPin(currentPin, newPin);
    setIsSubmitting(false);

    if (!success) {
      setError('PIN güncellenemedi. Mevcut PIN kodunu kontrol edin.');
    }
  };

  return (
    <Modal
      isOpen={mustChangePin}
      onClose={logout}
      title="Yeni PIN Belirleyin"
      subtitle="İlk girişiniz olduğu için fabrika PIN kodunuzu kendi belirlediğiniz PIN ile değiştirin."
      showCloseButton={false}
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <div className="p-2.5 rounded-lg text-xs font-medium text-center bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)]">
            {error}
          </div>
        ) : null}

        <div>
          <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
            Mevcut PIN
          </label>
          <Input
            type="password"
            maxLength={8}
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value)}
            className="text-center tabular-nums font-bold tracking-widest text-base"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
            Yeni PIN (4-8 hane)
          </label>
          <Input
            type="password"
            maxLength={8}
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            className="text-center tabular-nums font-bold tracking-widest text-base"
            required
            autoFocus
          />
        </div>

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={logout} className="flex-1">
            Çıkış Yap
          </Button>
          <Button type="submit" variant="primary" className="flex-1" isLoading={isSubmitting}>
            Kaydet ve Başla
          </Button>
        </div>
      </form>
    </Modal>
  );
};
