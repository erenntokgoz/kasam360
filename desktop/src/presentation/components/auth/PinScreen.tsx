import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { Lock, Loader2, Shield, AlertCircle, LogOut } from 'lucide-react';
import { AppleKeypad } from '../common/AppleKeypad';
import { soundService } from '../../../core/services/soundService';

// Geliştirme ortamı için hızlı personel tohum PIN'leri (Açılır minimalist menüde tutulur)
const SEED_USERS = [
  { pin: '1111', role: 'MASTER', label: 'Master' },
  { pin: '2222', role: 'OWNER', label: 'Patron' },
  { pin: '3333', role: 'MANAGER', label: 'Müdür' },
  { pin: '4444', role: 'CASHIER', label: 'Kasiyer' },
  { pin: '5555', role: 'WAITER', label: 'Garson' },
  { pin: '6666', role: 'KITCHEN', label: 'Mutfak' },
];

interface PinScreenProps {
  isLockMode?: boolean;
}

/**
 * Apple iOS Spatial Standartlarında Terminal Kilit Ekranı (PinScreen).
 * Sıfır görsel kalabalık, dairesel tuş takımı ve pürüzsüz PIN noktaları barındırır.
 */
export function PinScreen({ isLockMode = true }: PinScreenProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [showDevRoles, setShowDevRoles] = useState(false);

  const login = useAuthStore((state) => state.login);
  const unlockWithPin = useAuthStore((state) => state.unlockWithPin);
  const logout = useAuthStore((state) => state.logout);
  const branchName = useAuthStore((state) => state.branchName);
  const user = useAuthStore((state) => state.user);

  // Hatalı PIN girildiğinde titreşim efekti
  const triggerShake = useCallback(() => {
    setIsShaking(true);
    soundService.playWarning();
    setTimeout(() => {
      setIsShaking(false);
      setPin('');
    }, 400);
  }, []);

  // PIN gönderimi ve doğrulama
  const submitPin = useCallback(
    async (pinToSubmit: string) => {
      if (pinToSubmit.length < 4 || isLoading) return;
      setIsLoading(true);
      setError('');

      try {
        if (isLockMode && user) {
          await unlockWithPin(pinToSubmit);
        } else {
          await login(pinToSubmit);
        }
        soundService.playSuccessChime();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg || 'Hatalı PIN');
        triggerShake();
      } finally {
        setIsLoading(false);
      }
    },
    [isLockMode, user, isLoading, unlockWithPin, login, triggerShake]
  );

  // Tuşa basıldığında PIN ekleme
  const handleKeyPress = useCallback(
    (digit: string) => {
      if (isLoading) return;
      if (pin.length >= 8) return;
      const nextPin = pin + digit;
      setPin(nextPin);
      setError('');
    },
    [pin, isLoading]
  );

  // Silme işlemi
  const handleBackspace = useCallback(() => {
    if (isLoading) return;
    setPin((prev) => prev.slice(0, -1));
    setError('');
  }, [isLoading]);

  // Geliştirici hızlı giriş işlemi
  const handleQuickLogin = (seedPin: string) => {
    if (isLoading) return;
    setPin(seedPin);
    submitPin(seedPin);
    setShowDevRoles(false);
  };

  // Fiziksel klavye desteği
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLoading) return;
      if (e.key >= '0' && e.key <= '9') {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Enter') {
        if (pin.length >= 4 && pin.length <= 8) {
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
    <div className="relative flex min-h-screen w-full items-center justify-center bg-[#000000] p-4 select-none overflow-hidden">
      {/* Arka planda soft Apple ışık atmosferi */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-blue-600/[0.08] rounded-full blur-[120px] pointer-events-none" />

      {/* Titreşim Animasyon Stili */}
      <style>{`
        @keyframes pin-shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
        .animate-pin-shake {
          animation: pin-shake 0.35s cubic-bezier(.36,.07,.19,.97) both;
        }
      `}</style>

      {/* Geliştirici Tohum Menüsü (Sağ Üst Köşede Minimalist İkon) */}
      <div className="absolute top-6 right-6 z-50">
        <button
          type="button"
          onClick={() => setShowDevRoles(!showDevRoles)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-white/50 hover:text-white text-xs transition-all active:scale-95"
          title="Test Rolleri"
        >
          <Shield size={13} />
          <span className="text-[11px] font-medium">Test Rolleri</span>
        </button>

        {showDevRoles && (
          <div className="absolute right-0 mt-2 w-48 rounded-2xl backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/[0.08] p-2 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
            <div className="text-[10px] font-semibold dark:text-white/40 text-zinc-500 uppercase px-2 py-1 tracking-wider">
              Hızlı Giriş
            </div>
            <div className="space-y-1 mt-1">
              {SEED_USERS.map((u) => (
                <button
                  key={u.pin}
                  type="button"
                  onClick={() => handleQuickLogin(u.pin)}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl dark:hover:bg-white/10 hover:bg-black/[0.05] dark:text-white/90 text-zinc-800 text-xs transition-colors cursor-pointer"
                >
                  <span className="font-medium">{u.label}</span>
                  <span className="font-mono dark:text-white/40 text-zinc-400 text-[11px]">{u.pin}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Ana Kilit Kartı */}
      <div className="relative z-10 flex w-full max-w-[340px] flex-col items-center">
        {/* Kilit Rozeti */}
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.08] border border-white/10 backdrop-blur-xl text-white shadow-xl">
          {isLoading ? (
            <Loader2 className="animate-spin text-white/70" size={24} />
          ) : (
            <Lock size={22} className="stroke-[1.75]" />
          )}
        </div>

        {/* Başlık ve Şube Bilgisi */}
        <h1 className="text-xl font-medium tracking-tight text-white mb-1">
          {isLockMode ? 'KASAM360' : 'Giriş Yap'}
        </h1>
        <div className="flex items-center gap-2 mb-6 text-xs text-white/50">
          <span>{branchName || 'Kadıköy Merkez Şube'}</span>
          {user && (
            <>
              <span>•</span>
              <span className="text-white/80">{user.name}</span>
            </>
          )}
        </div>

        {/* Apple Passcode Dots (Dinamik Parlayan PIN Noktaları) */}
        <div className={`mb-8 flex items-center justify-center h-7 min-w-[220px] ${isShaking ? 'animate-pin-shake' : ''}`}>
          {pin.length === 0 ? (
            <div className="flex items-center justify-center gap-2.5 text-white/35 text-xs font-medium tracking-widest select-none uppercase">
              <span className="inline-block w-6 h-[1px] bg-white/20" />
              <span>PIN Giriniz</span>
              <span className="inline-block w-6 h-[1px] bg-white/20" />
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3 animate-in fade-in zoom-in-95 duration-100">
              {pin.split('').map((_, i) => (
                <div
                  key={i}
                  className={`h-3.5 w-3.5 rounded-full transition-all duration-150 transform ${
                    isShaking
                      ? 'bg-rose-500 scale-110 shadow-[0_0_12px_rgba(244,63,94,0.9)]'
                      : 'bg-white scale-105 shadow-[0_0_12px_rgba(255,255,255,0.85)]'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Hata Bildirimi */}
        {error && (
          <div className="mb-6 flex items-center gap-1.5 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 rounded-full animate-in fade-in">
            <AlertCircle size={13} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Dairesel Apple Tuş Takımı */}
        <AppleKeypad
          onNumberPress={handleKeyPress}
          onBackspace={handleBackspace}
          onSubmit={() => submitPin(pin)}
          canSubmit={pin.length >= 4 && !isLoading}
          disabled={isLoading}
          className="mb-8"
        />

        {/* Oturumu Kapat / Çıkış Butonu */}
        <button
          type="button"
          onClick={logout}
          disabled={isLoading}
          className="flex items-center gap-2 text-xs font-medium text-white/40 hover:text-rose-400 transition-colors py-2 px-4 rounded-full hover:bg-white/[0.04] active:scale-95 cursor-pointer"
        >
          <LogOut size={13} />
          <span>Oturumu Kapat</span>
        </button>
      </div>
    </div>
  );
}

// Geriye dönük uyumluluk için LockPage alias'ı
export const LockPage = PinScreen;
