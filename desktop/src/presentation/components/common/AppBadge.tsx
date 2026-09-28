import React from 'react';

export type BadgeVariant =
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'neutral'
  | 'available'
  | 'occupied'
  | 'reserved'
  | 'preparing'
  | 'ready'
  | 'locked';

interface AppBadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}

const BADGE_STYLES: Record<BadgeVariant, { badge: string; dot: string }> = {
  success: {
    badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  danger: {
    badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    dot: 'bg-rose-400',
  },
  warning: {
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dot: 'bg-amber-400',
  },
  info: {
    badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    dot: 'bg-blue-400',
  },
  neutral: {
    badge: 'dark:bg-white/[0.08] bg-black/[0.06] dark:text-zinc-300 text-zinc-700 dark:border-white/10 border-black/10',
    dot: 'bg-zinc-400',
  },
  available: {
    badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    dot: 'bg-emerald-500',
  },
  occupied: {
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    dot: 'bg-rose-400',
  },
  reserved: {
    badge: 'bg-[#007AFF]/15 text-[#5AC8FA] border-[#007AFF]/50/30',
    dot: 'bg-indigo-400',
  },
  preparing: {
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dot: 'bg-amber-400',
  },
  ready: {
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    dot: 'bg-emerald-400',
  },
  locked: {
    badge: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    dot: 'bg-purple-400',
  },
};

export function AppBadge({
  variant = 'neutral',
  children,
  dot = false,
  className = '',
}: AppBadgeProps) {
  const { badge, dot: dotBg } = BADGE_STYLES[variant];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badge} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotBg} animate-pulse`} aria-hidden="true" />}
      {children}
    </span>
  );
}
