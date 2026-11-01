import React, { useEffect, useState } from 'react';
import { groupNumber, toRawNumber, type NumberKind } from '../lib/numberText';
import { Button } from './Button';
import { Modal } from './Modal';
import { Numpad } from './Numpad';

export interface PinpadInfo {
  label: string;
  value: string;
}

export interface PinpadModalProps {
  title: string;
  kind: NumberKind;
  initial: string;
  /** Önceki ekrandan gereken bilgiler; yazarken değişen satırlar `liveInfo` ile gelir. */
  info?: PinpadInfo[];
  liveInfo?: (raw: string) => PinpadInfo[];
  unit?: string;
  confirmLabel?: string;
  onConfirm: (raw: string) => void;
  onClose: () => void;
}

/** Dokunmatik tutar girişi. Klavye de çalışır: rakam, virgül, silme ve Enter. */
export const PinpadModal: React.FC<PinpadModalProps> = ({
  title,
  kind,
  initial,
  info = [],
  liveInfo,
  unit,
  confirmLabel = 'Tamam',
  onConfirm,
  onClose,
}) => {
  const [raw, setRaw] = useState(initial);
  const append = (text: string) => setRaw((current) => toRawNumber(current + text, kind));
  const backspace = () => setRaw((current) => current.slice(0, -1));

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) append(event.key);
      else if (event.key === ',' || event.key === '.') append(',');
      else if (event.key === 'Backspace') backspace();
      else if (event.key === 'Enter') onConfirm(raw.replace(/,$/, ''));
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  const rows = [...info, ...(liveInfo?.(raw) ?? [])];
  const canUseDecimal = kind === 'money' || kind === 'quantity';

  return (
    <Modal isOpen onClose={onClose} title={title} maxWidth="sm">
      <div className="space-y-3">
        {rows.length > 0 ? (
          <dl className="rounded-lg bg-[var(--bg-subtle)] px-4 py-3 space-y-1.5">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-4 text-sm">
                <dt className="text-[var(--text-secondary)]">{row.label}</dt>
                <dd className="font-bold tabular-nums text-[var(--text-primary)]">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <output className="block min-h-14 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] px-4 py-3 text-right text-2xl font-extrabold tabular-nums text-[var(--text-primary)]">
          {raw ? groupNumber(raw) : '0'}
          {unit ? ` ${unit}` : ''}
        </output>
        <Numpad
          onDigit={append}
          onDecimal={canUseDecimal ? () => append(',') : undefined}
          onClear={() => setRaw('')}
          onBackspace={backspace}
        />
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={() => setRaw('')}>Temizle</Button>
          <Button variant="primary" size="lg" onClick={() => onConfirm(raw.replace(/,$/, ''))}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
};
