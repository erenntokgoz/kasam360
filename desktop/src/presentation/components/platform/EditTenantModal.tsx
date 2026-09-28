import { useState, useEffect } from 'react';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import { Building2, X, AlertCircle } from 'lucide-react';
import { TenantDto } from './TenantDetailModal';

export interface EditTenantModalProps {
  isOpen: boolean;
  tenant: TenantDto | null;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

export function EditTenantModal({
  isOpen,
  tenant,
  onClose,
  onSuccess,
}: EditTenantModalProps): JSX.Element | null {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    contactPerson: '',
    email: '',
    phone: '',
    taxId: '',
    taxOffice: '',
    address: '',
  });

  useEffect(() => {
    if (tenant) {
      setFormData({
        name: tenant.name || '',
        contactPerson: tenant.contact_person || '',
        email: tenant.email || '',
        phone: tenant.phone || '',
        taxId: tenant.tax_id || '',
        taxOffice: tenant.tax_office || '',
        address: tenant.address || '',
      });
      setError(null);
    }
  }, [tenant]);

  if (!isOpen || !tenant) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('İşletme adı zorunludur.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await tauriInvoke('update_tenant', {
        callerRole: 'MASTER',
        id: tenant.id,
        name: formData.name.trim(),
        contactPerson: formData.contactPerson.trim() || undefined,
        email: formData.email.trim() || undefined,
        phone: formData.phone.trim() || undefined,
        taxId: formData.taxId.trim() || undefined,
        taxOffice: formData.taxOffice.trim() || undefined,
        address: formData.address.trim() || undefined,
      });
      await onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 dark:bg-black/75 backdrop-blur-2xl flex items-center justify-center p-4">
      <div className="backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Başlık */}
        <div className="p-5 border-b dark:border-white/10 border-black/[0.08] flex items-center justify-between dark:bg-white/[0.02] bg-black/[0.02]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#007AFF]/15 border border-[#007AFF]/30 rounded-2xl text-[#007AFF]">
              <Building2 size={22} />
            </div>
            <div>
              <h2 className="text-base font-bold dark:text-white text-zinc-900">İşletme Bilgilerini Düzenle</h2>
              <p className="text-xs dark:text-zinc-400 text-zinc-500">{tenant.name} ({tenant.id})</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:dark:text-white hover:text-zinc-900 rounded-full hover:dark:bg-white/10 hover:bg-black/5 transition-all cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-500/15 border border-red-500/30 text-red-500 text-xs rounded-2xl flex items-center gap-2">
            <AlertCircle size={16} className="text-red-500 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 text-xs flex-1">
          <div>
            <label className="block dark:text-zinc-300 text-zinc-700 font-semibold mb-1">
              İşletme / Tabela Adı *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
              className="w-full dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 rounded-2xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-[#007AFF]/50"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block dark:text-zinc-300 text-zinc-700 font-semibold mb-1">
                Yetkili Kişi
              </label>
              <input
                type="text"
                value={formData.contactPerson}
                onChange={e => setFormData(f => ({ ...f, contactPerson: e.target.value }))}
                className="w-full dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 rounded-2xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-[#007AFF]/50"
              />
            </div>
            <div>
              <label className="block dark:text-zinc-300 text-zinc-700 font-semibold mb-1">
                İletişim E-posta
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={e => setFormData(f => ({ ...f, email: e.target.value }))}
                className="w-full dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 rounded-2xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-[#007AFF]/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block dark:text-zinc-300 text-zinc-700 font-semibold mb-1">
                Telefon
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={e => setFormData(f => ({ ...f, phone: e.target.value }))}
                className="w-full dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 rounded-2xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-[#007AFF]/50"
              />
            </div>
            <div>
              <label className="block dark:text-zinc-300 text-zinc-700 font-semibold mb-1">
                VKN / TC No
              </label>
              <input
                type="text"
                value={formData.taxId}
                onChange={e => setFormData(f => ({ ...f, taxId: e.target.value }))}
                className="w-full dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 rounded-2xl px-3.5 py-2.5 text-xs font-mono focus:outline-none focus:border-[#007AFF]/50"
              />
            </div>
            <div>
              <label className="block dark:text-zinc-300 text-zinc-700 font-semibold mb-1">
                Vergi Dairesi
              </label>
              <input
                type="text"
                value={formData.taxOffice}
                onChange={e => setFormData(f => ({ ...f, taxOffice: e.target.value }))}
                className="w-full dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 rounded-2xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-[#007AFF]/50"
              />
            </div>
          </div>

          <div>
            <label className="block dark:text-zinc-300 text-zinc-700 font-semibold mb-1">
              Adres
            </label>
            <textarea
              rows={2}
              value={formData.address}
              onChange={e => setFormData(f => ({ ...f, address: e.target.value }))}
              className="w-full dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 rounded-2xl p-3.5 text-xs focus:outline-none focus:border-[#007AFF]/50 resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t dark:border-white/10 border-black/[0.08]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-zinc-300 text-zinc-700 rounded-2xl text-xs font-semibold transition-all cursor-pointer"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-[#007AFF] hover:bg-[#0071eb] text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-[#007AFF]/25 active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
