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
  Phone,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';

export interface BranchDto {
  id: string;
  tenant_id: string;
  name: string;
  address: string | null;
  status: string;
  created_at: string;
}

// Apple Borsa / Sağlık tarzı mini trend çizgi grafiği
function MetricMiniLine({ color }: { color: string }) {
  return (
    <div className="h-6 w-16 overflow-hidden">
      <svg className="w-full h-full" viewBox="0 0 50 16">
        <path
          d="M 0,12 Q 15,2 25,10 T 50,4"
          fill="none"
          stroke={color}
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function OwnerBranchesTab() {
  const user = useAuthStore(state => state.user);
  const tenantId = user?.tenantId || 'DEFAULT_TENANT';

  const [branches, setBranches] = useState<BranchDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Arama filtresi
  const [searchTerm, setSearchTerm] = useState('');

  // Modal durumları
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<BranchDto | null>(null);

  // Yeni şube form alanları
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchPhone, setBranchPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Şube listesini backend'den çek
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
      console.error('Şube getirme hatası:', err);
      setError(typeof err === 'string' ? err : 'Şube listesi yüklenemedi.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, [tenantId]);

  // Escape tuşuna basıldığında açık şube pencerelerini kapat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isAddModalOpen) setIsAddModalOpen(false);
        if (selectedBranch) setSelectedBranch(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAddModalOpen, selectedBranch]);

  // Yeni şube kaydı
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

      setSuccessMessage(`"${branchName}" şubesi oluşturuldu.`);
      setTimeout(() => setSuccessMessage(null), 3500);

      // Formu temizle ve listeyi tazele
      setBranchName('');
      setBranchAddress('');
      setBranchPhone('');
      setIsAddModalOpen(false);

      await fetchBranches(true);
    } catch (err) {
      console.error('Şube oluşturma hatası:', err);
      setError(typeof err === 'string' ? err : 'Şube oluşturulamadı.');
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
    <div className="flex flex-col gap-6 max-w-7xl mx-auto pb-12 select-none text-foreground">
      {/* Üst Başlık & Aksiyon Çubuğu */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight dark:text-white text-zinc-900 flex items-center gap-2">
            <Building2 size={20} className="text-[#007AFF]" />
            Şubeler
          </h2>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => fetchBranches(true)}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3.5 py-2 backdrop-blur-md dark:bg-white/5 bg-black/5 hover:dark:bg-white/10 hover:bg-black/10 border dark:border-white/10 border-black/[0.08] rounded-2xl text-xs font-semibold dark:text-zinc-300 text-zinc-700 transition-all disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-[#007AFF]' : ''} />
            <span>Yenile</span>
          </button>
          <button
            onClick={() => {
              setError(null);
              setIsAddModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#007AFF] hover:bg-[#007AFF]/90 text-white rounded-2xl text-xs font-semibold transition-all shadow-sm cursor-pointer active:scale-95"
          >
            <Plus size={15} />
            <span>Yeni Şube</span>
          </button>
        </div>
      </div>

      {/* Geri Bildirim Banner'ları */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-300 px-4 py-3 rounded-2xl text-xs flex items-center justify-between backdrop-blur-md">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-300 px-4 py-3 rounded-2xl text-xs flex items-center justify-between backdrop-blur-md">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} className="text-emerald-500" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-500 hover:text-emerald-700 cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Apple Sağlık / Borsa Tarzı Metrik Kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Kayıtlı Şubeler */}
        <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
              Kayıtlı Şubeler
            </span>
            <MetricMiniLine color="#818cf8" />
          </div>
          <div className="text-3xl font-bold tracking-tight dark:text-white text-zinc-900 mt-3">
            {branches.length}
          </div>
        </div>

        {/* Aktif Şubeler */}
        <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
              Aktif Şubeler
            </span>
            <MetricMiniLine color="#34d399" />
          </div>
          <div className="text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 mt-3">
            {branches.filter(b => b.status === 'ACTIVE').length}
          </div>
        </div>

        {/* Kiracı Kimliği */}
        <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
              Kiracı Kodu
            </span>
            <ShieldCheck size={16} className="text-zinc-400" />
          </div>
          <div className="text-sm font-mono dark:text-zinc-300 text-zinc-700 mt-4 truncate">
            {tenantId}
          </div>
        </div>
      </div>

      {/* Arama Kutusu */}
      <div className="relative w-full max-w-sm">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          placeholder="Şube veya adres ara..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 backdrop-blur-md dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl text-xs dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-[#007AFF] transition-all"
        />
      </div>

      {/* Minimalist Apple Şube Listesi */}
      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-xs text-zinc-400">
          Şubeler yükleniyor...
        </div>
      ) : (
        <div className="backdrop-blur-xl dark:bg-white/[0.03] bg-white/80 border dark:border-white/10 border-black/[0.08] rounded-3xl overflow-hidden divide-y dark:divide-white/10 divide-black/[0.06] shadow-sm">
          {filteredBranches.map(branch => (
            <div
              key={branch.id}
              onClick={() => setSelectedBranch(branch)}
              className="p-4 sm:p-5 flex items-center justify-between hover:dark:bg-white/[0.04] hover:bg-black/[0.02] cursor-pointer transition-colors group"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-2xl dark:bg-white/10 bg-black/5 border dark:border-white/10 border-black/[0.08] flex items-center justify-center text-sm font-bold dark:text-white text-zinc-900">
                  {branch.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold dark:text-white text-zinc-900 text-sm group-hover:text-[#007AFF] transition-colors">
                      {branch.name}
                    </h3>
                    <span
                      className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold ${
                        branch.status === 'ACTIVE'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                          : 'dark:bg-white/5 bg-black/5 dark:text-zinc-400 text-zinc-600 border dark:border-white/10 border-black/[0.08]'
                      }`}
                    >
                      {branch.status === 'ACTIVE' ? 'Aktif' : branch.status}
                    </span>
                  </div>
                  {branch.address && (
                    <div className="flex items-center gap-1.5 text-xs dark:text-zinc-400 text-zinc-600 mt-1">
                      <MapPin size={12} className="text-zinc-400 shrink-0" />
                      <span className="truncate max-w-md">{branch.address}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs dark:text-zinc-400 text-zinc-500">
                <span className="hidden sm:flex items-center gap-1">
                  <Calendar size={12} />
                  {new Date(branch.created_at).toLocaleDateString('tr-TR')}
                </span>
                <ChevronRight size={16} className="text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors" />
              </div>
            </div>
          ))}

          {filteredBranches.length === 0 && (
            <div className="py-16 text-center text-xs dark:text-zinc-400 text-zinc-500">
              {searchTerm ? `"${searchTerm}" ile eşleşen şube bulunamadı.` : 'Kayıtlı şube bulunmuyor.'}
            </div>
          )}
        </div>
      )}

      {/* iOS Dialog: Yeni Şube Oluştur */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5 dark:text-zinc-100 text-zinc-900 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base dark:text-white text-zinc-900">Yeni Şube</h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="w-7 h-7 rounded-full dark:bg-white/10 bg-black/5 hover:dark:bg-white/20 hover:bg-black/10 flex items-center justify-center dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 transition-colors cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleCreateBranch} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-600 uppercase tracking-wider mb-1.5">
                  Şube Adı
                </label>
                <input
                  type="text"
                  required
                  placeholder="Şube adı girin"
                  value={branchName}
                  onChange={e => setBranchName(e.target.value)}
                  className="w-full backdrop-blur-md dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl px-3.5 py-2.5 dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-[#007AFF] text-xs transition-all"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-600 uppercase tracking-wider mb-1.5">
                  Adres
                </label>
                <textarea
                  rows={2}
                  placeholder="Adres bilgisi"
                  value={branchAddress}
                  onChange={e => setBranchAddress(e.target.value)}
                  className="w-full backdrop-blur-md dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl px-3.5 py-2.5 dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-[#007AFF] text-xs resize-none transition-all"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-600 uppercase tracking-wider mb-1.5">
                  İletişim Telefonu
                </label>
                <div className="relative">
                  <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="+90 ..."
                    value={branchPhone}
                    onChange={e => setBranchPhone(e.target.value)}
                    className="w-full pl-9 pr-3.5 py-2.5 backdrop-blur-md dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-[#007AFF] text-xs transition-all"
                  />
                </div>
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-2.5 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-zinc-300 text-zinc-700 font-semibold rounded-2xl text-xs transition-all cursor-pointer"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 bg-[#007AFF] hover:bg-[#007AFF]/90 text-white font-semibold rounded-2xl text-xs transition-all disabled:opacity-50 cursor-pointer active:scale-95 shadow-sm"
                >
                  {isSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* iOS Dialog: Şube Bilgi Kartı */}
      {selectedBranch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-sm w-full p-6 shadow-2xl flex flex-col gap-5 dark:text-zinc-100 text-zinc-900 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl dark:bg-white/10 bg-black/5 border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 flex items-center justify-center font-bold text-sm">
                  {selectedBranch.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-bold text-sm dark:text-white text-zinc-900">{selectedBranch.name}</h3>
                  <span className="text-[10px] dark:text-zinc-400 text-zinc-500 font-mono">ID: {selectedBranch.id}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedBranch(null)}
                className="w-7 h-7 rounded-full dark:bg-white/10 bg-black/5 hover:dark:bg-white/20 hover:bg-black/10 flex items-center justify-center dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 transition-colors cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            <div className="backdrop-blur-md dark:bg-white/[0.04] bg-black/[0.03] rounded-2xl p-4 border dark:border-white/10 border-black/[0.08] space-y-2.5 text-xs">
              <div className="flex justify-between py-1 border-b dark:border-white/10 border-black/[0.06]">
                <span className="dark:text-zinc-400 text-zinc-500">Durum</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{selectedBranch.status}</span>
              </div>
              <div className="flex justify-between py-1 border-b dark:border-white/10 border-black/[0.06]">
                <span className="dark:text-zinc-400 text-zinc-500">Kiracı</span>
                <span className="font-mono dark:text-zinc-300 text-zinc-700">{selectedBranch.tenant_id}</span>
              </div>
              <div className="flex justify-between py-1 border-b dark:border-white/10 border-black/[0.06]">
                <span className="dark:text-zinc-400 text-zinc-500">Kayıt Tarihi</span>
                <span className="dark:text-zinc-300 text-zinc-700">
                  {new Date(selectedBranch.created_at).toLocaleDateString('tr-TR')}
                </span>
              </div>
              <div className="py-1">
                <span className="dark:text-zinc-400 text-zinc-500 block mb-1">Adres / İletişim</span>
                <p className="dark:text-zinc-300 text-zinc-700 leading-relaxed text-[11px]">
                  {selectedBranch.address || 'Kayıtlı adres bulunmuyor.'}
                </p>
              </div>
            </div>

            <button
              onClick={() => setSelectedBranch(null)}
              className="w-full py-2.5 dark:bg-white/10 bg-black/5 hover:dark:bg-white/15 hover:bg-black/10 dark:text-white text-zinc-900 font-semibold rounded-2xl text-xs transition-all cursor-pointer"
            >
              Tamam
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
