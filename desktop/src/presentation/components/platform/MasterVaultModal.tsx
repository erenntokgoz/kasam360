import React, { useState } from 'react';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import {
  KeyRound,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Copy,
  Check,
  X,
  Mail,
  AlertCircle,
  RefreshCw,
  RotateCcw,
  Hash,
} from 'lucide-react';

export interface VaultStaffUser {
  id: string;
  name: string;
  role: string;
  tenant_id?: string;
  tenantId?: string;
}

interface MasterVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: VaultStaffUser | null;
}

interface VaultCredentials {
  userId: string;
  name: string;
  role: string;
  email: string;
  password?: string;
  pin?: string;
  licenseKey?: string;
}

export function MasterVaultModal({ isOpen, onClose, user }: MasterVaultModalProps) {
  const [passcode, setPasscode] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<VaultCredentials | null>(null);

  const [showPin, setShowPin] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Credential management state
  const [resettingPassword, setResettingPassword] = useState(false);
  const [changingPin, setChangingPin] = useState(false);
  const [regeneratingKey, setRegeneratingKey] = useState(false);
  const [pinEditMode, setPinEditMode] = useState(false);
  const [newPinInput, setNewPinInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  if (!isOpen || !user) return null;

  const handleCopy = (field: string, val?: string) => {
    if (!val) return;
    navigator.clipboard.writeText(val);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const data = await tauriInvoke<VaultCredentials>('get_user_credentials', {
        userId: user.id,
        authKey: passcode.trim(),
      });
      setCredentials(data);
      setIsUnlocked(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Yetkisiz erişim: Güvenlik parolası geçersiz!');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setPasscode('');
    setIsUnlocked(false);
    setError(null);
    setCredentials(null);
    setActionError(null);
    setActionSuccess(null);
    setPinEditMode(false);
    setNewPinInput('');
    onClose();
  };

  const showActionFeedback = (msg: string, isError = false) => {
    if (isError) {
      setActionError(msg);
      setActionSuccess(null);
    } else {
      setActionSuccess(msg);
      setActionError(null);
    }
    setTimeout(() => {
      setActionError(null);
      setActionSuccess(null);
    }, 4000);
  };

  const handleResetPassword = async () => {
    if (!credentials) return;
    setResettingPassword(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const result = await tauriInvoke<{ user_id: string; new_password: string }>('reset_user_password', {
        user_id: user.id,
      });
      setCredentials(prev => prev ? { ...prev, password: result.new_password } : prev);
      showActionFeedback('Şifre sıfırlandı. Yeni şifreyi kopyalamayı unutmayın.');
    } catch (err: unknown) {
      showActionFeedback(err instanceof Error ? err.message : 'Şifre sıfırlama başarısız.', true);
    } finally {
      setResettingPassword(false);
    }
  };

  const handleChangePin = async () => {
    if (!credentials || !newPinInput.trim()) return;
    if (!/^\d{4,8}$/.test(newPinInput.trim())) {
      showActionFeedback('PIN 4-8 haneli sayısal olmalıdır.', true);
      return;
    }
    setChangingPin(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await tauriInvoke<{ success: boolean; new_pin: string }>('change_user_pin', {
        user_id: user.id,
        new_pin: newPinInput.trim(),
      });
      setCredentials(prev => prev ? { ...prev, pin: newPinInput.trim() } : prev);
      setPinEditMode(false);
      setNewPinInput('');
      setShowPin(true);
      showActionFeedback('PIN başarıyla değiştirildi.');
    } catch (err: unknown) {
      showActionFeedback(err instanceof Error ? err.message : 'PIN değiştirme başarısız.', true);
    } finally {
      setChangingPin(false);
    }
  };

  const handleRegenerateKey = async () => {
    if (!credentials) return;
    setRegeneratingKey(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const result = await tauriInvoke<{ user_id: string; new_key: string }>('regenerate_license_key', {
        user_id: user.id,
      });
      setCredentials(prev => prev ? { ...prev, licenseKey: result.new_key } : prev);
      showActionFeedback('Lisans anahtarı yenilendi.');
    } catch (err: unknown) {
      showActionFeedback(err instanceof Error ? err.message : 'Lisans anahtarı yenileme başarısız.', true);
    } finally {
      setRegeneratingKey(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-2xl p-4 animate-in fade-in duration-150 text-left">
      <div className="backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-5 border-b dark:border-white/10 border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.02] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-2xl border ${isUnlocked ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-500' : 'bg-purple-500/15 border-purple-500/30 text-purple-500'}`}>
              {isUnlocked ? <Unlock size={22} /> : <Lock size={22} />}
            </div>
            <div>
              <h3 className="text-base font-bold dark:text-white text-zinc-900 flex items-center gap-2">
                Güvenlik Kasası (Master Vault)
              </h3>
              <p className="text-xs dark:text-zinc-400 text-zinc-500">
                {user.name} ({user.id}) erişim anahtarları
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-full text-zinc-400 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/10 hover:bg-black/5 transition-all cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto max-h-[80vh]">
          {!isUnlocked ? (
            <form onSubmit={handleUnlock} className="space-y-4">
              {error && (
                <div className="p-3 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-500 text-xs flex items-center gap-2">
                  <AlertCircle size={16} className="text-red-500 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 mb-1.5">
                  Super Admin Güvenlik Parolası *
                </label>
                <div className="relative">
                  <input
                    type="password"
                    autoFocus
                    required
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="Güvenlik parolanızı giriniz"
                    className="w-full dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 rounded-2xl px-4 py-2.5 text-sm font-mono tracking-wider focus:outline-none focus:border-[#007AFF]/50"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t dark:border-white/10 border-black/[0.08]">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-zinc-300 text-zinc-700 rounded-2xl text-xs font-semibold transition-all cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !passcode.trim()}
                  className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-2xl text-xs font-semibold transition-all shadow-lg shadow-purple-500/25 disabled:opacity-50 cursor-pointer"
                >
                  {isLoading ? 'Doğrulanıyor...' : 'Kilidi Aç & Göster'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4 text-xs">

              {/* Action feedback */}
              {actionSuccess && (
                <div className="p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 text-xs flex items-center gap-2">
                  <Check size={14} className="text-emerald-500 shrink-0" />
                  <span>{actionSuccess}</span>
                </div>
              )}
              {actionError && (
                <div className="p-3 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-500 text-xs flex items-center gap-2">
                  <AlertCircle size={14} className="text-red-500 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Email */}
              <div className="rounded-2xl dark:bg-white/[0.04] bg-white border dark:border-white/10 border-black/[0.08] p-3.5 space-y-1 shadow-sm">
                <span className="text-[11px] dark:text-zinc-400 text-zinc-500 flex items-center gap-1.5">
                  <Mail size={13} className="text-blue-500" />
                  Giriş E-posta Adresi
                </span>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm dark:text-white text-zinc-900 select-all font-semibold">
                    {credentials?.email || 'Belirtilmedi'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy('email', credentials?.email)}
                    className="p-1.5 text-zinc-400 hover:dark:text-white hover:text-zinc-900 rounded-full hover:dark:bg-white/10 hover:bg-black/5 transition-all cursor-pointer"
                    title="Kopyala"
                  >
                    {copiedField === 'email' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>

              {/* Password */}
              <div className="rounded-2xl dark:bg-white/[0.04] bg-white border dark:border-white/10 border-black/[0.08] p-3.5 space-y-2 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] dark:text-zinc-400 text-zinc-500 flex items-center gap-1.5">
                    <KeyRound size={13} className="text-amber-500" />
                    Giriş Şifresi
                  </span>
                  {credentials?.password && credentials.password !== '••••••••' ? (
                    <span className="text-[10px] bg-amber-500/15 text-amber-500 border border-amber-500/30 px-2 py-0.5 rounded-full font-medium">
                      Yeni Üretilen Şifre
                    </span>
                  ) : (
                    <span className="text-[10px] dark:bg-white/10 bg-black/[0.05] dark:text-zinc-400 text-zinc-600 border dark:border-white/10 border-black/[0.08] px-2 py-0.5 rounded-full font-mono">
                      Argon2 Korumalı
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-amber-500 select-all font-semibold">
                    {credentials?.password && credentials.password !== '••••••••'
                      ? credentials.password
                      : '••••••••••••'}
                  </span>
                  <div className="flex items-center gap-1">
                    {credentials?.password && credentials.password !== '••••••••' && (
                      <button
                        type="button"
                        onClick={() => handleCopy('password', credentials?.password)}
                        className="p-1.5 text-zinc-400 hover:dark:text-white hover:text-zinc-900 rounded-full hover:dark:bg-white/10 hover:bg-black/5 transition-all cursor-pointer"
                        title="Yeni Şifreyi Kopyala"
                      >
                        {copiedField === 'password' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Reset password action */}
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={resettingPassword}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-600 dark:text-amber-400 rounded-2xl text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw size={12} className={resettingPassword ? 'animate-spin' : ''} />
                  {resettingPassword ? 'Sıfırlanıyor...' : 'Yeni Giriş Şifresi Oluştur'}
                </button>
              </div>

              {/* PIN Code */}
              <div className="rounded-2xl dark:bg-white/[0.04] bg-white border dark:border-white/10 border-black/[0.08] p-3.5 space-y-2 shadow-sm">
                <span className="text-[11px] dark:text-zinc-400 text-zinc-500 flex items-center gap-1.5">
                  <Lock size={13} className="text-purple-500" />
                  Hızlı Terminal PIN Kodu
                </span>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-purple-600 dark:text-purple-400 font-bold tracking-widest select-all">
                    {showPin ? credentials?.pin : '••••'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="p-1.5 text-zinc-400 hover:dark:text-white hover:text-zinc-900 rounded-full hover:dark:bg-white/10 hover:bg-black/5 transition-all cursor-pointer"
                      title={showPin ? 'Gizle' : 'Göster'}
                    >
                      {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy('pin', credentials?.pin)}
                      className="p-1.5 text-zinc-400 hover:dark:text-white hover:text-zinc-900 rounded-full hover:dark:bg-white/10 hover:bg-black/5 transition-all cursor-pointer"
                      title="Kopyala"
                    >
                      {copiedField === 'pin' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
                {/* Change PIN action */}
                {pinEditMode ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      autoFocus
                      value={newPinInput}
                      onChange={(e) => setNewPinInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="Yeni PIN (4-6 rakam)"
                      className="flex-1 dark:bg-white/[0.05] bg-black/[0.03] border border-purple-500 text-purple-600 dark:text-purple-300 font-mono rounded-2xl px-3 py-1.5 text-xs tracking-widest text-center focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleChangePin}
                      disabled={changingPin || newPinInput.length < 4}
                      className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-2xl text-[11px] font-semibold disabled:opacity-50 transition-all cursor-pointer"
                    >
                      {changingPin ? <RefreshCw size={12} className="animate-spin" /> : 'Kaydet'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setPinEditMode(false); setNewPinInput(''); }}
                      className="p-2 dark:bg-white/[0.08] bg-black/[0.05] text-zinc-400 hover:dark:text-white hover:text-zinc-900 rounded-2xl transition-all cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPinEditMode(true)}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-600 dark:text-purple-400 rounded-2xl text-[11px] font-semibold transition-all cursor-pointer"
                  >
                    <Hash size={12} />
                    PIN'i Değiştir
                  </button>
                )}
              </div>

              {/* License Key */}
              <div className="rounded-2xl dark:bg-white/[0.04] bg-white border dark:border-white/10 border-black/[0.08] p-3.5 space-y-2 shadow-sm">
                <span className="text-[11px] dark:text-zinc-400 text-zinc-500 flex items-center gap-1.5">
                  <KeyRound size={13} className="text-cyan-500" />
                  Lisans / API Anahtarı
                </span>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-cyan-600 dark:text-cyan-400 select-all break-all font-semibold">
                    {credentials?.licenseKey || 'K360-DEFAULT-KEY'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy('licenseKey', credentials?.licenseKey)}
                    className="p-1.5 text-zinc-400 hover:dark:text-white hover:text-zinc-900 rounded-full hover:dark:bg-white/10 hover:bg-black/5 transition-all shrink-0 cursor-pointer"
                    title="Kopyala"
                  >
                    {copiedField === 'licenseKey' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                  </button>
                </div>
                {/* Regenerate key action */}
                <button
                  type="button"
                  onClick={handleRegenerateKey}
                  disabled={regeneratingKey}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-600 dark:text-cyan-400 rounded-2xl text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw size={12} className={regeneratingKey ? 'animate-spin' : ''} />
                  {regeneratingKey ? 'Yenileniyor...' : 'Lisans Anahtarını Yenile (K360-XXXX-YYYY-ZZZZ)'}
                </button>
              </div>

              <div className="flex justify-end pt-3 border-t dark:border-white/10 border-black/[0.08]">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-5 py-2 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-zinc-300 text-zinc-700 rounded-2xl text-xs font-semibold transition-all cursor-pointer"
                >
                  Tamam & Kapat
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
