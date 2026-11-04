import React, { useEffect, useState } from 'react';
import { BrandMark } from '../../ui/BrandMark';

interface AuthShellProps {
  title: string;
  dialogLabel?: string;
  className?: string;
  children: React.ReactNode;
}

const timeFormat = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Bütün kapı ekranları aynı açık defterdir: solda saat, sağda işlem. */
export const AuthShell: React.FC<AuthShellProps> = ({ title, dialogLabel, className = '', children }) => {
  const now = useNow();

  return (
    <div role="dialog" aria-modal="true" aria-label={dialogLabel ?? title} className="auth-desk">
      <div className={`auth-spread ${className}`}>
        <aside className="auth-left">
          <div className="flex items-center gap-3">
            <BrandMark className="w-11 h-11" surface="paper" />
            <span className="auth-brand">KASAM360</span>
          </div>
          <div>
            <p className="auth-clock tabular-nums">{timeFormat.format(now)}</p>
            <p className="auth-date">{dateFormat.format(now)}</p>
          </div>
          <p className="auth-copyright">© {now.getFullYear()} 360 Labs</p>
        </aside>
        <span className="auth-rings" aria-hidden="true" />
        <main className="auth-right">
          <h1 className="auth-heading">{title}</h1>
          {children}
        </main>
      </div>
    </div>
  );
};
