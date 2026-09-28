import React, { useState, useEffect, useRef } from 'react';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import {
  Building2,
  X,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  RotateCcw,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronLeft,
  Shield,
  Layers,
  Laptop,
  Lock,
} from 'lucide-react';
import { AppleButton } from '../common/AppleButton';

export interface PlatformSetupWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => Promise<void> | void;
}

// Kullanılabilir KASAM360 restoran yönetim modülleri
export const AVAILABLE_MODULES = [
  { id: 'core', name: 'Temel Restoran Yönetimi', desc: 'Siparişler, masalar, mutfak KDS.', isRequired: true },
  { id: 'inventory', name: 'Stok & Reçete Modülü', desc: 'FIFO maliyet, reçete, stok sayımı.', isRequired: false },
  { id: 'delivery', name: 'Kurye & Paket Servis', desc: 'Paket sipariş, kurye atama ve takip.', isRequired: false },
  { id: 'qr_menu', name: 'QR Dijital Menü', desc: 'Masadan temassız sipariş ve dijital menü.', isRequired: false },
  { id: 'online_order', name: 'Yemeksepeti / Getir', desc: 'Harici sipariş platformları entegrasyonu.', isRequired: false },
  { id: 'pos_integrations', name: 'ÖKC & Harici POS', desc: 'Yazarkasa ve banka POS donanım desteği.', isRequired: false },
];

// Apple Setup Assistant adım yapılandırmaları
export const STEP_CONFIGS = [
  {
    step: 1,
    title: 'Şirket & Yasal Bilgiler',
    subtitle: 'KASAM360 üzerinde çalışacak işletmenin ticari kimlik bilgilerini girin.',
  },
  {
    step: 2,
    title: 'Şube & Donanım Kurulumu',
    subtitle: 'İlk şube konumunu ve ana kasa terminal donanım lisansını tanımlayın.',
  },
  {
    step: 3,
    title: 'Yönetici & Güvenlik',
    subtitle: 'İşletme sahibi için güvenli giriş kimliklerini ve dokunmatik POS PIN kodunu belirleyin.',
  },
  {
    step: 4,
    title: 'Modül & Paket Seçimi',
    subtitle: 'Restoranınızın ihtiyaç duyduğu ek yetenekleri ve deneme süresini yapılandırın.',
  },
  {
    step: 5,
    title: 'Kurulum Tamamlandı',
    subtitle: 'İşletme başarıyla sisteme kaydedildi ve kullanıma hazır.',
  },
];

/**
 * Apple Setup Assistant standartlarında tasarlanmış Platform & İşletme Kurulum Sihirbazı.
 * macOS/iPadOS ilk çalıştırma sihirbazı zarafetinde pürüzsüz adımlama noktaları, ferah input alanları,
 * buzlu cam estetiği ve minimalist butonlar sunar.
 */
