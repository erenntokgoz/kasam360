import React from 'react';
import { cn } from '../lib/cn';
import { Button } from './Button';

export interface NumpadProps {
  onDigit: (digit: string) => void;
  onClear: () => void;
  onBackspace: () => void;
  className?: string;
  buttonHeightClass?: string;
}

export const Numpad: React.FC<NumpadProps> = ({
  onDigit,
  onClear,
  onBackspace,
  className,
  buttonHeightClass = '!min-h-16',
}) => {
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className={cn('grid grid-cols-3 gap-2', className)}>
      {digits.map((d) => (
        <Button
          key={d}
          type="button"
          variant="secondary"
          className={cn(buttonHeightClass, 'text-2xl font-bold')}
          onClick={() => onDigit(d)}
        >
          {d}
        </Button>
      ))}
      <Button
        type="button"
        variant="ghost"
        className={cn(buttonHeightClass, 'text-xs font-semibold text-[var(--text-secondary)]')}
        onClick={onClear}
      >
        Temizle
      </Button>
      <Button
        type="button"
        variant="secondary"
        className={cn(buttonHeightClass, 'text-2xl font-bold')}
        onClick={() => onDigit('0')}
      >
        0
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={cn(buttonHeightClass, 'text-xs font-semibold text-[var(--text-secondary)]')}
        onClick={onBackspace}
      >
        Sil
      </Button>
    </div>
  );
};
