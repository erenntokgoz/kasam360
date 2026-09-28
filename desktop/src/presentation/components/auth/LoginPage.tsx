import React, { useState } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { Lock, Loader2, Shield, AlertCircle, Mail, Eye, EyeOff, KeyRound, ArrowRight } from 'lucide-react';

// Geliştirme ve test ortamı için hızlı rol doldurucu
const QUICK_ROLES = [
  { role: 'MASTER', label: 'Master Admin', email: 'admin@kasam360.com', pass: 'admin123' },
  { role: 'OWNER', label: 'Patron', email: 'patron@kasam360.com', pass: 'admin123' },
  { role: 'MANAGER', label: 'Müdür', email: 'mudur@kasam360.com', pass: 'admin123' },
  { role: 'CASHIER', label: 'Kasiyer', email: 'kasiyer@kasam360.com', pass: 'admin123' },
  { role: 'WAITER', label: 'Garson', email: 'garson@kasam360.com', pass: 'admin123' },
  { role: 'KITCHEN', label: 'Mutfak', email: 'mutfak@kasam360.com', pass: 'admin123' },
];

/**
 * Apple iOS/macOS Spatial Frosted Glass Kurumsal Giriş Ekranı (LoginPage).
 * LockPage (PinScreen) ile birebir aynı görsel estetik, zemin, cam kart ve tipografiyi kullanır;
 * mantık olarak ise tamamen bağımsız kimlik doğrulama (Kullanıcı Adı / E-posta + Şifre) yürütür.
 */
