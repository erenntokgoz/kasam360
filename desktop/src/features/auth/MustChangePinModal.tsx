import React, { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';

export const MustChangePinModal: React.FC = () => {
  const { mustChangePin, changeSelfPin, logout } = useAuthStore();
  const [currentPin, setCurrentPin] = useState('1111');
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!mustChangePin) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      setError('Yeni PIN tam olarak 4 haneli sayı olmalıdır.');
      return;
    }
    if (newPin === '1111') {
      setError('Yeni PIN fabrika varsayılanı (1111) ile aynı olamaz.');
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
      subtitle="İlk girişiniz olduğu için fabrika PIN kodunuzu 4 haneli yeni şifrenizle değiştirin."
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
            maxLength={4}
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value)}
            className="text-center font-mono font-bold tracking-widest text-base"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
            Yeni 4 Haneli PIN
          </label>
          <Input
            type="password"
            maxLength={4}
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            placeholder="Örn: 7890"
            className="text-center font-mono font-bold tracking-widest text-base"
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
