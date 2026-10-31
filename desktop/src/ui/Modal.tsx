import React, { useEffect } from 'react';
import { cn } from '../lib/cn';
import { Button } from './Button';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  showCloseButton?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'md',
  showCloseButton = true,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
  }[maxWidth];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className={cn(
          'w-full paper border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden flex flex-col',
          maxWidthClasses
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between shrink-0">
          <div>
            <h2 className="print-title text-base font-bold text-[var(--text-primary)]">{title}</h2>
            {subtitle ? <p className="text-xs text-[var(--text-secondary)] mt-0.5">{subtitle}</p> : null}
          </div>
          {showCloseButton ? (
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Kapat">
              Kapat
            </Button>
          ) : null}
        </div>
        <div className="p-5 overflow-y-auto max-h-[85vh]">{children}</div>
      </div>
    </div>
  );
};
