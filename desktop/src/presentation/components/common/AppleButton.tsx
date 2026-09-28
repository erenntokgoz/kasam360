import React from 'react';

export interface AppleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'glass';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Apple HIG standartlarında dokunmatik ekran uyumlu buton bileşeni.
 * Hızlı dokunma hissiyatı ve milisaniyelik tok esneme efekti sağlar.
 */
export const AppleButton: React.FC<AppleButtonProps> = ({
  variant = 'primary',
  size = 'md',
  icon,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const sizeStyles = {
    sm: 'h-9 px-3.5 text-xs rounded-xl gap-1.5',
    md: 'h-11 px-5 text-sm rounded-2xl gap-2',
    lg: 'h-13 px-6 text-base rounded-2xl gap-2.5',
    xl: 'h-16 px-8 text-lg rounded-3xl gap-3',
  };

  const variantStyles = {
    primary:
      'bg-[#007AFF] hover:bg-[#0071E3] text-white shadow-lg shadow-[#007AFF]/20 active:bg-[#0062C4]',
    secondary:
      'bg-white/[0.08] hover:bg-white/[0.12] text-white border border-white/[0.08] active:bg-white/[0.05]',
    danger:
      'bg-[#FF3B30] hover:bg-[#E0352B] text-white shadow-lg shadow-[#FF3B30]/20 active:bg-[#C92F26]',
    ghost:
      'bg-transparent hover:bg-white/[0.06] text-white/80 hover:text-white active:bg-white/[0.03]',
    glass:
      'bg-white/[0.06] backdrop-blur-xl border border-white/10 hover:border-white/20 text-white shadow-lg active:scale-95',
  };

  return (
    <button
      disabled={disabled}
      className={`inline-flex items-center justify-center font-medium tracking-tight select-none transition-all duration-100 ease-out active:scale-[0.97] gpu-accelerated disabled:opacity-40 disabled:pointer-events-none cursor-pointer ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
};
