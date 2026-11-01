import React from 'react';
import { cn } from '../lib/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'selected' | 'success' | 'danger' | 'secondary' | 'ghost' | 'outline-amber' | 'outline-emerald';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', isLoading, disabled, children, ...props }, ref) => {
    const baseClasses =
      'tactile-btn inline-flex items-center justify-center font-semibold select-none cursor-pointer text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]';

    const sizeClasses = {
      sm: 'min-h-12 px-3 py-1 text-sm gap-1.5',
      md: 'min-h-12 px-4 py-2 text-sm gap-2',
      lg: 'min-h-14 px-5 py-2.5 text-base gap-2.5',
      xl: 'min-h-16 px-6 py-3 text-lg gap-3',
    }[size];

    const variantClasses = {
      primary: 'btn-primary',
      selected: 'btn-selected',
      success: 'btn-success',
      danger: 'btn-danger',
      secondary: 'btn-secondary',
      ghost: 'btn-ghost',
      'outline-amber': 'btn-secondary',
      'outline-emerald': 'btn-secondary',
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
