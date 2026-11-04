import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invokeIPC } from '../../services/tauriClient';
import { Numpad } from '../../ui/Numpad';

const PIN_MIN = 4;
const PIN_MAX = 8;
/** Daha uzun bir PIN yazılıyor olabilir: kısa kalıpta kısa bir süre beklenir. */
const WAIT_MS = 800;

interface PinLengths {
  lengths: number[];
  hasUnknown: boolean;
}

interface PinEntryProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  isBusy: boolean;
}

/** PIN tamamlanınca kendiliğinden girer; hatalı deneme işletmeyi kilitlediği için erken denenmez. */
export const PinEntry: React.FC<PinEntryProps> = ({ value, onChange, onSubmit, isBusy }) => {
  const [known, setKnown] = useState<PinLengths>({ lengths: [], hasUnknown: true });
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

  useEffect(() => {
    void invokeIPC<PinLengths>('get_pin_lengths').then(setKnown).catch(() => undefined);
  }, []);

  useEffect(() => {
    const length = value.length;
    if (length < PIN_MIN || isBusy) return undefined;
    const longest = Math.max(...known.lengths, 0);
    if (!known.hasUnknown && !known.lengths.includes(length) && length < longest) return undefined;
    const isFinal = length === PIN_MAX || (!known.hasUnknown && length >= longest);
    const timer = setTimeout(() => submitRef.current(), isFinal ? 0 : WAIT_MS);
    return () => clearTimeout(timer);
  }, [value, known, isBusy]);

  const add = useCallback(
    (digit: string) => {
      if (value.length < PIN_MAX) onChange(value + digit);
    },
    [value, onChange],
  );

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (/^[0-9]$/.test(event.key)) add(event.key);
      else if (event.key === 'Backspace') onChange(value.slice(0, -1));
      else if (event.key === 'Escape') onChange('');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [value, onChange, add]);

  return (
    <div className="flex flex-col gap-3">
      <div aria-label={`${value.length} hane girildi`} role="status" className="auth-pin">
        {Array.from({ length: Math.max(PIN_MIN, value.length) }, (_, index) => (
          <span key={index} data-filled={index < value.length} />
        ))}
      </div>
      <Numpad onDigit={add} onClear={() => onChange('')} onBackspace={() => onChange(value.slice(0, -1))} buttonHeightClass="!min-h-[52px]" />
    </div>
  );
};
