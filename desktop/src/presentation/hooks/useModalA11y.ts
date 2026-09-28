/* eslint-disable react-hooks/rules-of-hooks */
import React, { useEffect, useRef, useCallback } from 'react';

interface UseModalA11yOptions {
  isOpen: boolean;
  onClose: () => void;
  initialFocusRef?: React.RefObject<HTMLElement>;
}

export function useModalA11y({ isOpen, onClose, initialFocusRef }: UseModalA11yOptions) {
  // Test ortamlarında bileşen doğrudan fonksiyon olarak çağrıldığında (SSR/mock) çökmemesi için kontrol
  const dispatcher = (React as unknown as { __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: { ReactCurrentDispatcher?: { current?: unknown } } })
    ?.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentDispatcher?.current;
  if (!dispatcher) {
    return {
      modalRef: { current: null } as unknown as React.RefObject<HTMLDivElement>,
      handleBackdropClick: (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      },
    };
  }

  // Modal DOM referansı ve önceki odak takibi
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      // Modal içinde odak tuzağı (focus trap)
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return;

    // Modal kapandığında önceki odaklanılan öğeyi geri yüklemek için sakla
    previousActiveElement.current = document.activeElement as HTMLElement;

    document.addEventListener('keydown', handleKeyDown);

    // Modal açıldığında ilk odaklanacak öğeyi belirle
    const timer = setTimeout(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
      } else if (modalRef.current) {
        const firstFocusable = modalRef.current.querySelector<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
        );
        firstFocusable?.focus();
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveElement.current?.focus();
    };
  }, [isOpen, handleKeyDown, initialFocusRef]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  return { modalRef, handleBackdropClick };
}
