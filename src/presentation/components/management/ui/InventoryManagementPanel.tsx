import React, { useEffect, useState, useCallback } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../../store/useAuthStore';
import { toast as useToast } from '@core/components/ui/toast';
import { 
  Boxes, 
  AlertTriangle, 
  Plus, 
  Search, 
  RefreshCw, 
  ArrowDownRight, 
  ArrowUpRight, 
  X,
  PackageCheck
} from 'lucide-react';

export interface InventoryItem {
  id: string;
  name: string;
  sku?: string | null;
  current_stock: number;
  unit: string;
  min_stock_alert?: number | null;
}

export function InventoryManagementPanel() {
  const user = useAuthStore(s => s.user);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [lowStockItems, setLowStockItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'ALL' | 'CRITICAL'>('ALL');

  // Modallar
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [selectedItemForAdjust, setSelectedItemForAdjust] = useState<InventoryItem | null>(null);

  // Form State - Yeni Kalem
  const [newItemName, setNewItemName] = useState('');
  const [newItemSku, setNewItemSku] = useState('');
  const [newItemStock, setNewItemStock] = useState<number>(0);
  const [newItemUnit, setNewItemUnit] = useState('adet');
  const [newItemMinAlert, setNewItemMinAlert] = useState<number | ''>('');

  // Form State - Stok Hareketi
  const [movementType, setMovementType] = useState<'IN' | 'OUT' | 'WASTE' | 'ADJUST'>('IN');
  const [adjustQuantity, setAdjustQuantity] = useState<number>(1);
  const [adjustReason, setAdjustReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addToast = (msg: string, type: 'success' | 'error' | 'info') => useToast.add({ title: msg, type });

  const fetchInventory = useCallback(async (showLoader = false) => {
    if (showLoader) setIsRefreshing(true);
    try {
      const [inv, alerts] = await Promise.all([
        invoke<InventoryItem[]>('get_inventory'),
        invoke<InventoryItem[]>('get_low_stock_alerts'),
      ]);
      setItems(inv || []);
      setLowStockItems(alerts || []);
    } catch (error) {
      console.error('Failed to fetch inventory:', error);
      addToast('Stok verileri yüklenirken hata oluştu.', 'error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) {
      addToast('Ürün / Hammadde adı gereklidir.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await invoke('create_inventory_item', {
        name: newItemName.trim(),
        sku: newItemSku.trim() || null,
        initialStock: Number(newItemStock) || 0,
        unit: newItemUnit.trim() || 'adet',
        minStockAlert: newItemMinAlert !== '' ? Number(newItemMinAlert) : null,
      });

      addToast('Stok kalemi başarıyla eklendi.', 'success');
      setIsCreateModalOpen(false);
      setNewItemName('');
      setNewItemSku('');
      setNewItemStock(0);
      setNewItemUnit('adet');
      setNewItemMinAlert('');
      await fetchInventory(false);
    } catch (error) {
      console.error('Failed to create inventory item:', error);
      addToast(`Stok kalemi eklenemedi: ${error}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenAdjust = (item: InventoryItem) => {
    setSelectedItemForAdjust(item);
    setMovementType('IN');
    setAdjustQuantity(1);
    setAdjustReason('');
    setIsAdjustModalOpen(true);
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemForAdjust) return;
    if (adjustQuantity <= 0) {
      addToast('Geçerli bir miktar girin.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      // IN pozitif, OUT ve WASTE negatif miktar
      const qtyChange = movementType === 'IN' ? adjustQuantity : -adjustQuantity;

      await invoke('adjust_stock', {
        itemId: selectedItemForAdjust.id,
        quantityChange: qtyChange,
        movementType: movementType,
        actorId: user?.userId || 'MANAGER',
        reason: adjustReason.trim() || null,
      });

      addToast('Stok güncellemesi kaydedildi.', 'success');
      setIsAdjustModalOpen(false);
      await fetchInventory(false);
    } catch (error) {
      console.error('Failed to adjust stock:', error);
      addToast(`Stok ayarlanamadı: ${error}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredItems = items.filter(item => {
    const matchesFilter = filterMode === 'ALL' || (item.min_stock_alert !== null && item.min_stock_alert !== undefined && item.current_stock <= item.min_stock_alert);
    const matchesSearch = 
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (item.sku && item.sku.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center text-slate-400">Yükleniyor...</div>;
  }

  return (
    <div className="flex flex-col h-full space-y-6 text-slate-200">
      {/* Kritik Stok Uyarı Bandı */}
      {lowStockItems.length > 0 && (
        <div className="bg-amber-950/40 border border-amber-600/60 rounded-xl p-4 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400">
              <AlertTriangle size={24} />
            </div>
            <div>
              <h4 className="font-bold text-amber-300">
                {lowStockItems.length} Kalemde Kritik Stok Seviyesi!
              </h4>
              <p className="text-xs text-amber-200/80 mt-0.5">
                Şu kalemler belirlenen asgari stok sınırının altına düşmüştür: {lowStockItems.map(i => i.name).slice(0, 3).join(', ')}{lowStockItems.length > 3 ? '...' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => setFilterMode('CRITICAL')}
            className="px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors"
          >
            Kritikleri Göster
          </button>
        </div>
      )}

      {/* KPI Kartları */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Toplam Stok Kalemi</span>
            <p className="text-3xl font-bold text-white mt-1">{items.length}</p>
          </div>
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl">
            <Boxes size={24} />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Kritik Stok Uyarısı</span>
            <p className={`text-3xl font-bold mt-1 ${lowStockItems.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {lowStockItems.length}
            </p>
          </div>
          <div className={`p-3 rounded-xl ${lowStockItems.length > 0 ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
            <AlertTriangle size={24} />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Yeterli Stok Kalemi</span>
            <p className="text-3xl font-bold text-emerald-400 mt-1">{items.length - lowStockItems.length}</p>
          </div>
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl">
            <PackageCheck size={24} />
          </div>
        </div>
      </div>

      {/* Filtre ve Aksiyon Çubuğu */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/70 border border-slate-800 p-3 rounded-xl">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterMode('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filterMode === 'ALL' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            Tüm Stoklar ({items.length})
          </button>
          <button
            onClick={() => setFilterMode('CRITICAL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filterMode === 'CRITICAL' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            Kritik Seviyedekiler ({lowStockItems.length})
          </button>
        </div>

        <div className="flex items-center gap-3 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Ürün adı veya barkod/SKU ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <button
            onClick={() => fetchInventory(true)}
            disabled={isRefreshing}
            className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
            title="Yenile"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold shadow transition-colors"
          >
            <Plus size={16} />
            Yeni Kalem
          </button>
        </div>
      </div>

      {/* Stok Listesi Tablosu */}
      <div className="flex-1 overflow-auto rounded-xl border border-slate-800 bg-slate-900">
        {filteredItems.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            Kayıtlı stok kalemi bulunamadı.
          </div>
        ) : (
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="sticky top-0 bg-slate-950/90 backdrop-blur text-xs uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-6 py-4">Ürün / Hammadde</th>
                <th className="px-6 py-4">SKU / Barkod</th>
                <th className="px-6 py-4">Mevcut Stok</th>
                <th className="px-6 py-4">Birim</th>
                <th className="px-6 py-4">Kritik Eşik</th>
                <th className="px-6 py-4">Durum</th>
                <th className="px-6 py-4 text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredItems.map(item => {
                const isLow = item.min_stock_alert !== null && item.min_stock_alert !== undefined && item.current_stock <= item.min_stock_alert;

                return (
                  <tr 
                    key={item.id} 
                    onClick={() => handleOpenAdjust(item)}
                    className="hover:bg-slate-800/60 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4 font-semibold text-white">{item.name}</td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-400">{item.sku || '-'}</td>
                    <td className="px-6 py-4 font-bold text-base">
                      <span className={isLow ? 'text-amber-400' : 'text-emerald-400'}>
                        {item.current_stock}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-400">{item.unit}</td>
                    <td className="px-6 py-4 text-slate-400">
                      {item.min_stock_alert !== null && item.min_stock_alert !== undefined ? `${item.min_stock_alert} ${item.unit}` : '-'}
                    </td>
                    <td className="px-6 py-4">
                      {isLow ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          <AlertTriangle size={12} />
                          Kritik
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Normal
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleOpenAdjust(item)}
                        className="px-3 py-1.5 text-xs font-semibold bg-indigo-600/30 hover:bg-indigo-600 text-indigo-300 hover:text-white rounded-lg border border-indigo-500/40 transition-colors"
                      >
                        Stok Düzenle
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* MODAL 1: Yeni Stok Kalemi Ekle */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-white">Yeni Stok Kalemi Ekle</h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateItem} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Ürün / Hammadde Adı *</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Dana Kıyma, Süt, Kahve"
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">SKU / Barkod Kodu</label>
                <input
                  type="text"
                  placeholder="Örn: ET-001"
                  value={newItemSku}
                  onChange={e => setNewItemSku(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Başlangıç Stoku</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newItemStock}
                    onChange={e => setNewItemStock(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Ölçü Birimi</label>
                  <select
                    value={newItemUnit}
                    onChange={e => setNewItemUnit(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-indigo-500"
                  >
                    <option value="adet">adet</option>
                    <option value="kg">kg</option>
                    <option value="gr">gr</option>
                    <option value="lt">lt</option>
                    <option value="porsiyon">porsiyon</option>
                    <option value="koli">koli</option>
                    <option value="paket">paket</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Kritik Stok Uyarısı (Eşik Miktarı)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Bu miktarın altına indiğinde uyarı ver"
                  value={newItemMinAlert}
                  onChange={e => setNewItemMinAlert(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
                >
                  {isSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Stok Düzenle / Hareketi */}
      {isAdjustModalOpen && selectedItemForAdjust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-white">Stok Hareketi / Düzenleme</h3>
                <p className="text-xs text-slate-400">{selectedItemForAdjust.name} (Mevcut: {selectedItemForAdjust.current_stock} {selectedItemForAdjust.unit})</p>
              </div>
              <button
                onClick={() => setIsAdjustModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAdjustStock} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">İşlem Türü</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setMovementType('IN')}
                    className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 border transition-colors ${
                      movementType === 'IN'
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <ArrowUpRight size={14} />
                    Giriş (Ekle)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMovementType('OUT')}
                    className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 border transition-colors ${
                      movementType === 'OUT'
                        ? 'bg-amber-600 border-amber-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <ArrowDownRight size={14} />
                    Çıkış (Düş)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMovementType('WASTE')}
                    className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 border transition-colors ${
                      movementType === 'WASTE'
                        ? 'bg-red-600 border-red-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <AlertTriangle size={14} />
                    Zayiat / Fire
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Miktar ({selectedItemForAdjust.unit}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={adjustQuantity}
                  onChange={e => setAdjustQuantity(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Gerekçe / Açıklama</label>
                <input
                  type="text"
                  placeholder="Örn: Haftalık sevkiyat, kırılma, zayiat"
                  value={adjustReason}
                  onChange={e => setAdjustReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="p-3 bg-slate-950 rounded-lg text-xs text-slate-400">
                <span>İşlem Sonrası Tahmini Stok: </span>
                <strong className="text-white">
                  {movementType === 'IN' 
                    ? selectedItemForAdjust.current_stock + adjustQuantity
                    : Math.max(0, selectedItemForAdjust.current_stock - adjustQuantity)} {selectedItemForAdjust.unit}
                </strong>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
                >
                  {isSubmitting ? 'Kaydediliyor...' : 'Uygula'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
