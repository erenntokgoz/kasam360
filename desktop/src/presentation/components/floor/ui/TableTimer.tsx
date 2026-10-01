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
  if (durationInMinutes >= 35 && durationInMinutes < 90) {
    badgeStyle = 'bg-[#FF9500]/15 dark:bg-[#FF9F0A]/15 text-[#FF9500] dark:text-[#FF9F0A] border-[#FF9500]/30 dark:border-[#FF9F0A]/30 animate-pulse';
  } else if (durationInMinutes >= 90) {
    badgeStyle = 'bg-[#FF3B30]/15 dark:bg-[#FF453A]/15 text-[#FF3B30] dark:text-[#FF453A] border-[#FF3B30]/30 dark:border-[#FF453A]/30 animate-pulse';
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
