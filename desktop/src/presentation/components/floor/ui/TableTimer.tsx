import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

export function TableTimer({ openedAt }: { openedAt?: number }) {
  const [durationInMinutes, setDurationInMinutes] = useState(0);

  useEffect(() => {
    if (!openedAt) return;

    const calculate = () => {
      const now = Date.now();
      const diffInMinutes = Math.floor((now - openedAt) / 60000);
      setDurationInMinutes(diffInMinutes);
    };

    calculate();
    const intervalId = setInterval(calculate, 60000);

    return () => clearInterval(intervalId);
  }, [openedAt]);

  if (!openedAt) return null;

  // macOS Frosted Glass rozet stilleri — Geçersiz sınıflar ve katı #16171b rengi kaldırıldı
  let badgeStyle = 'dark:bg-white/[0.06] bg-black/[0.04] dark:text-white/70 text-zinc-600 dark:border-white/10 border-black/[0.08]';
  if (durationInMinutes >= 45 && durationInMinutes < 90) {
    badgeStyle = 'dark:bg-amber-500/15 bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
  } else if (durationInMinutes >= 90) {
    badgeStyle = 'dark:bg-rose-500/15 bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30';
  }

  const hours = Math.floor(durationInMinutes / 60);
  const minutes = durationInMinutes % 60;
  const timeString = hours > 0 ? `${hours}s ${minutes}d` : `${minutes} dk`;

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-mono font-medium ${badgeStyle} shadow-sm backdrop-blur-md`}>
      <Clock size={11} className="shrink-0 opacity-70" />
      <span>{timeString}</span>
    </div>
  );
}
