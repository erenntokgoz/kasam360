import React, { useEffect, useRef } from 'react';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { useExitGhost } from './useExitGhost';
import { useFocusTrap } from './useFocusTrap';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '5xl';
  showCloseButton?: boolean;
  surface?: 'paper' | 'work';
  cardFlow?: boolean;
  fullScreen?: boolean;
  /** Kapat düğmesinin yanına gelen işlemler; biçimi Kapat ile aynıdır. */
  headerActions?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'md',
  showCloseButton = true,
  surface = 'paper',
  headerActions,
  cardFlow = false,
  fullScreen = false,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, isOpen);
  useExitGhost(rootRef, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // İç içe pencerede Esc yalnız en üsttekini kapatır.
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (e.key !== 'Escape' || dialogs[dialogs.length - 1] !== panelRef.current?.parentElement) return;
      // Yazı alanındayken Esc yalnız alandan çıkar; formu kapatıp girileni silmez.
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) {
        active.blur();
        return;
      }
      onClose();
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
    '5xl': 'max-w-5xl',
  }[maxWidth];

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={cn('motion-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/75', fullScreen ? 'p-0 overflow-hidden' : 'p-4 overflow-y-auto')}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        data-motion-panel="dialog"
        className={cn(
          'motion-dialog outline-none w-full border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden flex flex-col',
          surface === 'work' ? 'work-surface' : 'paper',
          cardFlow && !fullScreen && 'max-h-full',
          fullScreen ? 'w-screen h-screen max-w-none max-h-none rounded-none' : maxWidthClasses
        )}
      >
        <div className="px-5 pt-5 pb-3 border-b border-[var(--border)] flex items-center justify-between gap-3 shrink-0">
          <div>
            <h2 className="print-title text-base font-bold text-[var(--text-primary)]">{title}</h2>
            {subtitle ? <p className="text-xs text-[var(--text-secondary)] mt-0.5">{subtitle}</p> : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerActions}
            {showCloseButton ? (
              <Button variant="ghost" size="sm" onClick={onClose} aria-label="Kapat">
                Kapat
              </Button>
            ) : null}
          </div>
        </div>
        <div className={cn(fullScreen ? 'flex-1 min-h-0 overflow-hidden flex flex-col' : 'p-5 overflow-y-auto', !cardFlow && !fullScreen && 'max-h-[calc(100vh-7.5rem)]')}>{children}</div>
      </div>
    </div>
  );
};
