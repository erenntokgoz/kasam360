import { useEffect, useState, useMemo } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../../store/useAuthStore';
import {
  Building2,
  Plus,
  MapPin,
  Calendar,
  CheckCircle2,
  Search,
  RefreshCw,
  X,
  ExternalLink,
  ShieldCheck,
  Phone,
} from 'lucide-react';

export interface BranchDto {
  id: string;
  tenant_id: string;
  name: string;
  address: string | null;
  status: string;
  created_at: string;
}

export function OwnerBranchesTab() {
  const user = useAuthStore(state => state.user);
  const tenantId = user?.tenantId || 'DEFAULT_TENANT';

  const [branches, setBranches] = useState<BranchDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<BranchDto | null>(null);

  // Form State
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchPhone, setBranchPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchBranches = async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const data = await invoke<BranchDto[]>('get_branches', {
        tenantId,
        tenant_id: tenantId,
      });
      setBranches(data || []);
    } catch (err) {
      console.error('Branches fetch failed:', err);
      setError(typeof err === 'string' ? err : 'Şube listesi yüklenirken hata oluştu.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, [tenantId]);

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchName.trim()) {
      setError('Lütfen geçerli bir şube adı giriniz.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const fullAddress = branchPhone.trim()
        ? `${branchAddress.trim()}${branchAddress.trim() ? ' | Tel: ' : 'Tel: '}${branchPhone.trim()}`
        : branchAddress.trim() || null;

      await invoke('create_branch', {
        tenantId,
        tenant_id: tenantId,
        name: branchName.trim(),
        address: fullAddress,
      });

      setSuccessMessage(`"${branchName}" şubesi başarıyla oluşturuldu.`);
      setTimeout(() => setSuccessMessage(null), 4000);

      // Reset form
      setBranchName('');
      setBranchAddress('');
      setBranchPhone('');
      setIsAddModalOpen(false);

      // Refresh list
      await fetchBranches(true);
    } catch (err) {
      console.error('Create branch error:', err);
      setError(typeof err === 'string' ? err : 'Şube oluşturulurken bir hata meydana geldi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredBranches = useMemo(() => {
    if (!searchTerm.trim()) return branches;
    const lower = searchTerm.toLowerCase();
    return branches.filter(
      b =>
        b.name.toLowerCase().includes(lower) ||
        (b.address && b.address.toLowerCase().includes(lower)) ||
        b.id.toLowerCase().includes(lower)
    );
  }, [branches, searchTerm]);

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Building2 className="text-indigo-400" />
            Şube Yönetimi & Ayarları
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            İşletmenize bağlı şubeleri listeleyin, yeni şube açın ve şube parametrelerini yönetin.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchBranches(true)}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-slate-700 hover:border-slate-600 rounded-xl text-slate-300 hover:text-white transition-colors text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin text-indigo-400' : ''} />
            <span>Yenile</span>
          </button>
          <button
            onClick={() => {
              setError(null);
              setIsAddModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors text-sm shadow-lg shadow-indigo-600/20"
          >
            <Plus size={18} />
            <span>Yeni Şube Ekle</span>
          </button>
        </div>
      </div>

      {/* Alert Banners */}
      {error && (
        <div className="bg-red-950/40 border border-red-800 text-red-300 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200">
            <X size={16} />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="bg-emerald-950/40 border border-emerald-800 text-emerald-300 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-400" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-400 hover:text-emerald-200">
            <X size={16} />
          </button>
        </div>
      )}

      {/* KPI Stats / Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Kayıtlı Şubeler</div>
            <div className="text-2xl font-bold text-white mt-1">{branches.length}</div>
          </div>
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl">
            <Building2 size={22} />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Aktif Şubeler</div>
            <div className="text-2xl font-bold text-emerald-400 mt-1">
              {branches.filter(b => b.status === 'ACTIVE').length}
            </div>
          </div>
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl">
            <CheckCircle2 size={22} />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Ana Kiracı ID</div>
            <div className="text-xs font-mono text-indigo-300 mt-2 truncate max-w-[150px]">{tenantId}</div>
          </div>
          <div className="p-3 bg-slate-800 text-slate-400 rounded-xl">
            <ShieldCheck size={22} />
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative w-full max-w-md">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Şube adı veya adres ara..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Branches Cards */}
      {isLoading ? (
        <div className="flex h-48 items-center justify-center text-slate-400 gap-3">
          <RefreshCw size={24} className="animate-spin text-indigo-500" />
          <span>Şubeler yükleniyor...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredBranches.map(branch => (
            <div
              key={branch.id}
              onClick={() => setSelectedBranch(branch)}
              className="group bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 hover:shadow-xl hover:shadow-black/40 cursor-pointer"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-base">
                      {branch.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-base group-hover:text-indigo-400 transition-colors">
                        {branch.name}
                      </h3>
                      <span className="text-xs font-mono text-slate-500">ID: {branch.id.slice(0, 8)}...</span>
                    </div>
                  </div>

                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${
                      branch.status === 'ACTIVE'
                        ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800'
                        : 'bg-amber-950/80 text-amber-400 border-amber-800'
                    }`}
                  >
                    {branch.status === 'ACTIVE' ? 'Aktif' : branch.status}
                  </span>
                </div>

                {branch.address ? (
                  <div className="flex items-start gap-2 text-slate-300 text-sm mt-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800/60">
                    <MapPin size={16} className="shrink-0 text-slate-400 mt-0.5" />
                    <span className="line-clamp-2 leading-relaxed">{branch.address}</span>
                  </div>
                ) : (
                  <div className="text-slate-500 text-xs italic mt-3 bg-slate-950/40 p-3 rounded-xl border border-slate-800/40">
                    Adres bilgisi girilmemiş.
                  </div>
                )}
              </div>

              <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Calendar size={13} />
                  {new Date(branch.created_at).toLocaleDateString('tr-TR')}
                </span>
                <span className="text-indigo-400 font-medium group-hover:underline flex items-center gap-1">
                  Yönet <ExternalLink size={12} />
                </span>
              </div>
            </div>
          ))}

          {filteredBranches.length === 0 && (
            <div className="col-span-full py-16 text-center border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/30">
              <Building2 size={40} className="mx-auto text-slate-600 mb-3" />
              <p className="text-slate-400 font-medium text-base">
                {searchTerm ? `"${searchTerm}" arama kriterine uygun şube bulunamadı.` : 'Henüz kayıtlı şube bulunmuyor.'}
              </p>
              <p className="text-slate-500 text-sm mt-1">
                İşletmenizi büyütmek için yeni bir şube ekleyerek başlayabilirsiniz.
              </p>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors"
              >
                Yeni Şube Ekle
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add Branch Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Building2 className="text-indigo-400" size={22} />
                <h3 className="font-bold text-lg text-white">Yeni Şube Oluştur</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateBranch} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Şube Adı <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Beşiktaş Çarşı Şubesi"
                  value={branchName}
                  onChange={e => setBranchName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Şube Adresi
                </label>
                <textarea
                  rows={2}
                  placeholder="Örn: Ihlamurdere Cad. No: 42, Beşiktaş / İstanbul"
                  value={branchAddress}
                  onChange={e => setBranchAddress(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Şube İletişim / Telefon (Opsiyonel)
                </label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Örn: +90 212 555 0123"
                    value={branchPhone}
                    onChange={e => setBranchPhone(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm"
                  />
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl transition-colors text-sm shadow-lg shadow-indigo-600/20"
                >
                  {isSubmitting ? 'Oluşturuluyor...' : 'Şubeyi Kaydet'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors text-sm"
                >
                  İptal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Branch Detail / Manage Modal */}
      {selectedBranch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold">
                  {selectedBranch.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">{selectedBranch.name}</h3>
                  <span className="text-xs text-slate-400">Şube Detayları</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedBranch(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800 text-sm">
              <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Şube ID:</span>
                <span className="font-mono text-indigo-300 text-xs">{selectedBranch.id}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Durum:</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                  {selectedBranch.status}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Kiracı (Tenant):</span>
                <span className="font-mono text-slate-300 text-xs">{selectedBranch.tenant_id}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Açılış Tarihi:</span>
                <span className="text-white text-xs">
                  {new Date(selectedBranch.created_at).toLocaleString('tr-TR')}
                </span>
              </div>
              <div className="py-1">
                <span className="text-slate-400 block mb-1">Adres / İletişim:</span>
                <p className="text-slate-200 text-xs bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  {selectedBranch.address || 'Kayıtlı adres bulunmuyor.'}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setSelectedBranch(null)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-xl transition-colors text-sm"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
