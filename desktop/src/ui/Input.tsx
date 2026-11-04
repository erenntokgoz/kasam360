import React from 'react';
import { cn } from '../lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <input
        ref={ref}
        // Tarayıcı belleği kapalı: önceki personel adları ve kimlik numaraları önerilmesin.
        autoComplete="off"
        spellCheck={false}
        className={cn(
          'min-h-12 w-full px-3.5 py-2 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border)] text-sm outline-none transition-colors duration-100 placeholder:text-[var(--text-muted)] focus:border-[var(--accent-amber)]',
          error && 'border-[var(--accent-red)] focus:border-[var(--accent-red)]',
          className
        )}
        data-empty-date={props.type === 'date' && !props.value ? 'true' : undefined}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
