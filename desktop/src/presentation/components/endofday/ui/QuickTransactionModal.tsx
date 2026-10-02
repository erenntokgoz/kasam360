import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, TrendingUp, TrendingDown, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { tauriInvoke } from '../../../../data/ipc/tauriInvoke';
import { toast } from '@core/components/ui/toast';

export type QuickTransactionType = 'GELIR' | 'GIDER' | 'BORC' | 'ALACAK';

interface QuickTransactionModalProps {
  type: QuickTransactionType;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * 4 Hızlı Aksiyon Cam Modalı (+ Gelir, - Gider, Borç, Alacak).
 * Gerçek Apple visionOS ışık kırılması (apple-specular) ve ambiyans ışımasıyla çalışır.
 */
export const QuickTransactionModal: React.FC<QuickTransactionModalProps> = ({
  type,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [amountStr, setAmountStr] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER' | 'CREDIT_CARD'>('CASH');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Cari rehber seçim ve oluşturma durumları
  const [directories, setDirectories] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [selectedDirectoryId, setSelectedDirectoryId] = useState<string>('');
  const [isCreatingNewDir, setIsCreatingNewDir] = useState<boolean>(false);
  const [newDirName, setNewDirName] = useState<string>('');

  // Borç ve alacak işlemlerinde mevcut cari kartları dinamik yükle
  useEffect(() => {
    if (isOpen && (type === 'BORC' || type === 'ALACAK')) {
      tauriInvoke<Array<{ id: string; name: string; type: string }>>('get_directories', {})
        .then((data) => {
          const list = Array.isArray(data) ? data : [];
          setDirectories(list);
          if (list.length > 0) {
            const preferred = list.find((d) =>
              type === 'BORC' ? d.type === 'SUPPLIER' : d.type === 'CUSTOMER' || d.type === 'STAFF'
            );
            setSelectedDirectoryId(preferred ? preferred.id : list[0].id);
            setIsCreatingNewDir(false);
          } else {
            setIsCreatingNewDir(true);
          }
        })
        .catch(() => {
          setDirectories([]);
          setIsCreatingNewDir(true);
        });
    }
  }, [isOpen, type]);

  if (!isOpen) return null;

  const titleMap = {
    GELIR: { title: 'Hızlı Gelir Girişi', icon: <TrendingUp className="text-emerald-500" />, color: 'text-emerald-500' },
    GIDER: { title: 'Hızlı İşletme Gideri', icon: <TrendingDown className="text-rose-500" />, color: 'text-rose-500' },
    BORC: { title: 'Yeni Borç Kaydı', icon: <ArrowDownLeft className="text-amber-500" />, color: 'text-amber-500' },
    ALACAK: { title: 'Yeni Alacak Kaydı', icon: <ArrowUpRight className="text-sky-500" />, color: 'text-sky-500' },
  };

  const current = titleMap[type];

  // Bildirim yöneticisi
  const showToast = (title: string, toastType: 'success' | 'error' | 'info' = 'info') => {
    try {
      toast.add({ title, type: toastType });
    } catch {
      console.log(`[${toastType}] ${title}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountVal = parseFloat(amountStr.replace(',', '.'));
    if (isNaN(amountVal) || amountVal <= 0) {
      showToast('Lütfen geçerli bir tutar girin', 'error');
      return;
    }

    const amountCents = Math.round(amountVal * 100);
    setIsSubmitting(true);

    try {
      let finalDirId = selectedDirectoryId;

      // Borç veya Alacak için cari kart oluşturma/seçme doğrulaması
      if (type === 'BORC' || type === 'ALACAK') {
        if (isCreatingNewDir || !finalDirId) {
          if (!newDirName.trim()) {
            showToast('Lütfen cari hesap / kişi adı giriniz', 'error');
            setIsSubmitting(false);
            return;
          }
          const createdDir = await tauriInvoke<{ id: string }>('create_directory', {
            payload: {
              name: newDirName.trim(),
              type: type === 'BORC' ? 'SUPPLIER' : 'CUSTOMER',
            },
          });
          finalDirId = createdDir.id;
        }
      }

      if (type === 'GIDER') {
        await tauriInvoke('create_expense', {
          payload: {
            category,
            amountCents,
            paymentMethod,
            description: description.trim() || 'Hızlı Gider Girişi',
            actorId: 'Kullanıcı',
          },
        });
        showToast('Gider başarıyla kaydedildi', 'success');
      } else if (type === 'GELIR') {
        // Gelir kaydı (Kasa Girişi)
        await tauriInvoke('cash_in', {
          shift_id: 'ACTIVE_SHIFT',
          amount_cents: amountCents,
          reason: description.trim() || 'Hızlı Gelir / Kasa Girişi',
          actor_id: 'Kullanıcı',
        });
        showToast('Gelir kasaya işlendi', 'success');
      } else if (type === 'BORC') {
        await tauriInvoke('create_debt', {
          payload: {
            directoryId: finalDirId,
            type: 'TAKEN',
            totalAmountCents: amountCents,
            description: description.trim() || 'Hızlı Borç Kaydı',
            isCash: paymentMethod === 'CASH',
          },
        });
        showToast('Borç kaydı deftere işlendi', 'success');
      } else if (type === 'ALACAK') {
        await tauriInvoke('create_debt', {
          payload: {
            directoryId: finalDirId,
            type: 'GIVEN',
            totalAmountCents: amountCents,
            description: description.trim() || 'Hızlı Alacak Kaydı',
            isCash: paymentMethod === 'CASH',
          },
        });
        showToast('Alacak kaydı deftere işlendi', 'success');
      }

      onSuccess();
      onClose();
    } catch (err) {
      showToast(typeof err === 'string' ? err : 'İşlem gerçekleştirilemedi', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative w-full max-w-md rounded-3xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/10 p-6 shadow-2xl backdrop-blur-2xl apple-specular animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between pb-4 mb-4 border-b dark:border-white/10 border-black/10">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-2xl dark:bg-white/[0.06] bg-black/[0.04]">
              {current.icon}
            </div>
            <h3 className="text-base font-semibold tracking-tight dark:text-white text-zinc-900">
              {current.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-black hover:dark:bg-white/10 hover:bg-black/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block mb-1 text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-600">
              Tutar (₺)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold dark:text-zinc-400 text-zinc-500">
                ₺
              </span>
              <input
                type="number"
                step="0.01"
                required
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0.00"
                className="w-full h-12 pl-8 pr-4 rounded-2xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 font-mono text-lg font-bold focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
              />
            </div>
          </div>

          {(type === 'BORC' || type === 'ALACAK') && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-600">
                  {type === 'BORC' ? 'Tedarikçi / Alacaklı Firma' : 'Müşteri / Borçlu Kişi'}
                </label>
                {directories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsCreatingNewDir(!isCreatingNewDir)}
                    className="text-[11px] text-[#007AFF] hover:underline font-medium cursor-pointer"
                  >
                    {isCreatingNewDir ? 'Listeden Seç' : '+ Yeni Cari Tanımla'}
                  </button>
                )}
              </div>

              {isCreatingNewDir || directories.length === 0 ? (
                <input
                  type="text"
                  required
                  value={newDirName}
                  onChange={(e) => setNewDirName(e.target.value)}
                  placeholder={type === 'BORC' ? 'Örn: Öz Gıda Toptan A.Ş.' : 'Örn: Ahmet Yılmaz (Veresiye)'}
                  className="w-full h-11 px-3 rounded-2xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 text-xs focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                />
              ) : (
                <select
                  value={selectedDirectoryId}
                  onChange={(e) => {
                    if (e.target.value === '__NEW__') {
                      setIsCreatingNewDir(true);
                    } else {
                      setSelectedDirectoryId(e.target.value);
                    }
                  }}
                  className="w-full h-11 px-3 rounded-2xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 text-xs font-medium focus:outline-none"
                >
                  {directories.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.type})
                    </option>
                  ))}
                  <option value="__NEW__">+ Yeni Cari Hesap Ekle...</option>
                </select>
              )}
            </div>
          )}

          {type === 'GIDER' && (
            <div>
              <label className="block mb-1 text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-600">
                Gider Kategorisi
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full h-11 px-3 rounded-2xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 text-xs font-medium focus:outline-none"
              >
                <option value="RENT">Kira Gideri</option>
                <option value="UTILITIES">Fatura (Elektrik/Su/Doğalgaz)</option>
                <option value="SUPPLIER">Toptancı / Mal Alımı</option>
                <option value="STAFF_ADVANCE">Personel Avansı / Maaş</option>
                <option value="TAX">Vergi & Harç</option>
                <option value="MAINTENANCE">Bakım & Onarım</option>
                <option value="PERSONAL">Patron Şahsi Harcama</option>
                <option value="OTHER">Diğer Sarfiyat</option>
              </select>
            </div>
          )}

          <div>
            <label className="block mb-1 text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-600">
              Ödeme / İşlem Yolu
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('CASH')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                  paymentMethod === 'CASH'
                    ? 'dark:bg-white/20 bg-black text-white border-transparent shadow-sm'
                    : 'dark:bg-white/[0.04] bg-black/[0.04] dark:text-zinc-400 text-zinc-600 dark:border-white/10 border-black/10'
                }`}
              >
                Nakit Kasa
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('BANK_TRANSFER')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                  paymentMethod === 'BANK_TRANSFER'
                    ? 'dark:bg-white/20 bg-black text-white border-transparent shadow-sm'
                    : 'dark:bg-white/[0.04] bg-black/[0.04] dark:text-zinc-400 text-zinc-600 dark:border-white/10 border-black/10'
                }`}
              >
                Havale / EFT
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('CREDIT_CARD')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                  paymentMethod === 'CREDIT_CARD'
                    ? 'dark:bg-white/20 bg-black text-white border-transparent shadow-sm'
                    : 'dark:bg-white/[0.04] bg-black/[0.04] dark:text-zinc-400 text-zinc-600 dark:border-white/10 border-black/10'
                }`}
              >
                Banka Kartı
              </button>
            </div>
          </div>

          <div>
            <label className="block mb-1 text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-600">
              Açıklama / Not
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="İşlem detayı giriniz..."
              className="w-full h-11 px-3 rounded-2xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 text-xs focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
            />
          </div>

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 rounded-2xl dark:bg-white/[0.06] bg-black/[0.05] hover:dark:bg-white/[0.1] hover:bg-black/[0.08] dark:text-white text-zinc-800 text-xs font-semibold transition-all cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 h-11 rounded-2xl bg-[#007AFF] hover:bg-[#0071E3] text-white text-xs font-semibold shadow-lg shadow-[#007AFF]/25 transition-all flex items-center justify-center gap-1.5 active:scale-98 disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 size={16} />
              <span>{isSubmitting ? 'Kaydediliyor...' : 'Kaydet'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
