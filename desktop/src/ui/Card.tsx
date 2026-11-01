import React from 'react';
import { cn } from '../lib/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'panel' | 'card' | 'subtle';
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'card', children, ...props }, ref) => {
    const variantClasses = {
      panel: 'paper',
      card: 'paper border-[var(--border)] rounded-xl shadow-md',
      subtle: 'bg-[var(--bg-subtle)] border-[var(--border)] rounded-md',
    }[variant];

    return (
      <div
        ref={ref}
        className={cn('border transition-colors duration-100', variantClasses, className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';
