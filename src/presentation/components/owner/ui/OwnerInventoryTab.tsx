import { useEffect, useState, useMemo } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../../store/useAuthStore';
import {
  Package,
  AlertTriangle,
  Plus,
  Search,
  RefreshCw,
  X,
  Sliders,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

export interface InventoryItem {
  id: string;
  name: string;
  sku: string | null;
  current_stock: number;
  unit: string;
  min_stock_alert: number | null;
}

export function OwnerInventoryTab() {
  const user = useAuthStore(state => state.user);
  const tenantId = user?.tenantId || 'DEFAULT_TENANT';

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [alerts, setAlerts] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCriticalOnly, setFilterCriticalOnly] = useState(false);

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [adjustingItem, setAdjustingItem] = useState<InventoryItem | null>(null);
  const [viewItem, setViewItem] = useState<InventoryItem | null>(null);

  // New Item Form State
  const [formName, setFormName] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formStock, setFormStock] = useState<number>(0);
  const [formUnit, setFormUnit] = useState('Adet');
  const [formMinAlert, setFormMinAlert] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Stock Adjustment Form State
  const [adjustAmount, setAdjustAmount] = useState<number>(1);
  const [adjustType, setAdjustType] = useState<'IN' | 'OUT'>('IN');
  const [adjustReason, setAdjustReason] = useState('Tedarik / Satın Alma');
  const [isAdjusting, setIsAdjusting] = useState(false);

  const fetchInventory = async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const [itemsData, alertData] = await Promise.all([
        invoke<InventoryItem[]>('get_inventory', {
          tenantId,
          tenant_id: tenantId,
        }),
        invoke<InventoryItem[]>('get_low_stock_alerts', {
          tenantId,
          tenant_id: tenantId,
        }),
      ]);

      setItems(itemsData || []);
      setAlerts(alertData || []);
    } catch (err) {
      console.error('Inventory fetch failed:', err);
      setError(typeof err === 'string' ? err : 'Stok verileri yüklenirken hata oluştu.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, [tenantId]);

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setError('Stok kalemi adı zorunludur.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await invoke('create_inventory_item', {
        tenantId,
        tenant_id: tenantId,
        name: formName.trim(),
        sku: formSku.trim() || null,
        initialStock: Number(formStock) || 0,
        initial_stock: Number(formStock) || 0,
        unit: formUnit.trim() || 'Adet',
        minStockAlert: formMinAlert > 0 ? Number(formMinAlert) : null,
        min_stock_alert: formMinAlert > 0 ? Number(formMinAlert) : null,
      });

      setSuccessMessage(`"${formName}" stok kalemi başarıyla eklendi.`);
      setTimeout(() => setSuccessMessage(null), 4000);

      // Reset
      setFormName('');
      setFormSku('');
      setFormStock(0);
      setFormUnit('Adet');
      setFormMinAlert(0);
      setIsAddModalOpen(false);

      await fetchInventory(true);
    } catch (err) {
      console.error('Create inventory error:', err);
      setError(typeof err === 'string' ? err : 'Stok kalemi eklenirken hata oluştu.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAdjustStock = async (
    item: InventoryItem,
    amountDelta: number,
    type: 'IN' | 'OUT',
    reason: string
  ) => {
    try {
      await invoke('adjust_stock', {
        tenantId,
        tenant_id: tenantId,
        itemId: item.id,
        item_id: item.id,
        quantityChange: amountDelta,
        quantity_change: amountDelta,
        movementType: type,
        movement_type: type,
        actorId: user?.userId || 'owner_user',
        actor_id: user?.userId || 'owner_user',
        reason,
      });

      setSuccessMessage(
        `${item.name} stoku ${amountDelta > 0 ? '+' : ''}${amountDelta} ${item.unit} güncellendi.`
      );
      setTimeout(() => setSuccessMessage(null), 3000);
      await fetchInventory(true);
    } catch (err) {
      console.error('Stock adjustment error:', err);
      setError(typeof err === 'string' ? err : 'Stok güncellenirken hata oluştu.');
    }
  };

  const handleCustomAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingItem) return;

    setIsAdjusting(true);
    const numericAmount = Math.abs(Number(adjustAmount));
    const delta = adjustType === 'IN' ? numericAmount : -numericAmount;

    await handleAdjustStock(adjustingItem, delta, adjustType, adjustReason);
    setIsAdjusting(false);
    setAdjustingItem(null);
  };

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch =
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.sku && item.sku.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesCritical = filterCriticalOnly
        ? item.min_stock_alert !== null && item.current_stock <= item.min_stock_alert
        : true;
      return matchesSearch && matchesCritical;
    });
  }, [items, searchTerm, filterCriticalOnly]);

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Package className="text-indigo-400" />
            Stok & Hammadde Yönetimi
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Ürün ve hammadde stoklarını takip edin, kritik seviyeleri izleyin ve stok hareketlerini kaydedin.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchInventory(true)}
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
            <span>Yeni Stok Ekle</span>
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

      {/* Critical Stock Alert Bar */}
      {alerts.length > 0 && (
        <div className="bg-red-950/30 border border-red-800/80 rounded-2xl p-4 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-red-500/10 text-red-400 mt-0.5">
              <AlertTriangle size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-red-300">
                Kritik Stok Uyarısı ({alerts.length} Kalem Eşik Değerin Altında!)
              </h3>
              <p className="text-xs text-red-200/80 mt-0.5">
                {alerts.map(a => `${a.name} (${a.current_stock} ${a.unit})`).join(', ')}
              </p>
            </div>
          </div>
          <button
            onClick={() => setFilterCriticalOnly(!filterCriticalOnly)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors border ${
              filterCriticalOnly
                ? 'bg-red-600 text-white border-red-500'
                : 'bg-red-950 text-red-300 border-red-800 hover:bg-red-900/50'
            }`}
          >
            {filterCriticalOnly ? 'Tüm Stokları Göster' : 'Sadece Kritik Olanları Filtrele'}
          </button>
        </div>
      )}

      {/* Search & Stats Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Stok kalemi veya SKU ara..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>Toplam {items.length} kalem</span>
          <span>•</span>
          <span className="text-emerald-400 font-medium">
            {items.length - alerts.length} Yeterli
          </span>
          <span>•</span>
          <span className="text-red-400 font-medium">{alerts.length} Kritik</span>
        </div>
      </div>

      {/* Inventory Table */}
      {isLoading && items.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-slate-400 gap-3">
          <RefreshCw size={24} className="animate-spin text-indigo-500" />
          <span>Stok verileri yükleniyor...</span>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-semibold bg-slate-950/40">
                <th className="py-3.5 px-5">Kalem Adı</th>
                <th className="py-3.5 px-4">SKU / Kod</th>
                <th className="py-3.5 px-4">Mevcut Stok</th>
                <th className="py-3.5 px-4">Birim</th>
                <th className="py-3.5 px-4">Kritik Sınır</th>
                <th className="py-3.5 px-5 text-right">Stok Düzeltme & İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredItems.map(item => {
                const isCritical =
                  item.min_stock_alert !== null && item.current_stock <= item.min_stock_alert;

                return (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                    onClick={() => setViewItem(item)}
                  >
                    <td className="py-3.5 px-5 font-medium text-white">
                      <div className="flex items-center gap-2">
                        <span>{item.name}</span>
                        {isCritical && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 text-red-400 border border-red-800">
                            KRİTİK
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 font-mono text-xs">
                      {item.sku || '-'}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-base">
                      <span className={isCritical ? 'text-red-400 font-extrabold' : 'text-slate-100'}>
                        {item.current_stock}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 text-xs">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        {item.unit}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 text-xs">
                      {item.min_stock_alert !== null ? `${item.min_stock_alert} ${item.unit}` : 'Belirtilmedi'}
                    </td>
                    <td className="py-3.5 px-5 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleAdjustStock(item, 1, 'IN', 'Hızlı +1 ekleme')}
                          title="Hızlı +1 Ekle"
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-400 text-xs font-bold rounded-lg transition-colors border border-slate-700"
                        >
                          +1
                        </button>
                        <button
                          onClick={() => handleAdjustStock(item, -1, 'OUT', 'Hızlı -1 düşme')}
                          title="Hızlı -1 Çıkar"
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-red-400 text-xs font-bold rounded-lg transition-colors border border-slate-700"
                        >
                          -1
                        </button>
                        <button
                          onClick={() => {
                            setAdjustingItem(item);
                            setAdjustAmount(1);
                            setAdjustType('IN');
                            setAdjustReason('Tedarik / Satın Alma');
                          }}
                          className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 text-xs font-medium rounded-lg transition-colors border border-indigo-500/30"
                        >
                          <Sliders size={13} />
                          <span>Düzelt</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-slate-500">
                    <Package size={40} className="mx-auto text-slate-600 mb-3" />
                    <p className="text-slate-400 font-medium text-base">
                      {searchTerm || filterCriticalOnly
                        ? 'Filtreleme kriterlerine uygun stok kalemi bulunamadı.'
                        : 'Henüz kayıtlı stok kalemi bulunmuyor.'}
                    </p>
                    {!searchTerm && !filterCriticalOnly && (
                      <button
                        onClick={() => {
                          setError(null);
                          setIsAddModalOpen(true);
                        }}
                        className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors inline-flex items-center gap-2"
                      >
                        <Plus size={16} />
                        <span>İlk Stok Kalemini Ekle</span>
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* New Item Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Package className="text-indigo-400" size={22} />
                <h3 className="font-bold text-lg text-white">Yeni Stok Kalemi Ekle</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateItem} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Ürün / Malzeme Adı <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Dana Kıyma, Köy Ayranı, Patates"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    SKU / Barkod
                  </label>
                  <input
                    type="text"
                    placeholder="Örn: ET-001"
                    value={formSku}
                    onChange={e => setFormSku(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Ölçü Birimi
                  </label>
                  <select
                    value={formUnit}
                    onChange={e => setFormUnit(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500 text-sm"
                  >
                    <option value="Adet">Adet</option>
                    <option value="Kg">Kg</option>
                    <option value="Gram">Gram</option>
                    <option value="Lt">Lt</option>
                    <option value="Porsiyon">Porsiyon</option>
                    <option value="Kutu">Kutu</option>
                    <option value="Çuval">Çuval</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Başlangıç Miktarı
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={formStock}
                    onChange={e => setFormStock(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Kritik Sınır (Opsiyonel)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="0"
                    value={formMinAlert}
                    onChange={e => setFormMinAlert(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500 text-sm"
                  />
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl transition-colors text-sm shadow-lg shadow-indigo-600/20"
                >
                  {isSubmitting ? 'Kaydediliyor...' : 'Stok Kalemini Ekle'}
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

      {/* Stock Adjustment Modal */}
      {adjustingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Sliders className="text-indigo-400" size={22} />
                <div>
                  <h3 className="font-bold text-lg text-white">Stok Hareketi / Düzeltme</h3>
                  <span className="text-xs text-slate-400">{adjustingItem.name}</span>
                </div>
              </div>
              <button
                onClick={() => setAdjustingItem(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCustomAdjustSubmit} className="space-y-4">
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex justify-between items-center text-sm">
                <span className="text-slate-400">Şu Anki Stok:</span>
                <span className="text-lg font-bold text-white font-mono">
                  {adjustingItem.current_stock} {adjustingItem.unit}
                </span>
              </div>

              {/* In / Out Switch */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Hareket Yönü
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustType('IN');
                      setAdjustReason('Tedarik / Satın Alma');
                    }}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                      adjustType === 'IN'
                        ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300 shadow-md shadow-emerald-950'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <ArrowUpRight size={18} />
                    <span>Stok Girişi (+)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAdjustType('OUT');
                      setAdjustReason('Zayi / Fire / Dökülme');
                    }}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                      adjustType === 'OUT'
                        ? 'bg-red-950/80 border-red-600 text-red-300 shadow-md shadow-red-950'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <ArrowDownRight size={18} />
                    <span>Stok Çıkışı (-)</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Miktar ({adjustingItem.unit})
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.01"
                  required
                  value={adjustAmount}
                  onChange={e => setAdjustAmount(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white font-mono text-base focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Hareket Sebebi
                </label>
                <select
                  value={adjustReason}
                  onChange={e => setAdjustReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500 text-sm"
                >
                  {adjustType === 'IN' ? (
                    <>
                      <option value="Tedarik / Satın Alma">Tedarik / Satın Alma</option>
                      <option value="Müşteri İadesi">Müşteri İadesi</option>
                      <option value="Sayım Fazlası">Sayım Fazlası</option>
                      <option value="Manuel Düzeltme">Manuel Düzeltme</option>
                    </>
                  ) : (
                    <>
                      <option value="Zayi / Fire / Dökülme">Zayi / Fire / Dökülme</option>
                      <option value="Son Kullanma Tarihi Geçti">Son Kullanma Tarihi Geçti</option>
                      <option value="Sayım Eksiği">Sayım Eksiği</option>
                      <option value="Personele İkram">Personele İkram</option>
                      <option value="Manuel Düşüş">Manuel Düşüş</option>
                    </>
                  )}
                </select>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="submit"
                  disabled={isAdjusting || adjustAmount <= 0}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl transition-colors text-sm shadow-lg shadow-indigo-600/20"
                >
                  {isAdjusting ? 'İşleniyor...' : 'Hareketi Onayla'}
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustingItem(null)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors text-sm"
                >
                  İptal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Item Details Modal */}
      {viewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold">
                  <Package size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">{viewItem.name}</h3>
                  <span className="text-xs text-slate-400">Stok Kalem Kartı</span>
                </div>
              </div>
              <button
                onClick={() => setViewItem(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800 text-sm">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Kalem ID:</span>
                <span className="font-mono text-indigo-300 text-xs">{viewItem.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">SKU / Kod:</span>
                <span className="font-mono text-white text-xs">{viewItem.sku || 'Atanmamış'}</span>
              </div>
              <div className="flex justify-between items-baseline py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Mevcut Miktar:</span>
                <span className="text-xl font-bold text-white font-mono">
                  {viewItem.current_stock} {viewItem.unit}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Kritik Stok Uyarısı:</span>
                <span className="text-slate-300 text-xs">
                  {viewItem.min_stock_alert !== null
                    ? `${viewItem.min_stock_alert} ${viewItem.unit}`
                    : 'Uyarı sınırı yok'}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Stok Durumu:</span>
                {viewItem.min_stock_alert !== null && viewItem.current_stock <= viewItem.min_stock_alert ? (
                  <span className="text-xs font-bold text-red-400 bg-red-950 px-2 py-0.5 rounded border border-red-800">
                    Kritik Seviyede
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                    Yeterli Stok
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setAdjustingItem(viewItem);
                  setViewItem(null);
                }}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
              >
                <Sliders size={16} />
                <span>Stok Hareketi Gir</span>
              </button>
              <button
                onClick={() => setViewItem(null)}
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