export function LoginPage(): JSX.Element {
  const [identifier, setIdentifier] = useState<string>(() => {
    try {
      return localStorage.getItem('kasam360_remembered_identifier') || '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [rememberMe, setRememberMe] = useState<boolean>(true);
  const [licenseKey, setLicenseKey] = useState<string>('');
  const [showLicenseField, setShowLicenseField] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [showDevRoles, setShowDevRoles] = useState<boolean>(false);

  const loginWithCredentials = useAuthStore((state) => state.loginWithCredentials);

  // Form gönderimi ve kimlik doğrulama
  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier) {
      setError('Kullanıcı adı veya e-posta boş bırakılamaz.');
      return;
    }
    if (!password) {
      setError('Şifre boş bırakılamaz.');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      if (rememberMe) {
        try {
          localStorage.setItem('kasam360_remembered_identifier', trimmedIdentifier);
        } catch {
          // localStorage erişilemezse devam et
        }
      } else {
        try {
          localStorage.removeItem('kasam360_remembered_identifier');
        } catch {
          // localStorage erişilemezse devam et
        }
      }
      await loginWithCredentials(trimmedIdentifier, password, licenseKey.trim() || undefined);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Giriş başarısız. Bilgilerinizi kontrol edin.');
    } finally {
      setIsLoading(false);
    }
  };

  // Hızlı test kullanıcısı seçildiğinde formu doldur
  const handleQuickRole = (roleItem: typeof QUICK_ROLES[0]) => {
    setIdentifier(roleItem.email);
    setPassword(roleItem.pass);
    setError('');
    setShowDevRoles(false);
  };

  // Apple spatial yumuşak kenarlı cam input stili
  const inputClass =
    'w-full bg-white/[0.05] border border-white/10 rounded-2xl text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#007AFF] focus:bg-white/[0.08] transition-all duration-200 py-3.5';

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-[#060609] p-4 select-none overflow-hidden">
      {/* Arka planda soft Apple ışık atmosferi — LockPage ile birebir aynı */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-blue-600/[0.08] rounded-full blur-[130px] pointer-events-none" />

      {/* Geliştirici Hızlı Test Menüsü (Sağ Üst Köşede Minimalist İkon) */}
      <div className="absolute top-6 right-6 z-50">
        <button
          type="button"
          onClick={() => setShowDevRoles(!showDevRoles)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-white/50 hover:text-white text-xs transition-all active:scale-95 cursor-pointer"
          title="Test Rolleri"
        >
          <Shield size={13} />
          <span className="text-[11px] font-medium">Test Rolleri</span>
        </button>

        {showDevRoles && (
          <div className="absolute right-0 mt-2 w-52 rounded-2xl backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/[0.08] p-2 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
            <div className="text-[10px] font-semibold dark:text-white/40 text-zinc-500 uppercase px-2 py-1 tracking-wider">
              Hızlı Doldur
            </div>
            <div className="space-y-1 mt-1">
              {QUICK_ROLES.map((u) => (
                <button
                  key={u.role}
                  type="button"
                  onClick={() => handleQuickRole(u)}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl dark:hover:bg-white/10 hover:bg-black/[0.05] dark:text-white/90 text-zinc-800 text-xs transition-colors cursor-pointer text-left"
                >
                  <span className="font-medium">{u.label}</span>
                  <span className="font-mono dark:text-white/40 text-zinc-400 text-[10px] truncate max-w-[100px]">{u.email}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Ana Bağımsız Yüzen Cam Kart — LockPage ile birebir aynı spatial tasarım */}
      <div className="relative z-10 flex w-full max-w-[400px] flex-col items-center rounded-3xl backdrop-blur-2xl bg-white/[0.04] border border-white/10 shadow-[0_16px_50px_rgba(0,0,0,0.5)] p-8 sm:p-9 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Kilit / Giriş Rozeti — LockPage ile birebir aynı rozet yapısı */}
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.08] border border-white/10 backdrop-blur-xl text-white shadow-xl">
          {isLoading ? (
            <Loader2 className="animate-spin text-white/70" size={24} />
          ) : (
            <Lock size={22} className="stroke-[1.75]" />
          )}
        </div>

        {/* Başlık ve Alt Açıklama */}
        <h1 className="text-xl font-medium tracking-tight text-white mb-1">
          KASAM<span className="text-[#007AFF]">360</span>
        </h1>
        <p className="text-xs text-white/50 mb-6">
          Kurumsal Yönetici & Personel Girişi
        </p>

        {/* Hata Bildirimi */}
        {error && (
          <div className="w-full mb-5 flex items-start gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3.5 py-2.5 rounded-2xl animate-in fade-in">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {/* Kimlik Bilgisi Giriş Formu */}
        <form onSubmit={handleLogin} className="w-full space-y-4">
          {/* E-Posta / Kullanıcı Adı */}
          <div>
            <label className="block text-[11px] font-semibold text-white/50 uppercase tracking-wider mb-1.5 pl-1">
              Kullanıcı Adı veya E-Posta
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-white/30">
                <Mail size={16} />
              </div>
              <input
                type="text"
                required
                autoFocus
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="admin@kasam360.com"
                className={`${inputClass} pl-11 pr-4`}
              />
            </div>
          </div>

          {/* Şifre */}
          <div>
            <label className="block text-[11px] font-semibold text-white/50 uppercase tracking-wider mb-1.5 pl-1">
              Şifre
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-white/30">
                <Lock size={16} />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={`${inputClass} pl-11 pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-white/35 hover:text-white/80 transition-colors cursor-pointer"
                tabIndex={-1}
                title={showPassword ? 'Şifreyi Gizle' : 'Şifreyi Göster'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Lisans Anahtarı — Opsiyonel Toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowLicenseField(!showLicenseField)}
              className="text-[11px] font-medium text-white/40 hover:text-white/80 transition-colors cursor-pointer pl-1 py-1"
            >
              {showLicenseField ? '— Lisans Anahtarını Gizle' : '+ Lisans Anahtarı Ekle (İlk Kurulum)'}
            </button>
            {showLicenseField && (
              <div className="relative mt-1.5 animate-in fade-in duration-150">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-white/30">
                  <KeyRound size={16} />
                </div>
                <input
                  type="text"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                  placeholder="K360-XXXX-YYYY-ZZZZ"
                  className={`${inputClass} pl-11 pr-4 font-mono tracking-wider`}
                />
              </div>
            )}
          </div>

          {/* Beni Hatırla Seçeneği */}
          <div className="flex items-center justify-between pt-1 pl-1">
            <label className="flex items-center gap-2.5 cursor-pointer select-none text-xs text-white/60 hover:text-white/90 transition-colors">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded-md border-white/20 bg-white/10 text-[#007AFF] focus:ring-0 focus:ring-offset-0 transition-all cursor-pointer"
              />
              <span>Beni Hatırla</span>
            </label>
          </div>

          {/* Giriş Yap Butonu — Renksiz Apple Lüks Cam Buton */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-3 py-4 px-5 rounded-2xl bg-white/[0.12] hover:bg-white/[0.20] active:bg-white/[0.25] text-white font-semibold text-sm border border-white/15 backdrop-blur-xl shadow-lg transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none cursor-pointer flex items-center justify-center gap-2 group"
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin text-white/70" size={16} />
                <span>Giriş Yapılıyor...</span>
              </>
            ) : (
              <>
                <span>Giriş Yap</span>
                <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform text-white/70" />
              </>
            )}
          </button>
        </form>

        {/* Alt Bilgi */}
        <p className="mt-8 text-center text-[11px] text-white/30">
          Terminal kilitlendiğinde veya oturum açıkken PIN ile hızlı kilit açılır.
        </p>
      </div>
    </div>
  );
}