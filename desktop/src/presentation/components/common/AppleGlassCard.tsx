import React from 'react';

interface AppleGlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: 'subtle' | 'regular' | 'solid';
  className?: string;
  isInteractive?: boolean;
}

/**
 * Apple Spatial tarzı buzlu cam kart bileşeni.
 * GPU donanım hızlandırmalı ve hafif derinlik efektli.
 */
export const AppleGlassCard: React.FC<AppleGlassCardProps> = ({
  children,
  variant = 'regular',
  className = '',
  isInteractive = false,
  ...props
}) => {
  const variantStyles = {
    subtle: 'dark:bg-white/[0.04] bg-black/[0.03] dark:border-white/10 border-black/10 backdrop-blur-2xl',
    regular: 'apple-glass rounded-3xl',
    solid: 'dark:bg-[#1a1b21]/80 bg-white/85 dark:border-white/12 border-black/10 backdrop-blur-2xl shadow-xl',
  };

  const interactiveStyles = isInteractive
    ? 'cursor-pointer transition-all duration-150 active:scale-[0.98] hover:border-[#007AFF]/40'
    : '';

  return (
    <div
      className={`rounded-3xl border gpu-accelerated ${variantStyles[variant]} ${interactiveStyles} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