export function PlatformSetupWizard({
  isOpen,
  onClose,
  onSuccess,
}: PlatformSetupWizardProps): JSX.Element | null {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedSlip, setCopiedSlip] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Kullanıcının yönetici alanlarını manuel düzenleyip düzenlemediği takibi
  const [isOwnerManuallyEdited, setIsOwnerManuallyEdited] = useState({
    name: false,
    email: false,
  });

  // Otomatik odaklama için girdi referansı
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Güvenli lisans anahtarı üretici (K360-XXXX-YYYY-ZZZZ)
  const generateLicenseKey = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `K360-${seg()}-${seg()}-${seg()}`;
  };

  // Rastgele güçlü şifre üretici
  const generateStrongPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
    return `Kasam-${Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')}`;
  };

  // 4 haneli rastgele sayısal PIN üretici
  const generatePin = () => {
    return String(Math.floor(1000 + Math.random() * 8999));
  };

  // Form durum yönetimi
  const [formData, setFormData] = useState({
    // Adım 1: Şirket & Yasal Bilgiler
    name: '',
    legalName: '',
    taxId: '',
    taxOffice: '',
    contactPerson: '',
    email: '',
    phone: '',
    address: '',

    // Adım 2: İlk Şube & Terminal Donanımı
    branchName: 'Merkez Şube',
    deviceName: 'Ana Kasa POS 1',
    licenseKey: generateLicenseKey(),

    // Adım 3: Yönetici Hesabı & Güvenlik
    ownerName: '',
    ownerEmail: '',
    ownerPassword: generateStrongPassword(),
    ownerPin: generatePin(),

    // Adım 4: Modül Paketleri & Onay
    modules: ['core'] as string[],
    isTrial: false,
  });

  // Modal her açıldığında form durumunu sıfırla
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setError(null);
      setCopiedSlip(false);
      setShowPassword(false);
      setIsOwnerManuallyEdited({ name: false, email: false });
      setFormData({
        name: '',
        legalName: '',
        taxId: '',
        taxOffice: '',
        contactPerson: '',
        email: '',
        phone: '',
        address: '',
        branchName: 'Merkez Şube',
        deviceName: 'Ana Kasa POS 1',
        licenseKey: generateLicenseKey(),
        ownerName: '',
        ownerEmail: '',
        ownerPassword: generateStrongPassword(),
        ownerPin: generatePin(),
        modules: ['core'],
        isTrial: false,
      });
    }
  }, [isOpen]);

  // Adım değiştiğinde ilk input alanına pürüzsüz odaklan
  useEffect(() => {
    if (isOpen && step < 5) {
      const timer = setTimeout(() => {
        if (firstInputRef.current) {
          firstInputRef.current.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [step, isOpen]);

  // Klavyeden Escape basıldığında modalı kapat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !loading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  // Adım 1 Doğrulama ve Yönetici bilgilerini eşitleme
  const handleStep1Next = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('İşletme / tabela adı zorunludur.');
      return;
    }
    if (!formData.contactPerson.trim()) {
      setError('Yetkili kişi adı zorunludur.');
      return;
    }
    if (!formData.email.trim()) {
      setError('İletişim e-posta adresi zorunludur.');
      return;
    }
    setError(null);

    // Eğer kullanıcı 3. adımda yönetici bilgilerini henüz manuel değiştirmediyse otomatik senkronize et
    setFormData(prev => ({
      ...prev,
      ownerName: isOwnerManuallyEdited.name ? prev.ownerName : prev.contactPerson.trim(),
      ownerEmail: isOwnerManuallyEdited.email ? prev.ownerEmail : prev.email.trim(),
    }));

    setStep(2);
  };

  // Adım 2 Doğrulama (Şube & Lisans)
  const handleStep2Next = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.branchName.trim()) {
      setError('Şube adı zorunludur.');
      return;
    }
    if (!formData.licenseKey.trim()) {
      setError('Lisans anahtarı zorunludur.');
      return;
    }
    setError(null);
    setStep(3);
  };

  // Adım 3 Doğrulama (Yönetici & PIN)
  const handleStep3Next = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.ownerName.trim()) {
      setError('Yönetici adı zorunludur.');
      return;
    }
    if (!formData.ownerEmail.trim()) {
      setError('Yönetici e-posta adresi zorunludur.');
      return;
    }
    if (!formData.ownerPassword.trim() || formData.ownerPassword.length < 6) {
      setError('Giriş şifresi en az 6 karakter olmalıdır.');
      return;
    }
    if (!/^\d{4,8}$/.test(formData.ownerPin)) {
      setError('Dokunmatik POS PIN kodu 4 ila 8 haneli sayısal olmalıdır.');
      return;
    }
    setError(null);
    setStep(4);
  };

  // Nihai Kurulum Tamamlama IPC Çağrısı
  const handleFinalSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      await tauriInvoke('create_tenant', {
        callerRole: 'MASTER',
        name: formData.name.trim(),
        legalName: formData.legalName.trim(),
        modules: formData.modules,
        contactPerson: formData.contactPerson.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        taxId: formData.taxId.trim(),
        taxOffice: formData.taxOffice.trim(),
        address: formData.address.trim(),
        branchName: formData.branchName.trim(),
        ownerName: formData.ownerName.trim(),
        ownerEmail: formData.ownerEmail.trim(),
        ownerPassword: formData.ownerPassword.trim(),
        ownerPin: formData.ownerPin.trim(),
        licenseKey: formData.licenseKey.trim(),
      });

      // Kurulum başarılı -> Teslim Kartı ekranına geç ve üst bileşeni yenile
      setStep(5);
      if (onSuccess) {
        await onSuccess();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Modül seçim/kaldırma mantığı (core zorunlu tutulur)
  const toggleModule = (modId: string) => {
    if (modId === 'core') return; // Temel modül kaldırılamaz
    if (formData.modules.includes(modId)) {
      setFormData(f => ({ ...f, modules: f.modules.filter(m => m !== modId) }));
    } else {
      setFormData(f => ({ ...f, modules: [...f.modules, modId] }));
    }
  };

  // Teslim fişi metni formatlayıcı
  const getSlipText = () => {
    const selectedMods = AVAILABLE_MODULES.filter(m => formData.modules.includes(m.id)).map(m => m.name).join(', ');
    return `🏢 KASAM360 — İŞLETME KURULUM & TESLİM KARTI
=============================================
İşletme Adı    : ${formData.name}
Resmi Unvan    : ${formData.legalName || formData.name}
Yetkili Kişi   : ${formData.contactPerson}
Telefon        : ${formData.phone || 'Belirtilmedi'}
E-posta        : ${formData.email}
İlk Şube       : ${formData.branchName}
Modüller       : ${selectedMods} ${formData.isTrial ? '(14 Gün Deneme)' : ''}

🔑 YÖNETİCİ SİSTEM GİRİŞ BİLGİLERİ:
---------------------------------------------
Giriş E-posta  : ${formData.ownerEmail}
Giriş Şifresi  : ${formData.ownerPassword}
Dokunmatik PIN : ${formData.ownerPin}
Lisans Anahtarı: ${formData.licenseKey}

Kurulum Tarihi : ${new Date().toLocaleDateString('tr-TR')} ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
=============================================
KASAM360 uygulamasını başlatıp yukarıdaki bilgilerle güvenle oturum açabilirsiniz.`;
  };

  // Teslim fişini panoya kopyala (güvenli ve hataya dayanıklı)
  const handleCopySlip = async () => {
    const text = getSlipText();
    let copied = false;
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (!copied && typeof document !== 'undefined') {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (copied) {
      setCopiedSlip(true);
      setTimeout(() => setCopiedSlip(false), 2500);
    }
  };

  if (!isOpen) return null;

  const currentConfig = STEP_CONFIGS[step - 1];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-2xl flex items-center justify-center p-4 sm:p-6 transition-all duration-300"
      onClick={e => {
        // Yalnızca dış arka plana tıklandığında ve ilk/son adımdayken kapat
        if (e.target === e.currentTarget && !loading && (step === 1 || step === 5)) {
          onClose();
        }
      }}
    >
      <div className="dark:bg-[#121318]/95 bg-white/95 backdrop-blur-3xl border dark:border-white/10 border-black/[0.08] rounded-3xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        
        {/* Üst Başlık & Apple Tarzı Adım İlerleme Çubuğu */}
        <div className="relative pt-6 pb-5 px-8 border-b border-white/[0.06] bg-white/[0.02]">
          {/* Kapat Butonu */}
          <button
            type="button"
            onClick={onClose}
            className="absolute right-6 top-6 w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-white/60 hover:text-white flex items-center justify-center transition-all cursor-pointer"
            title="Kapat"
          >
            <X size={15} />
          </button>

          {/* İkon, Adım Sayacı & Başlık */}
          <div className="text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-b from-white/[0.12] to-white/[0.04] border border-white/[0.12] shadow-inner flex items-center justify-center text-white mx-auto mb-3">
              {step === 1 && <Building2 size={22} className="text-white" />}
              {step === 2 && <Laptop size={22} className="text-white" />}
              {step === 3 && <Shield size={22} className="text-white" />}
              {step === 4 && <Layers size={22} className="text-white" />}
              {step === 5 && <CheckCircle2 size={22} className="text-emerald-400" />}
            </div>

            {/* Apple Setup Assistant İnce Adım Göstergesi */}
            {step < 5 && (
              <span className="text-[11px] font-mono tracking-widest text-white/40 uppercase block mb-1">
                Adım {step} / 4
              </span>
            )}

            <h2 className="text-xl font-semibold tracking-tight text-white">
              {currentConfig.title}
            </h2>
            <p className="text-xs text-white/50 mt-1 max-w-md mx-auto">
              {currentConfig.subtitle}
            </p>
          </div>

          {/* Apple Setup Assistant Tarzı Pürüzsüz Adımlama Noktaları (Tıklanabilir Geri Geçiş) */}
          {step < 5 && (
            <div className="flex items-center justify-center gap-2 mt-5">
              {[1, 2, 3, 4].map((stepIdx) => {
                const isActive = step === stepIdx;
                const isCompleted = step > stepIdx;
                return (
                  <button
                    key={stepIdx}
                    type="button"
                    disabled={stepIdx >= step}
                    onClick={() => setStep(stepIdx as 1 | 2 | 3 | 4)}
                    title={`Adım ${stepIdx}: ${STEP_CONFIGS[stepIdx - 1].title}`}
                    className={`h-1.5 transition-all duration-300 rounded-full ${
                      isActive
                        ? 'w-8 bg-white shadow-[0_0_12px_rgba(255,255,255,0.7)]'
                        : isCompleted
                        ? 'w-3 bg-white/70 hover:bg-white cursor-pointer'
                        : 'w-2 bg-white/20 cursor-default'
                    }`}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Hata Bildirimi */}
        {error && (
          <div className="mx-8 mt-4 p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-2xl flex items-center gap-2.5 backdrop-blur-md">
            <AlertCircle size={16} className="text-rose-400 shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        {/* Form İçeriği / Ferah Input Alanları */}
        <div className="p-8 overflow-y-auto space-y-5 text-xs flex-1">
          {/* ADIM 1: ŞİRKET & YASAL BİLGİLER */}
          {step === 1 && (
            <form id="wizard-step-1" onSubmit={handleStep1Next} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    İşletme / Tabela Adı <span className="text-rose-400">*</span>
                  </label>
                  <input
                    ref={firstInputRef}
                    type="text"
                    required
                    value={formData.name}
                    onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                    placeholder="Örn: Moda Sahil Bistro"
                    className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/25 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    Resmi Ticari Unvan
                  </label>
                  <input
                    type="text"
                    value={formData.legalName}
                    onChange={e => setFormData(f => ({ ...f, legalName: e.target.value }))}
                    placeholder="Örn: Moda Gıda Turizm Ltd. Şti."
                    className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/25 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    VKN / TC Kimlik No
                  </label>
                  <input
                    type="text"
                    value={formData.taxId}
                    onChange={e => setFormData(f => ({ ...f, taxId: e.target.value }))}
                    placeholder="10 veya 11 haneli vergi no"
                    className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/25 font-mono outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    Vergi Dairesi
                  </label>
                  <input
                    type="text"
                    value={formData.taxOffice}
                    onChange={e => setFormData(f => ({ ...f, taxOffice: e.target.value }))}
                    placeholder="Örn: Kadıköy V.D."
                    className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/25 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    Yetkili Kişi <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.contactPerson}
                    onChange={e => {
                      const val = e.target.value;
                      setFormData(f => ({
                        ...f,
                        contactPerson: val,
                        ownerName: isOwnerManuallyEdited.name ? f.ownerName : val,
                      }));
                    }}
                    placeholder="Örn: Canan Kaya"
                    className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/25 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    İletişim E-posta <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={e => {
                      const val = e.target.value;
                      setFormData(f => ({
                        ...f,
                        email: val,
                        ownerEmail: isOwnerManuallyEdited.email ? f.ownerEmail : val,
                      }));
                    }}
                    placeholder="ornek@bistro.com"
                    className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/25 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    İletişim Telefon
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={e => setFormData(f => ({ ...f, phone: e.target.value }))}
                    placeholder="+90 532 000 0000"
                    className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/25 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-1.5">
                  Adres (İl, İlçe, Açık Adres)
                </label>
                <textarea
                  rows={2}
                  value={formData.address}
                  onChange={e => setFormData(f => ({ ...f, address: e.target.value }))}
                  placeholder="İşletmenin faaliyette olduğu fiziksel adres"
                  className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 rounded-2xl p-4 text-sm text-white placeholder-white/25 outline-none transition-all resize-none"
                />
              </div>
            </form>
          )}

          {/* ADIM 2: ŞUBE & DONANIM */}
          {step === 2 && (
            <form id="wizard-step-2" onSubmit={handleStep2Next} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    İlk Şube Adı <span className="text-rose-400">*</span>
                  </label>
                  <input
                    ref={firstInputRef}
                    type="text"
                    required
                    value={formData.branchName}
                    onChange={e => setFormData(f => ({ ...f, branchName: e.target.value }))}
                    placeholder="Örn: Merkez Şube"
                    className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/25 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    İlk Terminal / Kasa Adı
                  </label>
                  <input
                    type="text"
                    value={formData.deviceName}
                    onChange={e => setFormData(f => ({ ...f, deviceName: e.target.value }))}
                    placeholder="Örn: Ana Kasa POS 1"
                    className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/25 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-1.5">
                  Terminal Lisans Anahtarı <span className="text-rose-400">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={formData.licenseKey}
                    onChange={e => setFormData(f => ({ ...f, licenseKey: e.target.value }))}
                    placeholder="K360-XXXX-YYYY-ZZZZ"
                    className="flex-1 bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 text-cyan-300 font-mono text-sm rounded-2xl px-4 py-3 tracking-widest outline-none transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setFormData(f => ({ ...f, licenseKey: generateLicenseKey() }))}
                    className="px-4 py-3 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-white/90 rounded-2xl text-xs font-medium flex items-center gap-2 transition-all cursor-pointer"
                    title="Yeni Lisans Anahtarı Üret"
                  >
                    <RotateCcw size={14} />
                    <span>Yenile</span>
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* ADIM 3: YÖNETİCİ & GÜVENLİK */}
          {step === 3 && (
            <form id="wizard-step-3" onSubmit={handleStep3Next} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    Yönetici Ad Soyad <span className="text-rose-400">*</span>
                  </label>
                  <input
                    ref={firstInputRef}
                    type="text"
                    required
                    value={formData.ownerName}
                    onChange={e => {
                      setFormData(f => ({ ...f, ownerName: e.target.value }));
                      setIsOwnerManuallyEdited(prev => ({ ...prev, name: true }));
                    }}
                    placeholder="Örn: Canan Kaya"
                    className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/25 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    Yönetici Giriş E-postası <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.ownerEmail}
                    onChange={e => {
                      setFormData(f => ({ ...f, ownerEmail: e.target.value }));
                      setIsOwnerManuallyEdited(prev => ({ ...prev, email: true }));
                    }}
                    placeholder="owner@bistro.com"
                    className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/25 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    Giriş Şifresi <span className="text-rose-400">*</span>
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={formData.ownerPassword}
                        onChange={e => setFormData(f => ({ ...f, ownerPassword: e.target.value }))}
                        className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 text-amber-300 font-mono text-sm rounded-2xl px-4 py-3 pr-10 outline-none transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-3.5 text-white/40 hover:text-white transition-colors cursor-pointer"
                        title={showPassword ? 'Gizle' : 'Göster'}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFormData(f => ({ ...f, ownerPassword: generateStrongPassword() }))}
                      className="px-3.5 py-3 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-white/90 rounded-2xl text-xs font-medium transition-all cursor-pointer"
                      title="Güçlü Şifre Üret"
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">
                    Dokunmatik POS PIN Kodu (4-8 Hane) <span className="text-rose-400">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      maxLength={8}
                      value={formData.ownerPin}
                      onChange={e => setFormData(f => ({ ...f, ownerPin: e.target.value.replace(/\D/g, '') }))}
                      placeholder="2222"
                      className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 text-purple-300 font-mono font-semibold text-center tracking-[0.3em] text-base rounded-2xl px-4 py-3 outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setFormData(f => ({ ...f, ownerPin: generatePin() }))}
                      className="px-3.5 py-3 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-white/90 rounded-2xl text-xs font-medium transition-all cursor-pointer"
                      title="Rastgele PIN Üret"
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* ADIM 4: MODÜL SEÇİMİ & ONAY */}
          {step === 4 && (
            <form id="wizard-step-4" onSubmit={e => { e.preventDefault(); handleFinalSubmit(); }} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-white/70 mb-2.5">
                  Restoran İçin Aktif Edilecek Modüller
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {AVAILABLE_MODULES.map(mod => {
                    const isSelected = formData.modules.includes(mod.id);
                    const isCore = mod.id === 'core';
                    return (
                      <button
                        type="button"
                        key={mod.id}
                        onClick={() => toggleModule(mod.id)}
                        className={`text-left p-4 rounded-2xl border transition-all duration-200 flex items-start gap-3.5 ${
                          isCore
                            ? 'bg-white/[0.09] border-white/25 text-white shadow-sm ring-1 ring-white/10 cursor-default'
                            : isSelected
                            ? 'bg-white/[0.09] border-white/25 text-white shadow-lg ring-1 ring-white/10 cursor-pointer'
                            : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.12] text-white/70 cursor-pointer'
                        }`}
                      >
                        <div
                          className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                            isSelected
                              ? 'bg-white text-black'
                              : 'border border-white/20'
                          }`}
                        >
                          {isSelected && <Check size={12} strokeWidth={3} />}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs text-white">{mod.name}</span>
                            {isCore && (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.08] text-white/60 border border-white/[0.1] flex items-center gap-1">
                                <Lock size={9} />
                                <span>Dahil</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-white/50 mt-0.5 leading-snug">{mod.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 14 Günlük Deneme Seçeneği */}
              <div
                onClick={() => setFormData(f => ({ ...f, isTrial: !f.isTrial }))}
                className="p-4 bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.08] rounded-2xl flex items-center justify-between cursor-pointer transition-all"
              >
                <div>
                  <span className="text-xs font-medium text-white block">14 Günlük Ücretsiz Deneme Başlat</span>
                  <span className="text-[11px] text-white/40 block mt-0.5">Deneme süresi bitiminde faturalandırma başlatılır.</span>
                </div>
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                    formData.isTrial ? 'bg-white text-black' : 'border border-white/20'
                  }`}
                >
                  {formData.isTrial && <Check size={12} strokeWidth={3} />}
                </div>
              </div>

              {/* Kurulum Özeti Cam Kartı */}
              <div className="p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl space-y-2.5">
                <span className="text-[10px] text-white/40 uppercase tracking-widest font-semibold block">
                  Kurulum Özeti
                </span>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-white/40 block text-[11px]">İşletme</span>
                    <span className="text-white font-medium">{formData.name}</span>
                  </div>
                  <div>
                    <span className="text-white/40 block text-[11px]">Yetkili</span>
                    <span className="text-white font-medium">{formData.contactPerson}</span>
                  </div>
                  <div>
                    <span className="text-white/40 block text-[11px]">İlk Şube</span>
                    <span className="text-white font-medium">{formData.branchName}</span>
                  </div>
                  <div>
                    <span className="text-white/40 block text-[11px]">Modüller</span>
                    <span className="text-cyan-400 font-medium">{formData.modules.length} modül seçildi</span>
                  </div>
                  <div>
                    <span className="text-white/40 block text-[11px]">Yönetici E-posta</span>
                    <span className="text-white font-mono text-[11px]">{formData.ownerEmail}</span>
                  </div>
                  <div>
                    <span className="text-white/40 block text-[11px]">Dokunmatik PIN</span>
                    <span className="text-purple-300 font-mono font-semibold tracking-wider">{formData.ownerPin}</span>
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* ADIM 5: İŞLETME TESLİM KARTI (CREDENTIALS SLIP) */}
          {step === 5 && (
            <div className="space-y-5 text-center py-2">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-2 shadow-[0_0_30px_rgba(16,185,129,0.15)]">
                <CheckCircle2 size={32} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">İşletme Başarıyla Kuruldu!</h3>
                <p className="text-xs text-white/50 mt-1 max-w-sm mx-auto">
                  Aşağıdaki sistem erişim bilgilerini işletme yöneticisiyle paylaşabilirsiniz.
                </p>
              </div>

              {/* Apple Fiş Cam Kutusu */}
              <div className="bg-black/40 border border-white/[0.08] rounded-2xl p-5 font-mono text-xs text-white/80 space-y-3 select-all text-left shadow-inner">
                <div className="flex justify-between items-center border-b border-white/[0.08] pb-2 font-sans font-semibold text-white">
                  <span>🏢 {formData.name}</span>
                  <span className="text-cyan-400 text-xs font-mono">{formData.modules.length} Modül</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-white/40 block text-[11px] font-sans">Yönetici E-posta</span>
                    <span className="text-white font-medium">{formData.ownerEmail}</span>
                  </div>
                  <div>
                    <span className="text-white/40 block text-[11px] font-sans">Giriş Şifresi</span>
                    <span className="text-amber-300 font-semibold">{formData.ownerPassword}</span>
                  </div>
                  <div>
                    <span className="text-white/40 block text-[11px] font-sans">Dokunmatik PIN</span>
                    <span className="text-purple-300 font-semibold tracking-wider">{formData.ownerPin}</span>
                  </div>
                  <div>
                    <span className="text-white/40 block text-[11px] font-sans">Lisans Anahtarı</span>
                    <span className="text-cyan-300 text-[11px]">{formData.licenseKey}</span>
                  </div>
                </div>
              </div>

              {/* Bilgileri Kopyalama Butonu */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleCopySlip}
                  className="w-full py-3 px-5 rounded-2xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98]"
                >
                  {copiedSlip ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                  <span>{copiedSlip ? 'Tüm Bilgiler Panoya Kopyalandı!' : 'Tüm Bilgileri Kopyala (WhatsApp / E-posta)'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Alt Minimalist Butonlar */}
        <div className="px-8 py-5 border-t border-white/[0.06] bg-white/[0.02] flex justify-between items-center">
          {step > 1 && step < 5 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3 | 4)}
              className="px-4 py-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-white text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
            >
              <ChevronLeft size={14} />
              <span>Geri</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex gap-2.5">
            {step < 4 && (
              <button
                type="submit"
                form={`wizard-step-${step}`}
                className="px-6 py-2.5 rounded-full bg-white text-black hover:bg-white/90 active:scale-[0.97] text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
              >
                <span>İleri</span>
                <ChevronRight size={14} />
              </button>
            )}

            {step === 4 && (
              <AppleButton
                variant="primary"
                size="md"
                onClick={handleFinalSubmit}
                disabled={loading}
                className="rounded-full px-7"
              >
                {loading ? 'Kuruluyor...' : 'İşletmeyi Kur ve Başlat'}
              </AppleButton>
            )}

            {step === 5 && (
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 rounded-full bg-white text-black hover:bg-white/90 active:scale-[0.97] text-xs font-semibold transition-all cursor-pointer"
              >
                Kapat &amp; Listeye Dön
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
