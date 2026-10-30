import React, { useEffect, useState } from 'react';
import { useCariStore } from '../../stores/cariStore';
import { errorText, newOperationId, parseCents } from '../../lib/cariInput';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import type { DirectoryContact, DirectoryType } from '../../types/ledger';

interface CariCardModalProps {
  isOpen: boolean;
  directoryType: DirectoryType;
  onClose: () => void;
  onCreated: (card: DirectoryContact) => void;
}

export const CariCardModal: React.FC<CariCardModalProps> = ({
  isOpen,
  directoryType,
  onClose,
  onCreated,
}) => {
  const { findSimilar, createCard } = useCariStore();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [taxNo, setTaxNo] = useState('');
  const [limit, setLimit] = useState('');
  const [similar, setSimilar] = useState<DirectoryContact[]>([]);
  const [operationId, setOperationId] = useState(newOperationId);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setPhone('');
    setTaxNo('');
    setLimit('');
    setSimilar([]);
    setError(null);
    setOperationId(newOperationId());
  }, [isOpen]);

  const save = async (allowSimilar: boolean) => {
    const creditLimitCents = limit.trim() ? parseCents(limit) : undefined;
    if (creditLimitCents === null) {
      setError('Cari limiti geçerli bir tutar olmalıdır.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const trimmedPhone = phone.trim() || undefined;
      if (!allowSimilar) {
        const matches = await findSimilar(directoryType, name.trim(), trimmedPhone);
        if (matches.length > 0) {
          setSimilar(matches);
          return;
        }
      }
      const card = await createCard(
        {
          name: name.trim(),
          type: directoryType,
          phone: trimmedPhone,
          taxNo: taxNo.trim() || undefined,
          creditLimitCents,
        },
        operationId,
        allowSimilar
      );
      onCreated(card);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void save(false);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={directoryType === 'SUPPLIER' ? 'Yeni Tedarikçi Kartı' : 'Yeni Müşteri Kartı'}
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="cari-name" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
            Ad / Ünvan
          </label>
          <Input
            id="cari-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSimilar([]);
            }}
            maxLength={120}
            required
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="cari-phone" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Telefon
            </label>
            <Input
              id="cari-phone"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setSimilar([]);
              }}
            />
          </div>
          <div>
            <label htmlFor="cari-tax" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Vergi No
            </label>
            <Input id="cari-tax" value={taxNo} onChange={(event) => setTaxNo(event.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="cari-limit" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
            Cari Limiti (₺)
          </label>
          <Input
            id="cari-limit"
            inputMode="decimal"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            className="tabular-nums"
          />
        </div>

        {similar.length > 0 ? (
          <div
            role="alert"
            className="p-3 rounded-lg bg-[var(--accent-amber-soft)] border border-[var(--accent-amber-border)] text-xs space-y-1.5"
          >
            <p className="font-bold text-[var(--accent-amber)]">Benzer kayıt var. Kayıtlar birleştirilmez.</p>
            <ul className="space-y-1 text-[var(--text-primary)]">
              {similar.map((card) => (
                <li key={card.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {card.name}
                    {card.phone ? ` · ${card.phone}` : ''}
                  </span>
                  <span className="tabular-nums shrink-0">{formatMoney(card.balanceCents)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1 min-h-12">
            Vazgeç
          </Button>
          {similar.length > 0 ? (
            <Button
              type="button"
              variant="outline-amber"
              isLoading={isSaving}
              onClick={() => void save(true)}
              className="flex-1 min-h-12"
            >
              Yine de Yeni Kart Aç
            </Button>
          ) : (
            <Button type="submit" variant="primary" isLoading={isSaving} className="flex-1 min-h-12">
              Kaydet
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
};
