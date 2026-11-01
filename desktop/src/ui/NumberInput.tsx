import React, { useLayoutEffect, useRef, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import { cn } from '../lib/cn';
import { groupNumber, toRawNumber, type NumberKind } from '../lib/numberText';
import { Input, type InputProps } from './Input';
import { PinpadModal, type PinpadInfo } from './PinpadModal';

export interface NumberInputProps extends Omit<InputProps, 'value' | 'onChange'> {
  kind?: NumberKind;
  value: string | number;
  onValueChange: (raw: string) => void;
  /** Tutar ve miktar alanlarında açıktır; dar alanlarda kapatılır. */
  pinpad?: boolean;
  pinpadTitle?: string;
  pinpadInfo?: PinpadInfo[];
  pinpadLiveInfo?: (raw: string) => PinpadInfo[];
}

/**
 * Bütün sayı girişleri bu alandan geçer: harf yazılmaz, binlikler ayrılır, üst bileşen ham
 * metni tutar. İmleç gruplama sonrası yazılan hanenin yanında kalır.
 */
export const NumberInput: React.FC<NumberInputProps> = ({
  kind = 'money',
  value,
  onValueChange,
  pinpad = kind === 'money' || kind === 'quantity',
  pinpadTitle,
  pinpadInfo,
  pinpadLiveInfo,
  className,
  type,
  ...props
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const caretDigits = useRef<number | null>(null);
  const [isPadOpen, setIsPadOpen] = useState(false);
  const raw = String(value);
  const display = kind === 'digits' ? raw : groupNumber(raw);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (caretDigits.current === null || !input) return;
    let seen = 0;
    let position = 0;
    while (position < input.value.length && seen < caretDigits.current) {
      if (/[\d,]/.test(input.value[position])) seen += 1;
      position += 1;
    }
    input.setSelectionRange(position, position);
    caretDigits.current = null;
  });

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const typedBeforeCaret = event.target.value.slice(0, event.target.selectionStart ?? 0);
    caretDigits.current = typedBeforeCaret.replace(/[^\d,]/g, '').length;
    onValueChange(toRawNumber(event.target.value, kind));
  };

  return (
    <div className={cn('relative w-full min-w-0', className)}>
      <Input
        {...props}
        ref={inputRef}
        type={type === 'password' ? 'password' : 'text'}
        inputMode={kind === 'money' || kind === 'quantity' ? 'decimal' : 'numeric'}
        autoComplete="off"
        className={cn('tabular-nums', pinpad && 'pr-14')}
        value={display}
        onChange={handleChange}
        onBlur={() => {
          if (raw.endsWith(',')) onValueChange(raw.slice(0, -1));
        }}
      />
      {pinpad ? (
        <button
          type="button"
          aria-label="Tuş takımını aç"
          disabled={props.disabled}
          onClick={() => setIsPadOpen(true)}
          className="absolute right-1 top-1 bottom-1 w-12 flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer disabled:opacity-50"
        >
          <Grid3x3 className="w-5 h-5" />
        </button>
      ) : null}
      {isPadOpen ? (
        <PinpadModal
          title={pinpadTitle ?? props['aria-label'] ?? 'Tutar Girin'}
          kind={kind}
          initial={raw}
          info={pinpadInfo}
          liveInfo={pinpadLiveInfo}
          unit={kind === 'money' ? '₺' : undefined}
          onConfirm={(next) => {
            onValueChange(next);
            setIsPadOpen(false);
          }}
          onClose={() => setIsPadOpen(false)}
        />
      ) : null}
    </div>
  );
};
