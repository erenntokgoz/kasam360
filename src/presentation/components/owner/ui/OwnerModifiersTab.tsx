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
    <div className="flex flex-col gap-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Wrench className="text-indigo-400" />
            Ürün Modifier & Seçenek Yönetimi
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Ürünlere uygulanacak ek malzemeleri, pişme tercihlerini ve opsiyon gruplarını yönetin.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchGroups(true)}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-slate-700 hover:border-slate-600 rounded-xl text-slate-300 hover:text-white transition-colors text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin text-indigo-400' : ''} />
            <span>Yenile</span>
          </button>
          <button
            onClick={() => {
              setError(null);
              setShowGroupModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors text-sm shadow-lg shadow-indigo-600/20"
          >
            <Plus size={18} />
            <span>Yeni Modifier Grubu</span>
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

      {/* Search & Counter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Grup veya seçenek adı ara..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>Toplam {groups.length} grup</span>
          <span>•</span>
          <span>
            {groups.reduce((acc, g) => acc + g.options.length, 0)} toplam opsiyon
          </span>
        </div>
      </div>

      {/* Group List */}
      {loading ? (
        <div className="flex h-48 items-center justify-center text-slate-400 gap-3">
          <RefreshCw size={24} className="animate-spin text-indigo-500" />
          <span>Modifier grupları yükleniyor...</span>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGroups.map(group => {
            const isExp = expanded[group.id];

            return (
              <div
                key={group.id}
                className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg transition-all"
              >
                {/* Header */}
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-800/40 transition-colors"
                  onClick={() => setExpanded(e => ({ ...e, [group.id]: !e[group.id] }))}
                >
                  <div className="flex items-center gap-3.5">
                    <button
                      type="button"
                      className="p-1 rounded-lg text-slate-400 hover:text-white"
                      onClick={e => {
                        e.stopPropagation();
                        setExpanded(prev => ({ ...prev, [group.id]: !prev[group.id] }));
                      }}
                    >
                      {isExp ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </button>

                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="font-bold text-white text-base">{group.name}</span>
                        {group.isRequired ? (
                          <span className="text-[11px] font-bold bg-red-950 text-red-400 px-2 py-0.5 rounded-md border border-red-800">
                            Zorunlu
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md">
                            İsteğe Bağlı
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                        <span>
                          Seçim Kuralı: Min {group.minSelections} - Max {group.maxSelections ?? 'Sınırsız'}
                        </span>
                        <span>•</span>
                        <span className="text-indigo-400 font-medium">{group.options.length} seçenek</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => setViewingGroup(group)}
                      title="Grup Detayı"
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors border border-slate-700"
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
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 transition-colors border border-indigo-500/30"
                    >
                      <Plus size={14} />
                      <span>Opsiyon Ekle</span>
                    </button>
                    <button
                      onClick={() => setDeletingGroup(group)}
                      title="Grubu Sil"
                      className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-950/60 transition-colors border border-red-900/40"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Body / Options */}
                {isExp && (
                  <div className="border-t border-slate-800/80 px-5 py-4 bg-slate-950/40">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {group.options.map(opt => (
                        <div
                          key={opt.id}
                          className="flex items-center justify-between p-3 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                            <span className="text-white text-sm font-medium">{opt.name}</span>
                          </div>
                          <span
                            className={`text-xs font-mono font-bold ${
                              opt.priceCents > 0 ? 'text-amber-400' : 'text-slate-500'
                            }`}
                          >
                            {opt.priceCents > 0
                              ? `+${(opt.priceCents / 100).toFixed(2)} ₺`
                              : 'Ücretsiz'}
                          </span>
                        </div>
                      ))}

                      {group.options.length === 0 && (
                        <div className="col-span-full py-4 text-center text-xs text-slate-500 italic">
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
            <div className="py-16 text-center border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/30">
              <Layers size={40} className="mx-auto text-slate-600 mb-3" />
              <p className="text-slate-400 font-medium text-base">
                {searchTerm ? `"${searchTerm}" arama kriterine uygun grup bulunamadı.` : 'Henüz kayıtlı modifier grubu yok.'}
              </p>
              <p className="text-slate-500 text-sm mt-1">
                Menü ürünlerinize eklenebilecek seçenekler oluşturmak için grup ekleyin.
              </p>
              <button
                onClick={() => setShowGroupModal(true)}
                className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors"
              >
                Yeni Modifier Grubu Ekle
              </button>
            </div>
          )}
        </div>
      )}

      {/* New Group Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Wrench className="text-indigo-400" size={22} />
                <h3 className="font-bold text-lg text-white">Yeni Modifier Grubu</h3>
              </div>
              <button
                onClick={() => setShowGroupModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Grup Adı <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Pişirme Derecesi, Ekstra Malzemeler"
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm"
                />
              </div>

              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-sm text-white block">Zorunlu Seçim mi?</span>
                  <span className="text-xs text-slate-400">
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
                  className="w-5 h-5 rounded accent-indigo-600 cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Min Seçim
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={minSelections}
                    onChange={e => setMinSelections(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Max Seçim (Boş = Sınırsız)
                  </label>
                  <input
                    type="number"
                    min="1"
                    placeholder="∞"
                    value={maxSelections}
                    onChange={e => setMaxSelections(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm"
                  />
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="submit"
                  disabled={isSubmittingGroup}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl transition-colors text-sm shadow-lg shadow-indigo-600/20"
                >
                  {isSubmittingGroup ? 'Kaydediliyor...' : 'Grubu Kaydet'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowGroupModal(false)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors text-sm"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Coins className="text-indigo-400" size={22} />
                <div>
                  <h3 className="font-bold text-lg text-white">Yeni Seçenek / Opsiyon</h3>
                  <span className="text-xs text-slate-400">Grup: {addingOptionToGroup.name}</span>
                </div>
              </div>
              <button
                onClick={() => setAddingOptionToGroup(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddOption} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Seçenek Adı <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Az Pişmiş, Ekstra Cheddar, Acılı"
                  value={optionName}
                  onChange={e => setOptionName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
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
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white font-mono focus:outline-none focus:border-indigo-500 text-sm"
                />
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="submit"
                  disabled={isSubmittingOption}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl transition-colors text-sm shadow-lg shadow-indigo-600/20"
                >
                  {isSubmittingOption ? 'Ekleniyor...' : 'Seçeneği Ekle'}
                </button>
                <button
                  type="button"
                  onClick={() => setAddingOptionToGroup(null)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors text-sm"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-red-500/10 text-red-400 rounded-xl">
                <AlertTriangle size={24} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-white">
                  "{deletingGroup.name}" Grubunu Sil
                </h3>
                <p className="text-sm text-slate-300 mt-1 leading-relaxed">
                  Bu modifier grubunu sildiğinizde, gruba bağlı {deletingGroup.options.length} adet seçenek de kalıcı olarak silinecektir.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-colors text-sm shadow-lg shadow-red-600/20"
              >
                Evet, Kalıcı Olarak Sil
              </button>
              <button
                onClick={() => setDeletingGroup(null)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors text-sm"
              >
                Vazgeç
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Viewing Group Detail Modal */}
      {viewingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold">
                  <Wrench size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">{viewingGroup.name}</h3>
                  <span className="text-xs text-slate-400">Modifier Grubu Kartı</span>
                </div>
              </div>
              <button
                onClick={() => setViewingGroup(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800 text-sm">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Grup ID:</span>
                <span className="font-mono text-indigo-300 text-xs">{viewingGroup.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Zorunluluk:</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-200">
                  {viewingGroup.isRequired ? 'Zorunlu Seçim' : 'İsteğe Bağlı'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Seçim Sınırları:</span>
                <span className="text-white text-xs">
                  Min: {viewingGroup.minSelections} / Max: {viewingGroup.maxSelections ?? 'Sınırsız'}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Toplam Seçenek:</span>
                <span className="font-bold text-indigo-400">{viewingGroup.options.length} adet</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setAddingOptionToGroup(viewingGroup);
                  setViewingGroup(null);
                }}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
              >
                <Plus size={16} />
                <span>Opsiyon Ekle</span>
              </button>
              <button
                onClick={() => setViewingGroup(null)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors text-sm"
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
