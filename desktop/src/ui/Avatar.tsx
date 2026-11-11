import React from 'react';
import { cn } from '../lib/cn';

/** Ad baş harflerinden daire: liste satırının solunda kaydı hızla ayırt ettirir. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? '' : '';
  return (first + last).toLocaleUpperCase('tr-TR');
}

export const Avatar: React.FC<{ name: string; className?: string }> = ({ name, className }) => (
  <span aria-hidden="true" className={cn('avatar', className)}>{initialsOf(name)}</span>
);
