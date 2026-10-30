import React, { useEffect, useState } from 'react';
import { Lock, Sun, Moon, Clock } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useShiftStore } from '../../stores/shiftStore';
import { useUIStore } from '../../stores/uiStore';
import { formatTime } from '../../lib/date';
import { Button } from '../../ui/Button';
import { SyncStatusChip } from './SyncStatusChip';

export const TopStatusBar: React.FC = () => {
  const { user, lock } = useAuthStore();
  const { activeShift } = useShiftStore();
  const { theme, toggleTheme, idleSecondsLeft, openModal } = useUIStore();
  const [timeStr, setTimeStr] = useState(formatTime());

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeStr(formatTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatIdleSeconds = (secs: number) => {
    const m = Math.floor(secs / 60)
      .toString()
      .padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const roleLabels: Record<string, string> = {
    MASTER: 'Yönetici',
    OWNER: 'Patron',
    MANAGER: 'Müdür',
    CASHIER: 'Kasiyer',
    WAITER: 'Garson',
    KITCHEN: 'Mutfak',
  };

  const isShiftOpen = activeShift && activeShift.isOpen;

  return (
    <header className="h-14 shrink-0 bg-[var(--bg-panel)] border-b border-[var(--border)] px-4 flex items-center justify-between gap-4 z-20 select-none">
      {/* Sol: Marka Rozeti ve Vardiya Durumu */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 pr-3 border-r border-[var(--border)]">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs text-white bg-[var(--accent-amber)] shadow-sm">
            360
          </div>
          <span className="font-bold text-sm tracking-tight text-[var(--text-primary)]">KASAM360</span>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!isShiftOpen) openModal('shiftGate');
          }}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
            isShiftOpen
              ? 'bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald)] border-[var(--accent-emerald-border)]'
              : 'bg-[var(--accent-amber-soft)] text-[var(--accent-amber)] border-[var(--accent-amber-border)]'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isShiftOpen ? 'bg-[var(--accent-emerald)]' : 'bg-[var(--accent-amber)]'
            }`}
          />
          <span>{isShiftOpen ? 'Vardiya Açık' : 'Vardiya Kapalı'}</span>
        </button>

        <div className="hidden sm:flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium tabular-nums ml-1">
          <Clock className="w-3.5 h-3.5" />
          <span>{timeStr}</span>
        </div>

        <SyncStatusChip />
      </div>

      {/* Sağ: Otomatik Kilit Sayacı, Tema Değiştirici, Aktif Kullanıcı ve Manuel Kilitle */}
      <div className="flex items-center gap-2">
        <div
          className="hidden md:flex items-center gap-1.5 px-2.5 h-9 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-xs tabular-nums"
          title="2 dakika hareketsizlikte ekran otomatik kilitlenir"
        >
          <span className="text-[var(--text-muted)]">Kilit:</span>
          <span className="font-semibold text-[var(--text-secondary)]">
            {formatIdleSeconds(idleSecondsLeft)}
          </span>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={toggleTheme}
          className="!min-h-[36px] !px-3"
          aria-label="Tema Değiştir"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
          <span className="hidden sm:inline">{theme === 'dark' ? 'Açık Tema' : 'Koyu Tema'}</span>
        </Button>

        <div className="px-3 h-9 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] flex items-center gap-2 text-xs">
          <span className="font-semibold text-[var(--text-primary)]">{user?.name || 'Kullanıcı'}</span>
          <span className="text-[var(--text-muted)] border-l border-[var(--border)] pl-2">
            {roleLabels[user?.role || ''] || 'Personel'}
          </span>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={lock}
          className="!min-h-[36px] !px-3 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          aria-label="Terminali Kilitle"
        >
          <Lock className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Kilitle</span>
        </Button>
      </div>
    </header>
  );
};
