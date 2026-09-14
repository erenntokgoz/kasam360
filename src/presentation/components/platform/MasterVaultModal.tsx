import React, { useState } from 'react';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import {
  ShieldAlert,
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

  const [showPassword, setShowPassword] = useState(false);
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
      setShowPassword(true);
      showActionFeedback('Şifre sıfırlandı. Yeni şifreyi kopyalamayı unutmayın.');
    } catch (err: unknown) {
      showActionFeedback(err instanceof Error ? err.message : 'Şifre sıfırlama başarısız.', true);
    } finally {
      setResettingPassword(false);
    }
  };

  const handleChangePin = async () => {
    if (!credentials || !newPinInput.trim()) return;
    if (!/^\d{4,6}$/.test(newPinInput.trim())) {
      showActionFeedback('PIN 4-6 haneli sayısal olmalıdır.', true);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150 text-left">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl border ${isUnlocked ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' : 'bg-purple-500/20 border-purple-500/30 text-purple-400'}`}>
              {isUnlocked ? <Unlock size={22} /> : <Lock size={22} />}
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Güvenlik Kasası (Master Vault)
              </h3>
              <p className="text-xs text-slate-400">
                {user.name} ({user.id}) erişim anahtarları
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto max-h-[80vh]">
          {!isUnlocked ? (
            <form onSubmit={handleUnlock} className="space-y-4">
              <div className="p-3.5 rounded-xl bg-purple-950/30 border border-purple-800/40 text-purple-200 text-xs flex items-start gap-2.5">
                <ShieldAlert size={18} className="text-purple-400 shrink-0 mt-0.5" />
                <span>
                  Bu kullanıcının e-posta, şifre ve lisans anahtarını görüntülemek için Super Admin güvenlik parolanızı doğrulamanız gerekmektedir.
                </span>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-950/60 border border-red-800 text-red-300 text-xs flex items-center gap-2">
                  <AlertCircle size={16} className="text-red-400 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Super Admin Güvenlik Parolası *
                </label>
                <div className="relative">
                  <input
                    type="password"
                    autoFocus
                    required
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="Parola giriniz (örn: 3736)"
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm font-mono tracking-wider focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition-colors"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !passcode.trim()}
                  className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold transition-all shadow-lg disabled:opacity-50"
                >
                  {isLoading ? 'Doğrulanıyor...' : 'Kilidi Aç & Göster'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 flex items-center gap-2">
                <Unlock size={16} className="text-emerald-400 shrink-0" />
                <span>Kasa kilidi başarıyla açıldı. Bilgileri görüntüleyebilir ve yönetebilirsiniz.</span>
              </div>

              {/* Action feedback */}
              {actionSuccess && (
                <div className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-700 text-emerald-300 text-xs flex items-center gap-2">
                  <Check size={14} className="text-emerald-400 shrink-0" />
                  <span>{actionSuccess}</span>
                </div>
              )}
              {actionError && (
                <div className="p-3 rounded-lg bg-red-950/60 border border-red-800 text-red-300 text-xs flex items-center gap-2">
                  <AlertCircle size={14} className="text-red-400 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Email */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-1">
                <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <Mail size={13} className="text-blue-400" />
                  Giriş E-posta Adresi
                </span>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-white select-all">
                    {credentials?.email || 'Belirtilmedi'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy('email', credentials?.email)}
                    className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                    title="Kopyala"
                  >
                    {copiedField === 'email' ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>

              {/* Password */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <KeyRound size={13} className="text-amber-400" />
                  Giriş Şifresi
                </span>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-amber-300 select-all">
                    {showPassword ? credentials?.password : '••••••••••••'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                      title={showPassword ? 'Gizle' : 'Göster'}
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy('password', credentials?.password)}
                      className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                      title="Kopyala"
                    >
                      {copiedField === 'password' ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
                {/* Reset password action */}
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={resettingPassword}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-950/50 hover:bg-amber-900/60 border border-amber-700/50 text-amber-300 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-50"
                >
                  <RotateCcw size={12} className={resettingPassword ? 'animate-spin' : ''} />
                  {resettingPassword ? 'Sıfırlanıyor...' : 'Şifreyi Sıfırla (Otomatik Üret)'}
                </button>
              </div>

              {/* PIN Code */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <Lock size={13} className="text-purple-400" />
                  Hızlı Terminal PIN Kodu
                </span>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-purple-300 font-bold tracking-widest select-all">
                    {showPin ? credentials?.pin : '••••'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                      title={showPin ? 'Gizle' : 'Göster'}
                    >
                      {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy('pin', credentials?.pin)}
                      className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                      title="Kopyala"
                    >
                      {copiedField === 'pin' ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
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
                      className="flex-1 bg-slate-950 border border-purple-600 text-purple-300 font-mono rounded-lg px-3 py-1.5 text-xs tracking-widest text-center focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleChangePin}
                      disabled={changingPin || newPinInput.length < 4}
                      className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white rounded-lg text-[11px] font-semibold disabled:opacity-50 transition-colors"
                    >
                      {changingPin ? <RefreshCw size={12} className="animate-spin" /> : 'Kaydet'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setPinEditMode(false); setNewPinInput(''); }}
                      className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-[11px] transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPinEditMode(true)}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-purple-950/50 hover:bg-purple-900/60 border border-purple-700/50 text-purple-300 rounded-lg text-[11px] font-medium transition-colors"
                  >
                    <Hash size={12} />
                    PIN'i Değiştir
                  </button>
                )}
              </div>

              {/* License Key */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <KeyRound size={13} className="text-cyan-400" />
                  Lisans / API Anahtarı
                </span>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-cyan-300 select-all break-all">
                    {credentials?.licenseKey || 'K360-DEFAULT-KEY'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy('licenseKey', credentials?.licenseKey)}
                    className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors shrink-0"
                    title="Kopyala"
                  >
                    {copiedField === 'licenseKey' ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  </button>
                </div>
                {/* Regenerate key action */}
                <button
                  type="button"
                  onClick={handleRegenerateKey}
                  disabled={regeneratingKey}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-cyan-950/50 hover:bg-cyan-900/60 border border-cyan-700/50 text-cyan-300 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={12} className={regeneratingKey ? 'animate-spin' : ''} />
                  {regeneratingKey ? 'Yenileniyor...' : 'Lisans Anahtarını Yenile (K360-XXXX-YYYY-ZZZZ)'}
                </button>
              </div>

              <div className="flex justify-end pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-colors"
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
