import React from 'react';
import { cn } from '../lib/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'success' | 'danger' | 'secondary' | 'ghost' | 'outline-amber' | 'outline-emerald';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', isLoading, disabled, children, ...props }, ref) => {
    const baseClasses =
      'tactile-btn inline-flex items-center justify-center font-semibold rounded-lg select-none cursor-pointer text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]';

    const sizeClasses = {
      sm: 'min-h-12 px-2.5 py-1 text-xs gap-1.5',
      md: 'min-h-12 px-4 py-2 text-xs sm:text-sm gap-2',
      lg: 'min-h-[50px] px-5 py-2.5 text-sm sm:text-base gap-2.5',
      xl: 'min-h-[56px] px-6 py-3 text-base sm:text-lg gap-3',
    }[size];

    const variantClasses = {
      primary:
        'bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white border-transparent shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25)]',
      success:
        'bg-[var(--success)] hover:bg-[var(--success-hover)] text-white border-transparent shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25)]',
      danger:
        'bg-[var(--danger)] hover:bg-[var(--danger-hover)] text-white border-transparent shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25)]',
      secondary:
        'bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border-[var(--border)]',
      ghost:
        'bg-transparent hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-transparent shadow-none',
      'outline-amber':
        'bg-[var(--accent-amber-soft)] hover:bg-[var(--accent-amber)] hover:text-[var(--bg-canvas)] text-[var(--accent-amber)] border-[var(--accent-amber-border)]',
      'outline-emerald':
        'bg-[var(--accent-emerald-soft)] hover:bg-[var(--accent-emerald)] hover:text-[var(--bg-canvas)] text-[var(--accent-emerald)] border-[var(--accent-emerald-border)]',
    }[variant];

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseClasses, sizeClasses, variantClasses, className)}
        {...props}
      >
        {isLoading ? (
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
        ) : null}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
