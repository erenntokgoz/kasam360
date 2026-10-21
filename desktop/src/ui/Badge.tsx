import React from 'react';
import { cn } from '../lib/cn';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'emerald' | 'amber' | 'red' | 'blue' | 'neutral';
}

export const Badge: React.FC<BadgeProps> = ({ className, variant = 'neutral', children, ...props }) => {
  const variantClasses = {
    emerald:
      'bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald)] border-[var(--accent-emerald-border)]',
    amber:
      'bg-[var(--accent-amber-soft)] text-[var(--accent-amber)] border-[var(--accent-amber-border)]',
    red:
      'bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red-border)]',
    blue:
      'bg-[var(--accent-blue-soft)] text-[var(--accent-blue)] border-[var(--accent-blue-border)]',
    neutral:
      'bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border)]',
  }[variant];

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border tabular-nums select-none tracking-tight',
        variantClasses,
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};
