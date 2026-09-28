import React from 'react';
import { Delete } from 'lucide-react';

interface AppleKeypadProps {
  onNumberPress: (digit: string) => void;
  onBackspace: () => void;
  onSubmit?: () => void;
  canSubmit?: boolean;
  submitLabel?: string;
  disabled?: boolean;
  className?: string;
}

const KEYPAD_LETTERS: Record<number, string> = {
  1: '',
  2: 'ABC',
  3: 'DEF',
  4: 'GHI',
  5: 'JKL',
  6: 'MNO',
  7: 'PQRS',
  8: 'TUV',
  9: 'WXYZ',
  0: '+',
};

/**
 * iPhone Kilit Ekranı stili dairesel tuş takımı.
 * Sayıların altında harfler, sol altta opsiyonel Giriş/Onay butonu ve dokunma geri bildirimi barındırır.
 */
export const AppleKeypad: React.FC<AppleKeypadProps> = ({
  onNumberPress,
  onBackspace,
  onSubmit,
  canSubmit = true,
  submitLabel = 'GİRİŞ',
  disabled = false,
  className = '',
}) => {
  return (
    <div className={`grid grid-cols-3 gap-y-4 gap-x-6 place-items-center max-w-[320px] mx-auto select-none ${className}`}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
        <button
          key={num}
          type="button"
          disabled={disabled}
          onClick={() => onNumberPress(num.toString())}
          className="flex flex-col items-center justify-center h-18 w-18 sm:h-20 sm:w-20 rounded-full bg-white/[0.07] hover:bg-white/[0.12] active:bg-white/[0.22] active:scale-95 border border-white/[0.08] transition-all duration-75 gpu-accelerated cursor-pointer disabled:opacity-30 disabled:pointer-events-none shadow-sm"
        >
          <span className="text-2xl sm:text-3xl font-light tracking-tight text-white leading-none">
            {num}
          </span>
          {KEYPAD_LETTERS[num] && (
            <span className="text-[9px] font-medium tracking-widest text-white/50 mt-1 uppercase">
              {KEYPAD_LETTERS[num]}
            </span>
          )}
        </button>
      ))}

      {/* Sol alt köşe: Onay/Giriş butonu veya boşluk simetrisi */}
      {onSubmit ? (
        <button
          type="button"
          disabled={disabled || !canSubmit}
          onClick={onSubmit}
          className="flex items-center justify-center h-18 w-18 sm:h-20 sm:w-20 rounded-full bg-white/[0.12] hover:bg-white/[0.2] active:bg-white/[0.28] text-white text-xs font-semibold uppercase tracking-wider border border-white/[0.15] transition-all duration-75 gpu-accelerated cursor-pointer disabled:opacity-20 disabled:pointer-events-none shadow-sm active:scale-95"
        >
          {submitLabel}
        </button>
      ) : (
        <div className="h-18 w-18 sm:h-20 sm:w-20" />
      )}

      {/* 0 Tuşu */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onNumberPress('0')}
        className="flex flex-col items-center justify-center h-18 w-18 sm:h-20 sm:w-20 rounded-full bg-white/[0.07] hover:bg-white/[0.12] active:bg-white/[0.22] active:scale-95 border border-white/[0.08] transition-all duration-75 gpu-accelerated cursor-pointer disabled:opacity-30 disabled:pointer-events-none shadow-sm"
      >
        <span className="text-2xl sm:text-3xl font-light tracking-tight text-white leading-none">
          0
        </span>
      </button>

      {/* Sil (Backspace) Tuşu */}
      <button
        type="button"
        disabled={disabled}
        onClick={onBackspace}
        className="flex items-center justify-center h-18 w-18 sm:h-20 sm:w-20 rounded-full text-white/70 hover:text-white hover:bg-white/[0.08] active:bg-white/[0.16] active:scale-95 transition-all duration-75 gpu-accelerated cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
      >
        <Delete size={22} className="stroke-[1.5]" />
      </button>
    </div>
  );
};

