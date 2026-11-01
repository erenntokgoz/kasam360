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
      'tactile-btn inline-flex items-center justify-center font-bold rounded-md select-none cursor-pointer text-center';

    const sizeClasses = {
      sm: 'min-h-12 px-3 py-1 text-sm gap-1.5',
      md: 'min-h-12 px-4 py-2 text-sm gap-2',
      lg: 'min-h-14 px-5 py-2.5 text-base gap-2.5',
      xl: 'min-h-16 px-6 py-3 text-lg gap-3',
    }[size];

    const variantClasses = {
      primary: 'bg-[var(--primary-bg)] hover:bg-[var(--primary-hover)] text-[var(--primary-fg)] border-transparent',
      success: 'bg-[var(--success-bg)] hover:bg-[var(--success-hover)] text-[var(--success-fg)] border-transparent',
      danger: 'bg-[var(--danger-bg)] hover:bg-[var(--danger-hover)] text-[var(--danger-fg)] border-transparent',
      secondary:
        'bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border-[var(--border-strong)]',
      ghost:
        'bg-transparent hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-transparent shadow-none',
      'outline-amber':
        'bg-[var(--accent-amber-soft)] hover:bg-[var(--bg-hover)] text-[var(--accent-amber)] border-[var(--accent-amber-border)]',
      'outline-emerald':
        'bg-[var(--accent-emerald-soft)] hover:bg-[var(--bg-hover)] text-[var(--accent-emerald)] border-[var(--accent-emerald-border)]',
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
