import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

/**
 * Canlı Saat Başlık Bileşeni (İzole Render).
 * Her saniye yalnızca kendi yerel metnini günceller;
 * üst bileşenleri re-render etmez.
 */
export const LiveClock: React.FC = React.memo(() => {
  const [timeStr, setTimeStr] = useState(() => new Date().toLocaleTimeString('tr-TR'));

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeStr(new Date().toLocaleTimeString('tr-TR'));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-1.5 dark:text-white/80 text-zinc-700 font-mono text-sm font-semibold dark:bg-white/[0.04] bg-black/[0.04] px-3 py-1.5 rounded-xl border dark:border-white/[0.06] border-black/10 tabular-nums">
      <Clock size={14} className="dark:text-white/40 text-zinc-400" />
      {timeStr}
    </div>
  );
});
