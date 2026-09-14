import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { Lock, Loader2, Sparkles, Building2, AlertCircle, LogOut } from 'lucide-react';

const SEED_USERS = [
  { pin: '1111', role: 'MASTER', label: 'Master', desc: 'Platform Admin', color: 'border-purple-500/50 hover:bg-purple-950/40 text-purple-300' },
];

interface PinScreenProps {
  isLockMode?: boolean;
}

export function PinScreen({ isLockMode = false }: PinScreenProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const login = useAuthStore((state) => state.login);
  const unlockWithPin = useAuthStore((state) => state.unlockWithPin);
  const logout = useAuthStore((state) => state.logout);
  const branchName = useAuthStore((state) => state.branchName);
  const user = useAuthStore((state) => state.user);

  const triggerShake = useCallback(() => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 450);
  }, []);

  const submitPin = useCallback(
    async (inputPin: string) => {
      if (inputPin.length !== 4 || isLoading) return;
      setIsLoading(true);
      setError('');
      try {
        if (isLockMode) {
          await unlockWithPin(inputPin);
        } else {
          await login(inputPin);
        }
      } catch (err: unknown) {
        triggerShake();
        const msg = err instanceof Error ? err.message : 'Geçersiz PIN';
        setError(msg.includes('Yetkisiz') ? msg : msg.includes('Too many') ? 'Çok fazla hatalı deneme! Lütfen bekleyin.' : 'Geçersiz PIN kodu! Lütfen tekrar deneyin.');
        setPin('');
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, isLockMode, login, unlockWithPin, triggerShake]
  );

  const handleKeyPress = useCallback(
    (num: string) => {
      if (pin.length < 4 && !isLoading) {
        const nextPin = pin + num;
        setPin(nextPin);
        setError('');
        if (nextPin.length === 4) {
          submitPin(nextPin);
        }
      }
    },
    [pin, isLoading, submitPin]
  );

  const handleBackspace = useCallback(() => {
    if (isLoading) return;
    setPin((prev) => prev.slice(0, -1));
    setError('');
  }, [isLoading]);

  const handleQuickLogin = (seedPin: string) => {
    if (isLoading) return;
    setPin(seedPin);
    submitPin(seedPin);
  };

  // Fiziksel klavye desteği (0-9, Backspace, Enter, Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLoading) return;
      if (e.key >= '0' && e.key <= '9') {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Enter') {
        if (pin.length === 4) {
          submitPin(pin);
        }
      } else if (e.key === 'Escape') {
        setPin('');
        setError('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pin, isLoading, handleKeyPress, handleBackspace, submitPin]);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-slate-950 p-4 select-none">
      <style>{`
        @keyframes pin-shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-10px); }
          40%, 80% { transform: translateX(10px); }
        }
        .animate-pin-shake {
          animation: pin-shake 0.4s cubic-bezier(.36,.07,.19,.97) both;
        }
      `}</style>

      <div className="flex w-full max-w-sm flex-col items-center rounded-3xl border border-slate-800 bg-slate-900/95 p-6 sm:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-xl">
        {/* Logo / Badge */}
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.4)]">
          {isLoading ? (
            <Loader2 className="animate-spin" size={28} />
          ) : (
            <Lock size={26} />
          )}
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          KASAM360
        </h1>
        
        {/* Şube ve Çevrimdışı Durum */}
        <div className="mt-1 mb-5 flex flex-col items-center gap-1.5 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-800/80 px-2.5 py-1 rounded-full border border-slate-700/60">
              <Building2 size={12} className="text-blue-400" />
              <span className="font-medium text-slate-300">{branchName || 'Kadıköy Merkez Şube'}</span>
            </div>
            <div className="flex items-center gap-1 bg-emerald-950/60 text-emerald-400 px-2 py-1 rounded-full border border-emerald-800/50">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Çevrimiçi</span>
            </div>
          </div>
          {isLockMode && user && (
            <div className="text-[11px] text-amber-400/90 font-medium">
              Kilitli Terminal &bull; {user.name} ({user.role})
            </div>
          )}
        </div>

        {/* PIN Display ile Sallantı (Shake) Animasyonu */}
        <div className={`mb-5 flex gap-3 sm:gap-4 transition-transform ${isShaking ? 'animate-pin-shake' : ''}`}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`flex h-14 w-12 sm:h-16 sm:w-14 items-center justify-center rounded-2xl text-3xl font-bold transition-all ${
                i < pin.length
                  ? isShaking
                    ? 'bg-rose-600 text-white shadow-[0_0_15px_rgba(225,29,72,0.6)] scale-105'
                    : 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.5)] scale-105 ring-2 ring-blue-400'
                  : 'border border-slate-800 bg-slate-950/80 text-transparent shadow-inner'
              }`}
            >
              {i < pin.length ? '•' : ''}
            </div>
          ))}
        </div>

        {/* Hata veya Yönlendirme Bildirimi */}
        <div className="min-h-[28px] mb-3 w-full flex items-center justify-center">
          {error ? (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-400 bg-rose-950/50 border border-rose-800/60 px-3 py-1.5 rounded-xl animate-in fade-in">
              <AlertCircle size={14} className="shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          ) : (
            <p className="text-xs text-slate-500 font-medium">4 haneli kullanıcı PIN kodunuzu girin</p>
          )}
        </div>

        {/* Tuş Takımı (Keypad) */}
        <div className="grid grid-cols-3 gap-2.5 w-full mb-5">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              type="button"
              disabled={isLoading}
              onClick={() => handleKeyPress(num.toString())}
              className="flex h-14 sm:h-15 items-center justify-center rounded-2xl bg-slate-800/90 text-2xl font-semibold text-white shadow-sm transition-all hover:bg-slate-700 active:scale-95 active:bg-blue-600 disabled:opacity-50"
            >
              {num}
            </button>
          ))}
          <button
            type="button"
            disabled={isLoading || pin.length === 0}
            onClick={handleBackspace}
            className="flex h-14 sm:h-15 items-center justify-center rounded-2xl bg-slate-800/60 text-sm font-semibold text-slate-300 transition-all hover:bg-slate-700 active:scale-95 disabled:opacity-40"
          >
            Sil
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleKeyPress('0')}
            className="flex h-14 sm:h-15 items-center justify-center rounded-2xl bg-slate-800/90 text-2xl font-semibold text-white shadow-sm transition-all hover:bg-slate-700 active:scale-95 active:bg-blue-600 disabled:opacity-50"
          >
            0
          </button>
          <button
            type="button"
            disabled={pin.length !== 4 || isLoading}
            onClick={() => submitPin(pin)}
            className={`flex h-14 sm:h-15 items-center justify-center rounded-2xl text-base font-bold transition-all active:scale-95 ${
              pin.length === 4 && !isLoading
                ? 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]'
                : 'bg-slate-800/50 text-slate-500 cursor-not-allowed'
            }`}
          >
            {isLoading ? <Loader2 className="animate-spin" size={20} /> : 'Giriş'}
          </button>
        </div>

        {/* Hızlı Test Girişi (Tohum PIN'ler) */}
        <div className="w-full border-t border-slate-800/80 pt-3.5">
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <span className="flex items-center gap-1">
              <Sparkles size={12} className="text-amber-400" />
              Hızlı Rol Girişi (Tohum)
            </span>
            <span className="text-[10px] text-slate-500 font-normal lowercase">tıklayınca giriş yapar</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 w-full">
            {SEED_USERS.map((u) => (
              <button
                key={u.pin}
                type="button"
                disabled={isLoading}
                onClick={() => handleQuickLogin(u.pin)}
                className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl border bg-slate-950/60 transition-all hover:scale-102 active:scale-95 ${u.color} disabled:opacity-50`}
                title={`${u.label} (${u.desc}) olarak hızlı giriş yap`}
              >
                <span className="font-mono text-xs font-extrabold">{u.pin}</span>
                <span className="text-[10px] font-medium leading-tight">{u.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tam Çıkış Yap (Oturumu Kapat & Ana Giriş Ekranına Dön) */}
        {isLockMode && (
          <div className="w-full border-t border-slate-800/80 mt-4 pt-3 flex justify-center">
            <button
              type="button"
              onClick={logout}
              className="flex items-center gap-2 text-xs font-semibold text-rose-400 hover:text-rose-300 py-1 px-3 rounded-lg hover:bg-rose-950/40 transition-colors"
            >
              <LogOut size={14} />
              <span>Tam Çıkış Yap (Oturumu Kapat)</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
