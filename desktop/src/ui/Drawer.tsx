import React, { useEffect, useRef } from 'react';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { useExitGhost } from './useExitGhost';
import { useFocusTrap } from './useFocusTrap';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'md' | 'lg' | 'xl';
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'md',
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useFocusTrap(panelRef, isOpen);
  useExitGhost(rootRef, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const widthClasses = {
    md: 'max-w-[420px]',
    lg: 'max-w-[500px]',
    xl: 'max-w-[600px]',
  }[width];

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      className="motion-backdrop fixed inset-0 z-40 flex justify-end glass-scrim overflow-hidden"
      onClick={onClose}
    >
      <aside
        ref={panelRef}
        tabIndex={-1}
        aria-label={title}
        data-motion-panel="drawer"
        className={cn(
          'motion-drawer glass-panel outline-none w-full h-full paper !rounded-none border-l border-[var(--border)] flex flex-col justify-between shadow-2xl',
          widthClasses
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between shrink-0">
          <div>
            <h2 className="print-title text-base font-bold text-[var(--text-primary)]">{title}</h2>
            {subtitle ? <p className="text-xs text-[var(--text-secondary)] mt-0.5">{subtitle}</p> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Kapat">
            Kapat
          </Button>
        </div>

        <div className="glass-body flex-1 overflow-y-auto p-4 space-y-4">{children}</div>

        {footer ? (
          <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-subtle)] space-y-2.5 shrink-0">
            {footer}
          </div>
        ) : null}
      </aside>
    </div>
  );
};
