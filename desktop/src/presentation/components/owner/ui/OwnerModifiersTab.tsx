import { useEffect, useState, useMemo } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../../store/useAuthStore';
import {
  Wrench,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Search,
  RefreshCw,
  X,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Coins,
} from 'lucide-react';

export type ModifierOption = {
  id: string;
  name: string;
  priceCents: number;
};

export type ModifierGroup = {
  id: string;
  name: string;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number | null;
  options: ModifierOption[];
};

export function OwnerModifiersTab() {
  const user = useAuthStore(s => s.user);
  const actorRole = user?.role || 'OWNER';
  const tenantId = user?.tenantId || 'DEFAULT_TENANT';

  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Accordion expanded state
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Search
  const [searchTerm, setSearchTerm] = useState('');

  // Modals
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [addingOptionToGroup, setAddingOptionToGroup] = useState<ModifierGroup | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<ModifierGroup | null>(null);
  const [viewingGroup, setViewingGroup] = useState<ModifierGroup | null>(null);

  // Form States
  const [groupName, setGroupName] = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [minSelections, setMinSelections] = useState(0);
  const [maxSelections, setMaxSelections] = useState('');
  const [isSubmittingGroup, setIsSubmittingGroup] = useState(false);

  const [optionName, setOptionName] = useState('');
  const [optionPrice, setOptionPrice] = useState('0');
  const [isSubmittingOption, setIsSubmittingOption] = useState(false);

  const fetchGroups = async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await invoke<ModifierGroup[]>('get_modifier_groups', {
        actorRole,
        actor_role: actorRole,
      }).catch(err => {
        console.warn('[OwnerModifiersTab] get_modifier_groups fallback:', err);
        return [];
      });

      setGroups(data || []);
      // Expand all by default
      const expMap: Record<string, boolean> = {};
      (data || []).forEach(g => {
        expMap[g.id] = true;
      });
      setExpanded(expMap);
    } catch (e) {
      console.error('Fetch modifier groups error:', e);
      setError(typeof e === 'string' ? e : 'Modifier grupları alınamadı.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, [actorRole]);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) {
      setError('Lütfen bir modifier grubu adı giriniz.');
      return;
    }

    setIsSubmittingGroup(true);
    setError(null);

    try {
      const maxSel = maxSelections.trim() ? parseInt(maxSelections, 10) : null;

      await invoke('create_modifier_group', {
        actorRole,
        actor_role: actorRole,
        name: groupName.trim(),
        isRequired,
        is_required: isRequired,
        minSelections: Number(minSelections) || 0,
        min_selections: Number(minSelections) || 0,
        maxSelections: maxSel,
        max_selections: maxSel,
        tenantId,
        tenant_id: tenantId,
      });

      setSuccessMessage(`"${groupName}" modifier grubu oluşturuldu.`);
      setTimeout(() => setSuccessMessage(null), 4000);

      // Reset
      setGroupName('');
      setIsRequired(false);
      setMinSelections(0);
      setMaxSelections('');
      setShowGroupModal(false);

      await fetchGroups(true);
    } catch (e) {
      console.error('Create group error:', e);
      setError(typeof e === 'string' ? e : 'Modifier grubu oluşturulurken hata.');
    } finally {
      setIsSubmittingGroup(false);
    }
  };

  const handleAddOption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addingOptionToGroup || !optionName.trim()) return;

    setIsSubmittingOption(true);
    setError(null);

    try {
      const priceCents = Math.round((parseFloat(optionPrice) || 0) * 100);

      await invoke('add_modifier_option', {
        actorRole,
        actor_role: actorRole,
        groupId: addingOptionToGroup.id,
        group_id: addingOptionToGroup.id,
        name: optionName.trim(),
        priceCents,
        price_cents: priceCents,
      });

      setSuccessMessage(`"${optionName}" seçeneği eklendi.`);
      setTimeout(() => setSuccessMessage(null), 3000);

      setOptionName('');
      setOptionPrice('0');
      setAddingOptionToGroup(null);

      await fetchGroups(true);
    } catch (e) {
      console.error('Add option error:', e);
      setError(typeof e === 'string' ? e : 'Opsiyon eklenirken hata oluştu.');
    } finally {
      setIsSubmittingOption(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingGroup) return;

    try {
      await invoke('delete_modifier_group', {
        actorRole,
        actor_role: actorRole,
        groupId: deletingGroup.id,
        group_id: deletingGroup.id,
      });

      setSuccessMessage(`"${deletingGroup.name}" grubu ve tüm seçenekleri silindi.`);
      setTimeout(() => setSuccessMessage(null), 4000);
      setDeletingGroup(null);
      await fetchGroups(true);
    } catch (e) {
      console.error('Delete modifier group error:', e);
      setError(typeof e === 'string' ? e : 'Grup silinirken hata oluştu.');
    }
  };

  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return groups;
    const lower = searchTerm.toLowerCase();
    return groups.filter(
      g =>
        g.name.toLowerCase().includes(lower) ||
        g.options.some(o => o.name.toLowerCase().includes(lower))
    );
  }, [groups, searchTerm]);

  return (
    <div className="flex flex-col gap-6 pb-12 text-foreground">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight dark:text-white text-zinc-900 flex items-center gap-2.5">
            <Wrench className="text-[#007AFF]" size={22} />
            Ürün Modifier & Seçenek Yönetimi
          </h2>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => fetchGroups(true)}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3.5 py-2 backdrop-blur-md dark:bg-white/5 bg-black/5 hover:dark:bg-white/10 hover:bg-black/10 border dark:border-white/10 border-black/[0.08] rounded-2xl dark:text-zinc-300 text-zinc-700 transition-all text-xs font-semibold disabled:opacity-50 cursor-pointer active:scale-95"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-[#007AFF]' : ''} />
            <span>Yenile</span>
          </button>
          <button
            onClick={() => {
              setError(null);
              setShowGroupModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[#007AFF] hover:bg-[#007AFF]/90 text-white rounded-2xl font-semibold transition-all text-xs shadow-sm cursor-pointer active:scale-95"
          >
            <Plus size={16} />
            <span>Yeni Modifier Grubu</span>
          </button>
        </div>
      </div>

      {/* Alert Banners */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-300 px-4 py-3 rounded-2xl text-xs flex items-center justify-between backdrop-blur-md">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 cursor-pointer">
            <X size={16} />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-300 px-4 py-3 rounded-2xl text-xs flex items-center justify-between backdrop-blur-md">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-500" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-500 hover:text-emerald-700 cursor-pointer">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Search & Counter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Grup veya seçenek adı ara..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 backdrop-blur-md dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl text-xs dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-[#007AFF] transition-all"
          />
        </div>

        <div className="flex items-center gap-2 text-xs dark:text-zinc-400 text-zinc-500 font-medium">
          <span>Toplam {groups.length} grup</span>
          <span>•</span>
          <span>
            {groups.reduce((acc, g) => acc + g.options.length, 0)} toplam opsiyon
          </span>
        </div>
      </div>

      {/* Group List */}
      {loading ? (
        <div className="flex h-48 items-center justify-center dark:text-zinc-400 text-zinc-500 gap-3">
          <RefreshCw size={24} className="animate-spin text-[#007AFF]" />
          <span>Modifier grupları yükleniyor...</span>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGroups.map(group => {
            const isExp = expanded[group.id];

            return (
              <div
                key={group.id}
                className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] rounded-3xl overflow-hidden shadow-sm hover:shadow-md transition-all"
              >
                {/* Header */}
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer hover:dark:bg-white/[0.03] hover:bg-black/[0.02] transition-colors"
                  onClick={() => setExpanded(e => ({ ...e, [group.id]: !e[group.id] }))}
                >
                  <div className="flex items-center gap-3.5">
                    <button
                      type="button"
                      className="p-1 rounded-xl dark:text-zinc-400 text-zinc-500 hover:dark:text-white hover:text-zinc-900"
                      onClick={e => {
                        e.stopPropagation();
                        setExpanded(prev => ({ ...prev, [group.id]: !prev[group.id] }));
                      }}
                    >
                      {isExp ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </button>

                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="font-bold dark:text-white text-zinc-900 text-base">{group.name}</span>
                        {group.isRequired ? (
                          <span className="text-[11px] font-bold bg-red-500/15 text-red-600 dark:text-red-400 px-2.5 py-0.5 rounded-full border border-red-500/30">
                            Zorunlu
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium dark:bg-white/5 bg-black/5 dark:text-zinc-400 text-zinc-600 px-2.5 py-0.5 rounded-full border dark:border-white/10 border-black/[0.08]">
                            İsteğe Bağlı
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs dark:text-zinc-400 text-zinc-500 mt-1">
                        <span>
                          Seçim Kuralı: Min {group.minSelections} - Max {group.maxSelections ?? 'Sınırsız'}
                        </span>
                        <span>•</span>
                        <span className="text-[#007AFF] font-medium">{group.options.length} seçenek</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => setViewingGroup(group)}
                      title="Grup Detayı"
                      className="px-3.5 py-1.5 rounded-xl text-xs font-semibold dark:text-zinc-300 text-zinc-700 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/10 hover:bg-black/5 transition-all border dark:border-white/10 border-black/[0.08] cursor-pointer"
                    >
                      Detay
                    </button>
                    <button
                      onClick={() => {
                        setAddingOptionToGroup(group);
                        setOptionName('');
                        setOptionPrice('0');
                      }}
                      title="Bu Gruba Seçenek Ekle"
                      className="flex items-center gap-1 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-[#007AFF]/15 text-[#007AFF] hover:bg-[#007AFF] hover:text-white transition-all border border-[#007AFF]/30 cursor-pointer active:scale-95"
                    >
                      <Plus size={14} />
                      <span>Opsiyon Ekle</span>
                    </button>
                    <button
                      onClick={() => setDeletingGroup(group)}
                      title="Grubu Sil"
                      className="p-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 transition-all border border-rose-500/30 cursor-pointer active:scale-95"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Body / Options */}
                {isExp && (
                  <div className="border-t dark:border-white/10 border-black/[0.08] px-5 py-4 dark:bg-white/[0.01] bg-black/[0.01]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {group.options.map(opt => (
                        <div
                          key={opt.id}
                          className="flex items-center justify-between p-3.5 rounded-2xl backdrop-blur-md dark:bg-white/[0.03] bg-white/60 border dark:border-white/10 border-black/[0.08] hover:shadow-xs transition-all"
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-[#007AFF]"></span>
                            <span className="dark:text-white text-zinc-900 text-sm font-semibold">{opt.name}</span>
                          </div>
                          <span
                            className={`text-xs font-mono font-bold ${
                              opt.priceCents > 0 ? 'text-amber-600 dark:text-amber-400' : 'dark:text-zinc-500 text-zinc-400'
                            }`}
                          >
                            {opt.priceCents > 0
                              ? `+${(opt.priceCents / 100).toFixed(2)} ₺`
                              : 'Ücretsiz'}
                          </span>
                        </div>
                      ))}

                      {group.options.length === 0 && (
                        <div className="col-span-full py-4 text-center text-xs dark:text-zinc-500 text-zinc-400 italic">
                          Bu grupta henüz seçenek tanımlanmamış. "Opsiyon Ekle" butonu ile ekleyebilirsiniz.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filteredGroups.length === 0 && (
            <div className="py-16 text-center border-2 border-dashed dark:border-white/10 border-black/10 rounded-3xl backdrop-blur-xl dark:bg-white/[0.02] bg-white/40">
              <Layers size={40} className="mx-auto dark:text-zinc-600 text-zinc-400 mb-3" />
              <p className="dark:text-zinc-300 text-zinc-700 font-semibold text-base">
                {searchTerm ? `"${searchTerm}" arama kriterine uygun grup bulunamadı.` : 'Henüz kayıtlı modifier grubu yok.'}
              </p>
              <p className="dark:text-zinc-400 text-zinc-500 text-sm mt-1">
                Menü ürünlerinize eklenebilecek seçenekler oluşturmak için grup ekleyin.
              </p>
              <button
                onClick={() => setShowGroupModal(true)}
                className="mt-4 px-5 py-2.5 bg-[#007AFF] hover:bg-[#007AFF]/90 text-white text-xs font-semibold rounded-2xl transition-all shadow-sm cursor-pointer active:scale-95"
              >
                Yeni Modifier Grubu Ekle
              </button>
            </div>
          )}
        </div>
      )}

      {/* New Group Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b dark:border-white/10 border-black/[0.08] pb-4">
              <div className="flex items-center gap-2">
                <Wrench className="text-[#007AFF]" size={22} />
                <h3 className="font-bold text-lg dark:text-white text-zinc-900">Yeni Modifier Grubu</h3>
              </div>
              <button
                onClick={() => setShowGroupModal(false)}
                className="dark:text-zinc-400 text-zinc-500 hover:dark:text-white hover:text-zinc-900 p-1.5 rounded-xl hover:dark:bg-white/10 hover:bg-black/5 transition-all cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 uppercase tracking-wider mb-1.5">
                  Grup Adı <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Pişirme Derecesi, Ekstra Malzemeler"
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  className="w-full backdrop-blur-md dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl px-4 py-2.5 dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-[#007AFF] text-sm"
                />
              </div>

              <div className="backdrop-blur-md dark:bg-white/[0.04] bg-black/[0.03] p-4 rounded-2xl border dark:border-white/10 border-black/[0.08] flex items-center justify-between">
                <div>
                  <span className="font-semibold text-sm dark:text-white text-zinc-900 block">Zorunlu Seçim mi?</span>
                  <span className="text-xs dark:text-zinc-400 text-zinc-500">
                    Sipariş girilirken bu gruptan en az 1 seçenek seçilmesi zorunlu olsun.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={isRequired}
                  onChange={e => {
                    setIsRequired(e.target.checked);
                    if (e.target.checked && minSelections === 0) setMinSelections(1);
                  }}
                  className="w-5 h-5 rounded-lg accent-[#007AFF] cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 uppercase tracking-wider mb-1.5">
                    Min Seçim
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={minSelections}
                    onChange={e => setMinSelections(parseInt(e.target.value) || 0)}
                    className="w-full backdrop-blur-md dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl px-3 py-2.5 dark:text-white text-zinc-900 focus:outline-none focus:ring-1 focus:ring-[#007AFF] text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 uppercase tracking-wider mb-1.5">
                    Max Seçim (Boş = Sınırsız)
                  </label>
                  <input
                    type="number"
                    min="1"
                    placeholder="∞"
                    value={maxSelections}
                    onChange={e => setMaxSelections(e.target.value)}
                    className="w-full backdrop-blur-md dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl px-3 py-2.5 dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-[#007AFF] text-sm"
                  />
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="submit"
                  disabled={isSubmittingGroup}
                  className="flex-1 py-2.5 bg-[#007AFF] hover:bg-[#007AFF]/90 disabled:opacity-50 text-white font-semibold rounded-2xl transition-all text-xs shadow-sm cursor-pointer active:scale-95"
                >
                  {isSubmittingGroup ? 'Kaydediliyor...' : 'Grubu Kaydet'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowGroupModal(false)}
                  className="px-5 py-2.5 dark:bg-white/10 bg-black/5 hover:dark:bg-white/15 hover:bg-black/10 dark:text-zinc-300 text-zinc-700 font-semibold rounded-2xl transition-all text-xs cursor-pointer"
                >
                  İptal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Option Modal */}
      {addingOptionToGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b dark:border-white/10 border-black/[0.08] pb-4">
              <div className="flex items-center gap-2">
                <Coins className="text-[#007AFF]" size={22} />
                <div>
                  <h3 className="font-bold text-lg dark:text-white text-zinc-900">Yeni Seçenek / Opsiyon</h3>
                  <span className="text-xs dark:text-zinc-400 text-zinc-500">Grup: {addingOptionToGroup.name}</span>
                </div>
              </div>
              <button
                onClick={() => setAddingOptionToGroup(null)}
                className="dark:text-zinc-400 text-zinc-500 hover:dark:text-white hover:text-zinc-900 p-1.5 rounded-xl hover:dark:bg-white/10 hover:bg-black/5 transition-all cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddOption} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 uppercase tracking-wider mb-1.5">
                  Seçenek Adı <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Az Pişmiş, Ekstra Cheddar, Acılı"
                  value={optionName}
                  onChange={e => setOptionName(e.target.value)}
                  className="w-full backdrop-blur-md dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl px-4 py-2.5 dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-[#007AFF] text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 uppercase tracking-wider mb-1.5">
                  Ek Fiyat (₺) (0 = Ücretsiz)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  required
                  placeholder="0.00"
                  value={optionPrice}
                  onChange={e => setOptionPrice(e.target.value)}
                  className="w-full backdrop-blur-md dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl px-4 py-2.5 dark:text-white text-zinc-900 font-mono focus:outline-none focus:ring-1 focus:ring-[#007AFF] text-sm"
                />
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="submit"
                  disabled={isSubmittingOption}
                  className="flex-1 py-2.5 bg-[#007AFF] hover:bg-[#007AFF]/90 disabled:opacity-50 text-white font-semibold rounded-2xl transition-all text-xs shadow-sm cursor-pointer active:scale-95"
                >
                  {isSubmittingOption ? 'Ekleniyor...' : 'Seçeneği Ekle'}
                </button>
                <button
                  type="button"
                  onClick={() => setAddingOptionToGroup(null)}
                  className="px-5 py-2.5 dark:bg-white/10 bg-black/5 hover:dark:bg-white/15 hover:bg-black/10 dark:text-zinc-300 text-zinc-700 font-semibold rounded-2xl transition-all text-xs cursor-pointer"
                >
                  İptal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Group Modal (Replaces window.confirm) */}
      {deletingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-red-500/15 text-red-600 dark:text-red-400 rounded-2xl">
                <AlertTriangle size={24} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg dark:text-white text-zinc-900">
                  "{deletingGroup.name}" Grubunu Sil
                </h3>
                <p className="text-sm dark:text-zinc-400 text-zinc-600 mt-1 leading-relaxed">
                  Bu modifier grubunu sildiğinizde, gruba bağlı {deletingGroup.options.length} adet seçenek de kalıcı olarak silinecektir.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-2xl transition-all text-xs shadow-sm cursor-pointer active:scale-95"
              >
                Evet, Kalıcı Olarak Sil
              </button>
              <button
                onClick={() => setDeletingGroup(null)}
                className="px-5 py-2.5 dark:bg-white/10 bg-black/5 hover:dark:bg-white/15 hover:bg-black/10 dark:text-zinc-300 text-zinc-700 font-semibold rounded-2xl transition-all text-xs cursor-pointer"
              >
                Vazgeç
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Viewing Group Detail Modal */}
      {viewingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b dark:border-white/10 border-black/[0.08] pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#007AFF]/15 text-[#007AFF] flex items-center justify-center font-bold">
                  <Wrench size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-lg dark:text-white text-zinc-900">{viewingGroup.name}</h3>
                  <span className="text-xs dark:text-zinc-400 text-zinc-500">Modifier Grubu Kartı</span>
                </div>
              </div>
              <button
                onClick={() => setViewingGroup(null)}
                className="dark:text-zinc-400 text-zinc-500 hover:dark:text-white hover:text-zinc-900 p-1.5 rounded-xl hover:dark:bg-white/10 hover:bg-black/5 transition-all cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 backdrop-blur-md dark:bg-white/[0.04] bg-black/[0.03] p-4 rounded-2xl border dark:border-white/10 border-black/[0.08] text-sm">
              <div className="flex justify-between py-1 border-b dark:border-white/10 border-black/[0.06]">
                <span className="dark:text-zinc-400 text-zinc-500">Grup ID:</span>
                <span className="font-mono text-[#007AFF] text-xs">{viewingGroup.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b dark:border-white/10 border-black/[0.06]">
                <span className="dark:text-zinc-400 text-zinc-500">Zorunluluk:</span>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full dark:bg-white/10 bg-black/5 dark:text-zinc-200 text-zinc-800">
                  {viewingGroup.isRequired ? 'Zorunlu Seçim' : 'İsteğe Bağlı'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b dark:border-white/10 border-black/[0.06]">
                <span className="dark:text-zinc-400 text-zinc-500">Seçim Sınırları:</span>
                <span className="dark:text-white text-zinc-900 font-semibold text-xs">
                  Min: {viewingGroup.minSelections} / Max: {viewingGroup.maxSelections ?? 'Sınırsız'}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="dark:text-zinc-400 text-zinc-500">Toplam Seçenek:</span>
                <span className="font-bold text-[#007AFF]">{viewingGroup.options.length} adet</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setAddingOptionToGroup(viewingGroup);
                  setViewingGroup(null);
                }}
                className="flex-1 py-2.5 bg-[#007AFF] hover:bg-[#007AFF]/90 text-white font-semibold rounded-2xl transition-all text-xs flex items-center justify-center gap-2 shadow-sm cursor-pointer active:scale-95"
              >
                <Plus size={16} />
                <span>Opsiyon Ekle</span>
              </button>
              <button
                onClick={() => setViewingGroup(null)}
                className="px-5 py-2.5 dark:bg-white/10 bg-black/5 hover:dark:bg-white/15 hover:bg-black/10 dark:text-zinc-300 text-zinc-700 font-semibold rounded-2xl transition-all text-xs cursor-pointer"
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
