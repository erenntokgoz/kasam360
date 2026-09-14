import { useState, useEffect } from 'react';

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
    // Aşırı yeniden render (re-render) işlemlerini önlemek için her 60 saniyede bir güncelle
    const intervalId = setInterval(calculate, 60000);

    return () => clearInterval(intervalId);
  }, [openedAt]);

  if (!openedAt) return null;

  let colorClass = 'bg-emerald-500';
  let pulseClass = '';

  if (durationInMinutes >= 30 && durationInMinutes <= 60) {
    colorClass = 'bg-orange-500';
  } else if (durationInMinutes > 60) {
    colorClass = 'bg-rose-500';
    pulseClass = 'animate-pulse';
  }

  const hours = Math.floor(durationInMinutes / 60);
  const minutes = durationInMinutes % 60;
  const timeString = hours > 0 ? `${hours}s ${minutes}d` : `${minutes} dk`;

  return (
    <div className={`w-full h-full flex items-center justify-center ${colorClass} ${pulseClass} transition-colors duration-500`}>
      <span className="text-xs font-bold text-white drop-shadow-md">{timeString}</span>
    </div>
  );
}
