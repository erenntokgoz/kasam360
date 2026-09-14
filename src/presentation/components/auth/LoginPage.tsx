import React, { useState } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { PinScreen } from './PinScreen';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Building2,
  Terminal,
  Cpu,
  Layers,
  ChevronRight,
  LucideIcon
} from 'lucide-react';

interface QuickRole {
  role: string;
  label: string;
  email: string;
  pass: string;
  desc: string;
  badge: string;
  color: string;
  icon: LucideIcon;
}

const QUICK_ROLES: QuickRole[] = [
  {
    role: 'MASTER',
    label: 'Master Admin',
    email: 'admin@kasam360.com',
    pass: 'admin123',
    desc: 'Platform Yönetimi & Lisans',
    badge: 'SaaS Platform',
    color: 'from-purple-500/20 to-indigo-500/20 border-purple-500/40 text-purple-300 hover:border-purple-400',
    icon: Terminal,
  },
];

export function LoginPage(): JSX.Element {
  const [identifier, setIdentifier] = useState<string>('admin@kasam360.com');
  const [password, setPassword] = useState<string>('admin123');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [rememberMe, setRememberMe] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [showPinMode, setShowPinMode] = useState<boolean>(false);
  const [licenseKey, setLicenseKey] = useState<string>('');
  const [showLicenseKey, setShowLicenseKey] = useState<boolean>(false);

  const loginWithCredentials = useAuthStore((state) => state.loginWithCredentials);

  // If user explicitly chooses PIN mode fallback:
  if (showPinMode) {
    return (
      <div className="relative min-h-screen w-full">
        {/* Button to switch back to Email/Password login */}
        <div className="absolute top-6 left-6 z-50">
          <button
            type="button"
            onClick={() => setShowPinMode(false)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 text-sm font-medium transition-all shadow-lg backdrop-blur-md cursor-pointer"
          >
            <Mail size={16} className="text-blue-400" />
            <span>← E-posta & Şifre ile Giriş Yap</span>
          </button>
        </div>
        <PinScreen />
      </div>
    );
  }

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!identifier.trim()) {
      setError('Lütfen e-posta adresinizi veya kullanıcı adınızı girin.');
      return;
    }
    if (!password) {
      setError('Lütfen şifrenizi girin.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await loginWithCredentials(identifier, password, licenseKey || undefined);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Giriş yapılamadı. Bilgilerinizi kontrol edin.');
    } finally {
      setIsLoading(false);
    }
  };

  const applyQuickRole = (roleItem: QuickRole) => {
    setIdentifier(roleItem.email);
    setPassword(roleItem.pass);
    setError('');
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-slate-950 text-slate-100 overflow-x-hidden selection:bg-blue-600 selection:text-white">
      {/* Dynamic Background Glow Effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-blue-600/15 rounded-full blur-[140px] animate-pulse" />
        <div className="absolute top-1/3 -right-40 w-[550px] h-[550px] bg-indigo-600/15 rounded-full blur-[150px]" />
        <div className="absolute -bottom-40 left-1/3 w-[600px] h-[600px] bg-emerald-600/10 rounded-full blur-[160px]" />
        {/* Subtle grid pattern overlay */}
        <div 
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize: '36px 36px',
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-5xl mx-auto px-4 py-8 flex flex-col items-center">
        {/* Top Header Badge */}
        <div className="mb-6 flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-slate-900/80 border border-slate-800 backdrop-blur-md shadow-inner text-xs text-slate-300">
          <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="font-semibold text-white tracking-wide">KASAM360 CORE v2.4</span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400 flex items-center gap-1">
            <Building2 size={13} className="text-blue-400" /> Kurumsal Bulut POS & Yönetim
          </span>
        </div>

        {/* Main Card Grid */}
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          
          {/* Left / Info & Branding Column */}
          <div className="lg:col-span-5 flex flex-col justify-between p-8 rounded-3xl bg-slate-900/40 border border-slate-800/80 backdrop-blur-xl relative overflow-hidden">
            <div className="relative z-10">
              {/* Brand Logo */}
              <div className="flex items-center gap-3.5 mb-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-[0_0_25px_rgba(59,130,246,0.5)] border border-blue-400/30">
                  <Cpu className="text-white" size={26} />
                </div>
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-1.5">
                    KASAM<span className="text-blue-500">360</span>
                  </h1>
                  <p className="text-[11px] font-medium tracking-wide uppercase text-slate-400">
                    Restoran & Perakende İşletim Sistemi
                  </p>
                </div>
              </div>

              {/* Tagline */}
              <div className="space-y-3 mb-8">
                <h2 className="text-xl font-bold text-white leading-snug">
                  Yeni Nesil Restoran, Kasa ve Bulut Yönetim Mimarisi
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Tek tıkla merkezi platforma, şube kasalarına veya mutfak KDS ekranlarına güvenle bağlanın.
                </p>
              </div>

              {/* Feature Highlights */}
              <div className="space-y-3 mb-8">
                <div className="flex items-center gap-3 text-xs text-slate-300">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
                    <ShieldCheck size={14} />
                  </div>
                  <span>Uçtan Uca SHA-256 Korumalı & İmmutable Mimari</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-300">
                  <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
                    <Layers size={14} />
                  </div>
                  <span>Çoklu Şube & Masaüstü Çevrimdışı (Offline) Desteği</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-300">
                  <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shrink-0">
                    <CheckCircle2 size={14} />
                  </div>
                  <span>Gerçek Zamanlı Mutfak KDS & Hızlı Kasa Masası</span>
                </div>
              </div>
            </div>

            {/* Bottom Quick Switch Note */}
            <div className="relative z-10 pt-6 border-t border-slate-800/80">
              <div className="flex flex-col gap-3">
                <div>
                  <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <KeyRound size={12} className="text-blue-400" />
                    Günlük Personel Girişi
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Garson/Kasiyer PIN kodu ile hızlı giriş
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPinMode(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-gradient-to-r from-blue-600/20 to-indigo-600/20 hover:from-blue-600/30 hover:to-indigo-600/30 text-blue-300 hover:text-blue-200 border border-blue-500/40 hover:border-blue-400/60 text-sm font-bold transition-all group shadow-sm cursor-pointer"
                >
                  <KeyRound size={16} className="group-hover:rotate-12 transition-transform" />
                  <span>PIN ile Giriş Yap</span>
                  <ChevronRight size={16} className="ml-auto group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            </div>
          </div>

          {/* Right / Login Form Column */}
          <div className="lg:col-span-7 flex flex-col justify-between p-8 sm:p-10 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-[0_25px_60px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
            <div>
              {/* Form Heading */}
              <div className="mb-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-bold text-white tracking-tight">Oturum Açın</h3>
                  <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    Güvenli Giriş
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  KASAM360 hesabınızın e-posta ve şifresiyle sisteme erişin.
                </p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="mb-5 flex items-start gap-2.5 p-3 rounded-2xl bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs animate-in fade-in slide-in-from-top-1">
                  <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
                  <span className="font-medium">{error}</span>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleLogin} className="space-y-4">
                {/* Identifier Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    E-Posta / Kullanıcı Adı
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500 group-focus-within:text-blue-400 transition-colors">
                      <Mail size={17} />
                    </div>
                    <input
                      type="text"
                      required
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="admin@kasam360.com veya kullanıcı adı"
                      className="w-full pl-10 pr-4 py-3 bg-slate-950/80 border border-slate-800 rounded-2xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                    />
                  </div>
                </div>

                {/* Password Input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-300">
                      Şifre
                    </label>
                    <button
                      type="button"
                      onClick={() => alert('Şifrenizi unuttuysanız sistem yöneticiniz (Master Admin) ile iletişime geçebilirsiniz.')}
                      className="text-[11px] font-medium text-blue-400 hover:text-blue-300 transition-colors cursor-pointer bg-transparent border-none p-0"
                    >
                      Şifremi Unuttum?
                    </button>
                  </div>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500 group-focus-within:text-blue-400 transition-colors">
                      <Lock size={17} />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-11 py-3 bg-slate-950/80 border border-slate-800 rounded-2xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                      tabIndex={-1}
                      title={showPassword ? 'Şifreyi Gizle' : 'Şifreyi Göster'}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>

                {/* License Key - Opsiyonel */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-300">
                      Lisans Anahtarı <span className="text-slate-500 font-normal">(Opsiyonel - İlk Kurulum)</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowLicenseKey(!showLicenseKey)}
                      className="text-[11px] font-medium text-slate-400 hover:text-slate-300 transition-colors cursor-pointer bg-transparent border-none p-0"
                    >
                      {showLicenseKey ? 'Gizle' : 'Lisans Anahtarı Var mı?'}
                    </button>
                  </div>
                  {showLicenseKey && (
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500 group-focus-within:text-blue-400 transition-colors">
                        <KeyRound size={17} />
                      </div>
                      <input
                        type="text"
                        value={licenseKey}
                        onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                        placeholder="K360-XXXX-YYYY-ZZZZ"
                        className="w-full pl-10 pr-4 py-3 bg-slate-950/80 border border-slate-800 rounded-2xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all font-mono tracking-widest"
                      />
                    </div>
                  )}
                </div>

                {/* Remember Me */}
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="h-4 w-4 rounded-md border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500/40 focus:ring-offset-slate-900 transition-all"
                    />
                    <span>Beni Hatırla (Bu cihazda oturumu açık tut)</span>
                  </label>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full mt-2 py-3.5 px-5 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-[0_10px_25px_rgba(37,99,235,0.4)] hover:shadow-[0_12px_30px_rgba(37,99,235,0.6)] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 group cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Doğrulanıyor...</span>
                    </>
                  ) : (
                    <>
                      <span>Giriş Yap</span>
                      <ArrowRight size={17} className="group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Quick Fill / Developer & Test Helpers */}
            <div className="mt-8 pt-5 border-t border-slate-800">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <Sparkles size={13} className="text-amber-400" />
                  <span>Hızlı Test Rol Doldurucu</span>
                </div>
                <span className="text-[10px] text-slate-500 font-medium">tek tıkla doldur</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {QUICK_ROLES.map((roleItem) => {
                  const Icon = roleItem.icon;
                  const isSelected = identifier === roleItem.email;
                  return (
                    <button
                      key={roleItem.role}
                      type="button"
                      onClick={() => applyQuickRole(roleItem)}
                      className={`flex flex-col text-left p-2.5 rounded-xl border bg-gradient-to-b transition-all duration-150 cursor-pointer ${
                        isSelected
                          ? 'border-blue-400/80 bg-blue-950/40 shadow-[0_0_12px_rgba(59,130,246,0.2)]'
                          : 'border-slate-800/80 bg-slate-950/50 hover:bg-slate-800/50 hover:border-slate-700'
                      }`}
                      title={`${roleItem.label} - ${roleItem.email}`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="flex items-center gap-1 text-xs font-semibold text-white truncate">
                          <Icon size={12} className={isSelected ? 'text-blue-400' : 'text-slate-400'} />
                          {roleItem.label}
                        </span>
                        <ChevronRight size={11} className="text-slate-500 shrink-0" />
                      </div>
                      <span className="text-[10px] text-slate-400 truncate">{roleItem.email}</span>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

        </div>

        {/* Footer info */}
        <div className="mt-8 text-center text-xs text-slate-600">
          © {new Date().getFullYear()} KASAM360 Bulut Restoran Teknolojileri. Tüm hakları saklıdır.
        </div>
      </div>
    </div>
  );
}