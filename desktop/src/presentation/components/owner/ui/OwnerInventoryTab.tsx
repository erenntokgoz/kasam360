import { useEffect, useState, useMemo, useCallback } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../../store/useAuthStore';
import {
  Package,
  Plus,
  Search,
  RefreshCw,
  X,
  Sliders,
  ArrowUpRight,
  ArrowDownRight,
  Lock,
  Utensils,
  Layers,
  ChefHat,
  Trash2,
  Gauge,
} from 'lucide-react';
import { toast as useToast } from '@core/components/ui/toast';
import { Inventory360Tab } from '../inventory/Inventory360Tab';

export interface InventoryItem {
  id: string;
  name: string;
  sku: string | null;
  current_stock: number;
  unit: string;
  min_stock_alert: number | null;
}

export interface ProductSummary {
  id: string;
  name: string;
  price_cents: number;
  category_id?: string;
}

export interface RecipeIngredientItem {
  inventoryItemId: string;
  inventoryItemName: string;
  quantity: number;
  unit: string;
}

export interface ProductRecipe {
  productId: string;
  productName: string;
  ingredients: RecipeIngredientItem[];
  instructions?: string;
}

// Apple Sağlık / Borsa tarzı mini trend çizgi grafiği
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

// Varsayılan reçete şablonları
const DEFAULT_RECIPES: ProductRecipe[] = [
  {
    productId: 'prd-009',
    productName: 'Karışık Tost',
    ingredients: [
      { inventoryItemId: 'inv-004', inventoryItemName: 'Kaşar Peyniri', quantity: 60, unit: 'Gram' },
      { inventoryItemId: 'inv-003', inventoryItemName: 'Köy Yumurtası', quantity: 1, unit: 'Adet' },
    ],
    instructions: 'Çift kaşarlı ve tereyağlı preslenir.',
  },
  {
    productId: 'prd-003',
    productName: 'Sütlü Kahve',
    ingredients: [
      { inventoryItemId: 'inv-005', inventoryItemName: 'Kahve Çekirdeği (Espresso)', quantity: 18, unit: 'Gram' },
      { inventoryItemId: 'inv-002', inventoryItemName: 'Tam Yağlı Süt', quantity: 0.18, unit: 'Lt' },
    ],
    instructions: 'Single shot espresso üzerine 65 derece buharlanmış süt.',
  },
];

// Stok & Reçete (Inventory & Recipes) Yönetim Paneli
export function OwnerInventoryTab() {
  const user = useAuthStore((state) => state.user);
  const tenantId = user?.tenantId || 'DEFAULT_TENANT';
  const addToast = (msg: string, type: 'success' | 'error' | 'info') => useToast.add({ title: msg, type });

  // Alt Sekmeler: 'INVENTORY' (Hammadde & Stok) | 'RECIPES' (Ürün Reçeteleri)
  // | 'ENVANTER360' (Faz 12)
  const [subTab, setSubTab] = useState<'INVENTORY' | 'RECIPES' | 'ENVANTER360'>('INVENTORY');

  // Stok Verileri
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [alerts, setAlerts] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Arama & Filtre
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCriticalOnly, setFilterCriticalOnly] = useState(false);

  // Modal Durumları
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [viewItem, setViewItem] = useState<InventoryItem | null>(null);

  // Doğrudan Stok Ekleme Modalı
  const [directAddModalItem, setDirectAddModalItem] = useState<InventoryItem | null>(null);
  const [directAddAmount, setDirectAddAmount] = useState<number>(5);

  // Fire / Zayi Düşümü (Patron Onayı Gerektiren) Modal Durumu
  const [wasteModalItem, setWasteModalItem] = useState<InventoryItem | null>(null);
  const [wasteAmount, setWasteAmount] = useState<number>(1);
  const [wasteReason, setWasteReason] = useState('Bozulma / Son Kullanma');
  const [wasteOwnerPin, setWasteOwnerPin] = useState('');
  const [wastePinError, setWastePinError] = useState<string | null>(null);
  const [isProcessingWaste, setIsProcessingWaste] = useState(false);

  // Yeni Hammadde Kalemi Form Durumu
  const [formName, setFormName] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formStock, setFormStock] = useState<number>(0);
  const [formUnit, setFormUnit] = useState('Kg');
  const [formMinAlert, setFormMinAlert] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reçete Yönetimi Verileri
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [recipes, setRecipes] = useState<ProductRecipe[]>(() => {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('kasam360_product_recipes');
        if (saved) return JSON.parse(saved);
      } catch {
        // Hata durumunda varsayılana dön
      }
    }
    return DEFAULT_RECIPES;
  });

  // Reçete Bağlama / Düzenleme Modalı
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<ProductRecipe | null>(null);
  const [recipeSelectedProductId, setRecipeSelectedProductId] = useState('');
  const [recipeIngredients, setRecipeIngredients] = useState<RecipeIngredientItem[]>([]);
  const [recipeInstructions, setRecipeInstructions] = useState('');

  // Reçeteleri yerel depolamada sakla
  const saveRecipes = (updated: ProductRecipe[]) => {
    setRecipes(updated);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('kasam360_product_recipes', JSON.stringify(updated));
    }
  };

  // Envanter ve menü ürünlerini arka uçtan çek
  const fetchInventory = useCallback(async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const [itemsData, alertData, prodsData] = await Promise.all([
        invoke<InventoryItem[]>('get_inventory', { tenantId, tenant_id: tenantId }),
        invoke<InventoryItem[]>('get_low_stock_alerts', { tenantId, tenant_id: tenantId }),
        invoke<ProductSummary[]>('get_management_products', { actorRole: 'OWNER' }).catch(() => []),
      ]);

      setItems(itemsData || []);
      setAlerts(alertData || []);
      setProducts(prodsData || []);
    } catch (err) {
      console.error('Envanter yükleme hatası:', err);
      setError(typeof err === 'string' ? err : 'Stok verileri yüklenemedi.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  // Yeni hammadde kalemi oluşturma (et, süt, yumurta vb.)
  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setError('Hammadde adı zorunludur.');
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
        unit: formUnit.trim() || 'Kg',
        minStockAlert: formMinAlert > 0 ? Number(formMinAlert) : null,
        min_stock_alert: formMinAlert > 0 ? Number(formMinAlert) : null,
      });

      addToast(`"${formName}" hammadde kalemine eklendi.`, 'success');

      setFormName('');
      setFormSku('');
      setFormStock(0);
      setFormUnit('Kg');
      setFormMinAlert(0);
      setIsAddModalOpen(false);

      await fetchInventory(true);
    } catch (err) {
      console.error('Stok kalemi oluşturma hatası:', err);
      setError(typeof err === 'string' ? err : 'Hammadde kalemi eklenemedi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // DOĞRUDAN STOK EKLEME: Patron onayı istemez, doğrudan işlenir
  const handleDirectAddStock = async (item: InventoryItem, amountToAdd: number) => {
    if (amountToAdd <= 0) return;
    try {
      await invoke('adjust_stock', {
        tenantId,
        tenant_id: tenantId,
        itemId: item.id,
        item_id: item.id,
        quantityChange: amountToAdd,
        quantity_change: amountToAdd,
        movementType: 'IN',
        movement_type: 'IN',
        actorId: user?.name || 'Patron',
        actor_id: user?.name || 'Patron',
        reason: 'Hammadde Girişi (İkmal)',
      });

      addToast(`+${amountToAdd} ${item.unit} ${item.name} stoka eklendi.`, 'success');
      setDirectAddModalItem(null);
      await fetchInventory(true);
    } catch (err) {
      console.error('Stok ekleme hatası:', err);
      addToast('Stok eklenirken hata oluştu.', 'error');
    }
  };

  // STOK EKSİLT (FİRE / ZAYİ): Patron Onayı ve PIN doğrulaması gerektirir!
  const handleWasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wasteModalItem) return;

    if (!wasteOwnerPin || wasteOwnerPin.length < 4) {
      setWastePinError('Fire onayı için geçerli Patron PIN kodu giriniz.');
      return;
    }

    const numAmount = Number(wasteAmount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setWastePinError('Lütfen 0 dan büyük geçerli bir fire miktarı giriniz.');
      return;
    }

    setIsProcessingWaste(true);
    setWastePinError(null);

    try {
      // 1. Patron PIN doğrulaması: Girilen PIN gerçekten OWNER veya MASTER rolüne mi ait?
      const authUser = await invoke<{ role?: string; name?: string }>('auth_login', {
        pin: wasteOwnerPin,
        tenant_id: tenantId,
        tenantId,
      });

      if (!authUser || (authUser.role !== 'OWNER' && authUser.role !== 'MASTER')) {
        setWastePinError('Yetkisiz işlem: Fire onayı yalnızca İşletme Sahibi (Patron) veya Master PIN onayı ile verilebilir.');
        setIsProcessingWaste(false);
        return;
      }

      const delta = -Math.abs(numAmount);

      // 2. Patron onayı doğrulandı, stok düşümünü gerçekleştir
      await invoke('adjust_stock', {
        tenantId,
        tenant_id: tenantId,
        itemId: wasteModalItem.id,
        item_id: wasteModalItem.id,
        quantityChange: delta,
        quantity_change: delta,
        movementType: 'OUT',
        movement_type: 'OUT',
        actorId: `${authUser.name || 'Patron'} (Onaylı PIN)`,
        actor_id: `${authUser.name || 'Patron'} (Onaylı PIN)`,
        reason: `[PATRON ONAYLI FİRE] ${wasteReason}`,
      });

      addToast(
        `Patron onayıyla (${authUser.name || 'Patron'}) ${wasteModalItem.name} için ${wasteAmount} ${wasteModalItem.unit} fire kaydı düşüldü.`,
        'success'
      );

      setWasteModalItem(null);
      setWasteOwnerPin('');
      setWasteAmount(1);
      await fetchInventory(true);
    } catch (err) {
      console.error('Fire onaylama hatası:', err);
      setWastePinError(typeof err === 'string' ? err : 'Yetkilendirme başarısız veya geçersiz Patron PIN kodu.');
    } finally {
      setIsProcessingWaste(false);
    }
  };

  // Reçete Kaydetme (Menü ürününe reçete gramajları bağlama)
  const handleSaveRecipe = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipeSelectedProductId) {
      addToast('Lütfen reçete bağlanacak menü ürününü seçin.', 'error');
      return;
    }
    const product = products.find((p) => p.id === recipeSelectedProductId);
    if (!product) return;

    const validIngredients = recipeIngredients.filter((ing) => ing.quantity > 0);
    if (validIngredients.length === 0) {
      addToast('Lütfen en az bir hammadde için geçerli gramaj miktarı giriniz.', 'error');
      return;
    }

    const newRecipe: ProductRecipe = {
      productId: product.id,
      productName: product.name,
      ingredients: validIngredients,
      instructions: recipeInstructions,
    };

    const existingIndex = recipes.findIndex((r) => r.productId === product.id);
    let updated: ProductRecipe[];
    if (existingIndex >= 0) {
      updated = [...recipes];
      updated[existingIndex] = newRecipe;
    } else {
      updated = [...recipes, newRecipe];
    }

    saveRecipes(updated);
    addToast(`"${product.name}" için reçete gramajları başarıyla kaydedildi.`, 'success');
    setIsRecipeModalOpen(false);
    setEditingRecipe(null);
  };

  // Reçeteden malzeme silme
  const handleRemoveRecipeIngredient = (index: number) => {
    setRecipeIngredients((prev) => prev.filter((_, i) => i !== index));
  };

  // Reçeteye hammadde ekleme
  const handleAddRecipeIngredient = (inventoryItem: InventoryItem) => {
    if (recipeIngredients.some((ing) => ing.inventoryItemId === inventoryItem.id)) {
      addToast('Bu hammadde zaten reçetede ekli.', 'info');
      return;
    }
    setRecipeIngredients((prev) => [
      ...prev,
      {
        inventoryItemId: inventoryItem.id,
        inventoryItemName: inventoryItem.name,
        quantity: 10,
        unit: inventoryItem.unit,
      },
    ]);
  };

  // Reçeteyi düzenlemeye aç
  const openRecipeEditor = (recipe?: ProductRecipe) => {
    if (recipe) {
      setEditingRecipe(recipe);
      setRecipeSelectedProductId(recipe.productId);
      setRecipeIngredients([...recipe.ingredients]);
      setRecipeInstructions(recipe.instructions || '');
    } else {
      setEditingRecipe(null);
      setRecipeSelectedProductId(products[0]?.id || '');
      setRecipeIngredients([]);
      setRecipeInstructions('');
    }
    setIsRecipeModalOpen(true);
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
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
    <div className="flex flex-col gap-6 max-w-7xl mx-auto pb-12 select-none text-zinc-900 dark:text-zinc-100">
      {/* Üst Başlık & Sekme Geçişi — Bağımsız Yüzen Cam Ada */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-3xl dark:bg-white/[0.04] bg-white/75 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-lg">
        <div>
          <div className="flex items-center gap-2.5">
            <Package size={22} className="text-[#007AFF]" />
            <h2 className="text-xl font-bold tracking-tight dark:text-white text-zinc-900">
              Stok & Reçete Yönetimi
            </h2>
          </div>
          <p className="text-xs dark:text-zinc-400 text-zinc-500 mt-1">
            Hammadde stok hareketleri, tek tık doğrudan ikmal, patron onaylı fire düşümü ve ürün reçeteleri.
          </p>
        </div>

        {/* Hammadde & Reçete Alt Sekme Kapsülü — Bağımsız Yüzen Kapsül */}
        <div className="flex items-center gap-1.5 p-1.5 dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl backdrop-blur-md shadow-inner">
          <button
            onClick={() => setSubTab('INVENTORY')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
              subTab === 'INVENTORY'
                ? 'dark:bg-white/15 bg-white dark:text-white text-[#007AFF] shadow-sm'
                : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900'
            }`}
          >
            <Layers size={14} />
            <span>Hammadde & Stok</span>
          </button>
          <button
            onClick={() => setSubTab('RECIPES')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
              subTab === 'RECIPES'
                ? 'dark:bg-white/15 bg-white dark:text-white text-[#007AFF] shadow-sm'
                : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900'
            }`}
          >
            <ChefHat size={14} />
            <span>Ürün Reçeteleri ({recipes.length})</span>
          </button>
          <button
            onClick={() => setSubTab('ENVANTER360')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
              subTab === 'ENVANTER360'
                ? 'dark:bg-white/15 bg-white dark:text-white text-[#007AFF] shadow-sm'
                : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900'
            }`}
          >
            <Gauge size={14} />
            <span>Envanter 360</span>
          </button>
        </div>

        {/* Aksiyon Butonları — Renksiz Cam Butonlar */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => fetchInventory(true)}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-4 py-2 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 rounded-2xl text-xs font-medium dark:text-white text-zinc-900 transition-all disabled:opacity-50 cursor-pointer shadow-sm"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-zinc-400' : ''} />
            <span>Yenile</span>
          </button>

          {subTab === 'INVENTORY' && (
            <button
              onClick={() => {
                setError(null);
                setIsAddModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-4 py-2 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 dark:text-white text-zinc-900 rounded-2xl text-xs font-semibold transition-all shadow-sm cursor-pointer"
            >
              <Plus size={15} />
              <span>Yeni Hammadde</span>
            </button>
          )}

          {subTab === 'RECIPES' && (
            <button
              onClick={() => openRecipeEditor()}
              className="flex items-center gap-1.5 px-4 py-2 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 dark:text-white text-zinc-900 rounded-2xl text-xs font-semibold transition-all shadow-sm cursor-pointer"
            >
              <Plus size={15} />
              <span>Reçete Tanımla</span>
            </button>
          )}
        </div>
      </div>

      {/* Hata Bildirimi */}
      {error && (
        <div className="p-3.5 rounded-3xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      {/* FAZ 12 · Envanter 360 — fiyat, reçete maliyeti, tedarikçi, raf ömrü, fire */}
      {subTab === 'ENVANTER360' && <Inventory360Tab />}

      {/* GÖRÜNÜM 1: HAMMADDE & STOK YÖNETİMİ */}
      {subTab === 'INVENTORY' && (
        <>
          {/* Apple Borsa / Sağlık Tarzı 3'lü Renksiz Cam İstatistik Kartları — Bağımsız Yüzen Adalar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="dark:bg-white/[0.04] bg-white/80 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 backdrop-blur-xl transition-all shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
                  Toplam Hammadde
                </span>
                <MetricMiniLine color="#007AFF" />
              </div>
              <div className="text-3xl font-bold tracking-tight dark:text-white text-zinc-900 mt-2 font-mono">
                {items.length}
              </div>
            </div>

            <div className="dark:bg-white/[0.04] bg-white/80 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 backdrop-blur-xl transition-all shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
                  Yeterli Seviye
                </span>
                <MetricMiniLine color="#10b981" />
              </div>
              <div className="text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 mt-2 font-mono">
                {items.length - alerts.length}
              </div>
            </div>

            <div
              onClick={() => setFilterCriticalOnly(!filterCriticalOnly)}
              className={`cursor-pointer border rounded-3xl p-5 backdrop-blur-xl transition-all shadow-lg ${
                filterCriticalOnly
                  ? 'bg-rose-500/15 border-rose-500/30'
                  : 'dark:bg-white/[0.04] bg-white/80 hover:dark:bg-white/[0.07] hover:bg-white dark:border-white/10 border-black/[0.08]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
                  Kritik Eşik Uyarıları
                </span>
                <MetricMiniLine color="#ef4444" />
              </div>
              <div className="flex items-baseline justify-between mt-2">
                <span className="text-3xl font-bold tracking-tight text-rose-500 font-mono">
                  {alerts.length}
                </span>
                {alerts.length > 0 && (
                  <span className="text-[10px] font-bold text-rose-400 bg-rose-500/20 px-2 py-0.5 rounded-full">
                    {filterCriticalOnly ? 'Filtre Aktif' : 'Filtrele'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Arama Çubuğu */}
          <div className="relative w-full max-w-sm">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Hammadde kalemi veya SKU ara (et, süt, yumurta)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 dark:bg-white/[0.04] bg-white/70 border dark:border-white/10 border-black/[0.08] rounded-xl text-xs dark:text-white text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-[#007AFF] transition-all backdrop-blur-md"
            />
          </div>

          {/* Renksiz Şeffaf Cam Hammadde Tablosu */}
          <div className="rounded-3xl dark:bg-white/[0.03] bg-white/70 backdrop-blur-xl dark:border-white/10 border-black/[0.08] border overflow-hidden shadow-sm">
            {isLoading && items.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-xs dark:text-zinc-400 text-zinc-500">
                Stok verileri yükleniyor...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b dark:border-white/10 border-black/[0.08] dark:text-zinc-400 text-zinc-600 uppercase tracking-wider text-[11px] font-semibold dark:bg-white/[0.01] bg-black/[0.02]">
                      <th className="py-3.5 px-5">Hammadde Kalemi</th>
                      <th className="py-3.5 px-4">SKU / Kod</th>
                      <th className="py-3.5 px-4">Mevcut Miktar</th>
                      <th className="py-3.5 px-4">Birim</th>
                      <th className="py-3.5 px-4">Kritik Eşik</th>
                      <th className="py-3.5 px-5 text-right">Hızlı Aksiyonlar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-white/5 divide-black/[0.05]">
                    {filteredItems.map((item) => {
                      const isCritical =
                        item.min_stock_alert !== null && item.current_stock <= item.min_stock_alert;

                      return (
                        <tr
                          key={item.id}
                          className="hover:dark:bg-white/[0.04] hover:bg-white/90 transition-colors cursor-pointer"
                          onClick={() => setViewItem(item)}
                        >
                          <td className="py-4 px-5 font-semibold dark:text-white text-zinc-900">
                            <div className="flex items-center gap-2">
                              <span>{item.name}</span>
                              {isCritical && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/20">
                                  Kritik
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-4 font-mono text-[11px] dark:text-zinc-400 text-zinc-500">
                            {item.sku || '—'}
                          </td>
                          <td className="py-4 px-4 font-mono text-sm font-bold">
                            <span className={isCritical ? 'text-rose-500' : 'dark:text-white text-zinc-900'}>
                              {item.current_stock}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span className="px-2 py-0.5 rounded-md dark:bg-white/[0.06] bg-black/[0.05] dark:text-zinc-300 text-zinc-700 text-[11px] font-medium">
                              {item.unit}
                            </span>
                          </td>
                          <td className="py-4 px-4 dark:text-zinc-400 text-zinc-500 font-mono text-[11px]">
                            {item.min_stock_alert !== null ? `${item.min_stock_alert} ${item.unit}` : '—'}
                          </td>
                          <td className="py-4 px-5 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              {/* Stok Ekle: DOĞRUDAN İŞLENİR */}
                              <button
                                type="button"
                                onClick={() => {
                                  setDirectAddModalItem(item);
                                  setDirectAddAmount(item.unit === 'Gram' ? 500 : 5);
                                }}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold transition-all cursor-pointer active:scale-95 shadow-sm"
                                title="Stok Ekle (Doğrudan İkmal)"
                              >
                                <ArrowUpRight size={13} />
                                <span>Stok Ekle</span>
                              </button>

                              {/* Stok Eksilt: PATRON ONAYI GEREKTİRİR */}
                              <button
                                type="button"
                                onClick={() => {
                                  setWasteModalItem(item);
                                  setWasteAmount(1);
                                  setWasteReason('Bozulma / Son Kullanma');
                                  setWasteOwnerPin('');
                                  setWastePinError(null);
                                }}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-500 dark:text-rose-400 text-xs font-semibold transition-all cursor-pointer active:scale-95 shadow-sm"
                                title="Stok Eksilt (Patron Onaylı Fire)"
                              >
                                <ArrowDownRight size={13} />
                                <Lock size={11} className="opacity-80" />
                                <span>Fire Düş</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {filteredItems.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-16 text-center dark:text-zinc-500 text-zinc-400 text-xs">
                          {searchTerm || filterCriticalOnly
                            ? 'Filtreye uygun hammadde bulunamadı.'
                            : 'Kayıtlı hammadde kalemi bulunmuyor.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* GÖRÜNÜM 2: ÜRÜN REÇETELERİ & GRAMAJLAR */}
      {subTab === 'RECIPES' && (
        <div className="flex flex-col gap-5">
          <div className="p-4 rounded-2xl dark:bg-white/[0.03] bg-white/70 border dark:border-white/10 border-black/[0.08] backdrop-blur-xl flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sm dark:text-white text-zinc-900 flex items-center gap-2">
                <ChefHat size={16} className="text-[#007AFF]" />
                Menü Ürün Reçeteleri ve Otomatik Gramaj Bağlantısı
              </h3>
              <p className="text-xs dark:text-zinc-400 text-zinc-500 mt-0.5">
                Menüdeki her satış kalemine et, süt, peynir, un vb. hammaddeler reçete gramajı olarak bağlanır.
              </p>
            </div>
            <button
              onClick={() => openRecipeEditor()}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-semibold shadow-sm transition-all cursor-pointer"
            >
              <Plus size={14} />
              <span>Yeni Reçete Bağla</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recipes.map((recipe) => (
              <div
                key={recipe.productId}
                className="rounded-2xl border dark:border-white/10 border-black/[0.08] dark:bg-white/[0.03] bg-white/70 backdrop-blur-xl p-5 flex flex-col justify-between hover:dark:bg-white/[0.05] hover:bg-white/90 transition-all shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-[#007AFF]/15 text-[#007AFF] flex items-center justify-center font-bold">
                        <Utensils size={16} />
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm dark:text-white text-zinc-900">{recipe.productName}</h4>
                        <span className="text-[10px] font-mono dark:text-zinc-400 text-zinc-500">
                          {recipe.ingredients.length} Hammadde Bağlı
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => openRecipeEditor(recipe)}
                      className="p-1.5 text-zinc-400 hover:text-white transition-colors"
                      title="Reçeteyi Düzenle"
                    >
                      <Sliders size={14} />
                    </button>
                  </div>

                  {/* Hammadde Gramaj Listesi */}
                  <div className="space-y-1.5 mt-3 pt-3 border-t dark:border-white/5 border-black/5">
                    {recipe.ingredients.map((ing, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-xs py-1 px-2.5 rounded-lg dark:bg-white/[0.02] bg-black/[0.02]"
                      >
                        <span className="dark:text-zinc-300 text-zinc-700">{ing.inventoryItemName}</span>
                        <span className="font-mono font-bold text-[#007AFF]">
                          {ing.quantity} {ing.unit}
                        </span>
                      </div>
                    ))}
                  </div>

                  {recipe.instructions && (
                    <p className="mt-3 text-[11px] italic dark:text-zinc-400 text-zinc-500 bg-black/5 dark:bg-black/20 p-2 rounded-lg">
                      "{recipe.instructions}"
                    </p>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t dark:border-white/5 border-black/5 flex items-center justify-between">
                  <span className="text-[10px] dark:text-zinc-400 text-zinc-500">Reçete Aktif</span>
                  <button
                    onClick={() => {
                      const updated = recipes.filter((r) => r.productId !== recipe.productId);
                      saveRecipes(updated);
                      addToast('Reçete kaldırıldı.', 'info');
                    }}
                    className="text-xs text-rose-500 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 size={12} />
                    <span>Sil</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* iOS Modal 1: Doğrudan Stok Ekleme (İkmal - Patron Onayı İstemez) */}
      {directAddModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xl p-4 animate-in fade-in duration-150">
          <div className="dark:bg-[#1c1c1e]/90 bg-white/90 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-sm w-full p-6 shadow-2xl backdrop-blur-2xl flex flex-col gap-4 dark:text-zinc-100 text-zinc-900">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base dark:text-white text-zinc-900">Stok Ekle (İkmal)</h3>
                <span className="text-xs text-[#007AFF]">{directAddModalItem.name}</span>
              </div>
              <button
                onClick={() => setDirectAddModalItem(null)}
                className="w-7 h-7 rounded-full dark:bg-white/10 bg-black/10 hover:dark:bg-white/20 hover:bg-black/20 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <div className="p-3 rounded-xl dark:bg-white/[0.03] bg-black/[0.03] border dark:border-white/5 border-black/5 text-xs flex justify-between items-center">
              <span className="dark:text-zinc-400 text-zinc-500">Mevcut Bakiye:</span>
              <span className="font-mono font-bold dark:text-white text-zinc-900">
                {directAddModalItem.current_stock} {directAddModalItem.unit}
              </span>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleDirectAddStock(directAddModalItem, directAddAmount);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider mb-1.5">
                  Eklenecek Miktar ({directAddModalItem.unit})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  autoFocus
                  value={directAddAmount}
                  onChange={(e) => setDirectAddAmount(parseFloat(e.target.value) || 0)}
                  className="w-full dark:bg-white/[0.04] bg-white/70 border dark:border-white/10 border-black/[0.08] rounded-xl px-3.5 py-2.5 dark:text-white text-zinc-900 font-mono text-lg focus:outline-none focus:border-[#007AFF]"
                />
              </div>

              {/* Hızlı miktar butonları */}
              <div className="flex gap-2">
                {[1, 5, 10, 25].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setDirectAddAmount(amt)}
                    className="flex-1 py-1.5 rounded-lg text-xs font-semibold dark:bg-white/[0.04] bg-black/[0.04] hover:dark:bg-white/10 hover:bg-black/10 border dark:border-white/5 border-black/5 cursor-pointer"
                  >
                    +{amt}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDirectAddModalItem(null)}
                  className="flex-1 py-2.5 dark:bg-white/[0.06] bg-black/[0.05] hover:dark:bg-white/10 hover:bg-black/10 dark:text-zinc-300 text-zinc-700 font-medium rounded-xl text-xs transition-colors"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs shadow-sm transition-all cursor-pointer"
                >
                  Stoka Ekle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* iOS Modal 2: Stok Eksilt (Fire / Zayi - PATRON ONAYI & PIN GEREKTİRİR) */}
      {wasteModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xl p-4 animate-in fade-in duration-150">
          <div className="dark:bg-[#1c1c1e]/90 bg-white/90 border border-rose-500/30 rounded-3xl max-w-sm w-full p-6 shadow-2xl backdrop-blur-2xl flex flex-col gap-4 dark:text-zinc-100 text-zinc-900">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-500">
                <Lock size={18} />
                <h3 className="font-bold text-base dark:text-white text-zinc-900">Patron Onaylı Fire Düşümü</h3>
              </div>
              <button
                onClick={() => setWasteModalItem(null)}
                className="w-7 h-7 rounded-full dark:bg-white/10 bg-black/10 hover:dark:bg-white/20 hover:bg-black/20 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <p className="text-xs text-rose-400 dark:text-rose-300 bg-rose-500/10 p-3 rounded-xl border border-rose-500/20">
              Fire ve zayi düşümleri audit denetim zincirine işlenir ve işletme sahibinin (Patron) PIN onayını gerektirir.
            </p>

            <form onSubmit={handleWasteSubmit} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider mb-1">
                  Eksiltilecek Fire Miktarı ({wasteModalItem.unit})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={wasteAmount}
                  onChange={(e) => setWasteAmount(parseFloat(e.target.value) || 0)}
                  className="w-full dark:bg-white/[0.04] bg-white/70 border dark:border-white/10 border-black/[0.08] rounded-xl px-3.5 py-2 dark:text-white text-zinc-900 font-mono text-base focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider mb-1">
                  Fire / Zayi Nedeni
                </label>
                <select
                  value={wasteReason}
                  onChange={(e) => setWasteReason(e.target.value)}
                  className="w-full dark:bg-[#2c2c2e] bg-white border dark:border-white/10 border-black/[0.08] rounded-xl px-3 py-2 text-xs dark:text-white text-zinc-900 focus:outline-none focus:border-rose-500"
                >
                  <option value="Bozulma / Son Kullanma">Bozulma / Son Kullanma Tarihi</option>
                  <option value="Dökülme / Mutfak Kazası">Dökülme / Mutfak Kazası</option>
                  <option value="Sayım Eksiği Mutabakatı">Sayım Eksiği Mutabakatı</option>
                  <option value="Hatalı Hazırlık / Yanma">Hatalı Hazırlık / Yanma</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-rose-500 uppercase tracking-wider mb-1">
                  Patron PIN Kodu (Onay) *
                </label>
                <input
                  type="password"
                  required
                  maxLength={8}
                  placeholder="••••"
                  value={wasteOwnerPin}
                  onChange={(e) => setWasteOwnerPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full dark:bg-white/[0.04] bg-white/70 border border-rose-500/40 rounded-xl px-3.5 py-2.5 text-center font-mono tracking-[0.5em] text-xl dark:text-white text-zinc-900 focus:outline-none focus:border-rose-500"
                />
              </div>

              {wastePinError && (
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300 text-center">
                  {wastePinError}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setWasteModalItem(null)}
                  disabled={isProcessingWaste}
                  className="flex-1 py-2.5 dark:bg-white/[0.06] bg-black/[0.05] hover:dark:bg-white/10 hover:bg-black/10 dark:text-zinc-300 text-zinc-700 font-medium rounded-xl text-xs transition-colors"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={isProcessingWaste}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl text-xs shadow-sm transition-all cursor-pointer disabled:opacity-50"
                >
                  {isProcessingWaste ? 'Onaylanıyor...' : 'Onayla & Fire Düş'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* iOS Modal 3: Yeni Hammadde Kalemi Ekle (et, süt, yumurta vb.) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xl p-4 animate-in fade-in duration-150">
          <div className="dark:bg-[#1c1c1e]/90 bg-white/90 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-md w-full p-6 shadow-2xl backdrop-blur-2xl flex flex-col gap-4 dark:text-zinc-100 text-zinc-900">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base dark:text-white text-zinc-900">Yeni Hammadde Kalemi</h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="w-7 h-7 rounded-full dark:bg-white/10 bg-black/10 hover:dark:bg-white/20 hover:bg-black/20 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleCreateItem} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider mb-1">
                  Hammadde Adı (Örn: Dana Kıyma, Süt, Yumurta) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Hammadde adı"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full dark:bg-white/[0.04] bg-white/70 border dark:border-white/10 border-black/[0.08] rounded-xl px-3.5 py-2.5 text-xs dark:text-white text-zinc-900 focus:outline-none focus:border-[#007AFF]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider mb-1">
                    SKU / Hammadde Kodu
                  </label>
                  <input
                    type="text"
                    placeholder="RAW-001"
                    value={formSku}
                    onChange={(e) => setFormSku(e.target.value)}
                    className="w-full dark:bg-white/[0.04] bg-white/70 border dark:border-white/10 border-black/[0.08] rounded-xl px-3.5 py-2 text-xs dark:text-white text-zinc-900 focus:outline-none focus:border-[#007AFF]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider mb-1">
                    Ölçü Birimi
                  </label>
                  <select
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    className="w-full dark:bg-[#2c2c2e] bg-white border dark:border-white/10 border-black/[0.08] rounded-xl px-3 py-2 text-xs dark:text-white text-zinc-900 focus:outline-none focus:border-[#007AFF]"
                  >
                    <option value="Kg">Kg</option>
                    <option value="Gram">Gram</option>
                    <option value="Lt">Lt</option>
                    <option value="Adet">Adet</option>
                    <option value="Porsiyon">Porsiyon</option>
                    <option value="Kutu">Kutu</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider mb-1">
                    Başlangıç Stoğu
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={formStock}
                    onChange={(e) => setFormStock(parseFloat(e.target.value) || 0)}
                    className="w-full dark:bg-white/[0.04] bg-white/70 border dark:border-white/10 border-black/[0.08] rounded-xl px-3.5 py-2 text-xs font-mono dark:text-white text-zinc-900 focus:outline-none focus:border-[#007AFF]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider mb-1">
                    Kritik Eşik Uyarı Miktarı
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={formMinAlert}
                    onChange={(e) => setFormMinAlert(parseFloat(e.target.value) || 0)}
                    className="w-full dark:bg-white/[0.04] bg-white/70 border dark:border-white/10 border-black/[0.08] rounded-xl px-3.5 py-2 text-xs font-mono dark:text-white text-zinc-900 focus:outline-none focus:border-[#007AFF]"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-2.5 dark:bg-white/[0.06] bg-black/[0.05] hover:dark:bg-white/10 hover:bg-black/10 dark:text-zinc-300 text-zinc-700 font-medium rounded-xl text-xs transition-colors"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 bg-white hover:bg-zinc-200 text-black font-semibold rounded-xl text-xs shadow-sm transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* iOS Modal 4: Reçete Tanımlama / Gramaj Bağlama */}
      {isRecipeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xl p-4 animate-in fade-in duration-150">
          <div className="dark:bg-[#1c1c1e]/90 bg-white/90 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-lg w-full p-6 shadow-2xl backdrop-blur-2xl flex flex-col gap-4 dark:text-zinc-100 text-zinc-900">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ChefHat size={18} className="text-[#007AFF]" />
                <h3 className="font-bold text-base dark:text-white text-zinc-900">
                  {editingRecipe ? 'Reçeteyi Düzenle' : 'Yeni Ürün Reçetesi Bağla'}
                </h3>
              </div>
              <button
                onClick={() => setIsRecipeModalOpen(false)}
                className="w-7 h-7 rounded-full dark:bg-white/10 bg-black/10 hover:dark:bg-white/20 hover:bg-black/20 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSaveRecipe} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider mb-1">
                  Menü Ürünü Seçimi *
                </label>
                <select
                  disabled={Boolean(editingRecipe)}
                  value={recipeSelectedProductId}
                  onChange={(e) => setRecipeSelectedProductId(e.target.value)}
                  className="w-full dark:bg-[#2c2c2e] bg-white border dark:border-white/10 border-black/[0.08] rounded-xl px-3 py-2 text-xs dark:text-white text-zinc-900 focus:outline-none focus:border-[#007AFF]"
                >
                  <option value="">Ürün Seçiniz...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (₺{(p.price_cents / 100).toFixed(2)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Reçeteye Eklenecek Hammaddeler */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider">
                    Reçete Hammadde ve Gramajları
                  </label>
                  <span className="text-[10px] text-zinc-400">Aşağıdan hammadde seçip ekleyin</span>
                </div>

                {/* Hızlı Hammadde Ekleme Hapları */}
                <div className="flex flex-wrap gap-1.5 mb-2.5 max-h-24 overflow-y-auto p-1.5 rounded-xl dark:bg-black/20 bg-black/5 border dark:border-white/5 border-black/5">
                  {items.map((ingItem) => (
                    <button
                      key={ingItem.id}
                      type="button"
                      onClick={() => handleAddRecipeIngredient(ingItem)}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium dark:bg-white/[0.06] bg-white hover:dark:bg-white/15 hover:bg-zinc-100 border dark:border-white/10 border-black/[0.08] flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Plus size={11} className="text-[#007AFF]" />
                      <span>{ingItem.name}</span>
                    </button>
                  ))}
                </div>

                {/* Eklenen Malzemeler ve Gramaj Girdisi */}
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {recipeIngredients.map((item, idx) => (
                    <div
                      key={item.inventoryItemId}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-xl dark:bg-white/[0.03] bg-black/[0.03] border dark:border-white/5 border-black/5 text-xs"
                    >
                      <span className="font-medium dark:text-white text-zinc-900 truncate flex-1">
                        {item.inventoryItemName}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          value={item.quantity}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setRecipeIngredients((prev) =>
                              prev.map((ing, i) => (i === idx ? { ...ing, quantity: val } : ing))
                            );
                          }}
                          className="w-20 px-2 py-1 dark:bg-black/40 bg-white border dark:border-white/10 border-black/10 rounded-lg text-right font-mono text-xs dark:text-white text-zinc-900"
                        />
                        <span className="dark:text-zinc-400 text-zinc-500 font-mono w-10">{item.unit}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveRecipeIngredient(idx)}
                          className="p-1 text-rose-500 hover:text-rose-400"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {recipeIngredients.length === 0 && (
                    <div className="text-center py-4 text-xs dark:text-zinc-500 text-zinc-400 italic">
                      Henüz hammadde seçilmedi. Yukarıdaki hammadde butonlarına tıklayarak gramaj ekleyin.
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider mb-1">
                  Hazırlama Notu / Talimatı (Opsiyonel)
                </label>
                <input
                  type="text"
                  placeholder="Mutfak için pişirme veya porsiyonlama talimatı..."
                  value={recipeInstructions}
                  onChange={(e) => setRecipeInstructions(e.target.value)}
                  className="w-full dark:bg-white/[0.04] bg-white/70 border dark:border-white/10 border-black/[0.08] rounded-xl px-3 py-2 text-xs dark:text-white text-zinc-900 focus:outline-none focus:border-[#007AFF]"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRecipeModalOpen(false)}
                  className="flex-1 py-2.5 dark:bg-white/[0.06] bg-black/[0.05] hover:dark:bg-white/10 hover:bg-black/10 dark:text-zinc-300 text-zinc-700 font-medium rounded-xl text-xs transition-colors"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={recipeIngredients.length === 0}
                  className="flex-1 py-2.5 bg-white hover:bg-zinc-200 text-black font-semibold rounded-xl text-xs shadow-sm transition-all cursor-pointer disabled:opacity-40"
                >
                  Reçeteyi Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* iOS Modal 5: Stok Kartı Detay Görünümü */}
      {viewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xl p-4 animate-in fade-in duration-150">
          <div className="dark:bg-[#1c1c1e]/90 bg-white/90 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-sm w-full p-6 shadow-2xl backdrop-blur-2xl flex flex-col gap-4 dark:text-zinc-100 text-zinc-900">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base dark:text-white text-zinc-900">{viewItem.name}</h3>
                <span className="text-[10px] dark:text-zinc-400 text-zinc-500 font-mono">ID: {viewItem.id}</span>
              </div>
              <button
                onClick={() => setViewItem(null)}
                className="w-7 h-7 rounded-full dark:bg-white/10 bg-black/10 hover:dark:bg-white/20 hover:bg-black/20 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <div className="dark:bg-white/[0.03] bg-black/[0.03] rounded-2xl p-4 border dark:border-white/5 border-black/5 space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b dark:border-white/5 border-black/5">
                <span className="dark:text-zinc-400 text-zinc-500">SKU / Kod</span>
                <span className="font-mono dark:text-zinc-200 text-zinc-800">{viewItem.sku || 'Belirtilmedi'}</span>
              </div>
              <div className="flex justify-between py-1 border-b dark:border-white/5 border-black/5 items-baseline">
                <span className="dark:text-zinc-400 text-zinc-500">Mevcut Bakiye</span>
                <span className="text-base font-bold dark:text-white text-zinc-900 font-mono">
                  {viewItem.current_stock} {viewItem.unit}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="dark:text-zinc-400 text-zinc-500">Kritik Eşik</span>
                <span className="font-mono dark:text-zinc-200 text-zinc-800">
                  {viewItem.min_stock_alert !== null ? `${viewItem.min_stock_alert} ${viewItem.unit}` : 'Yok'}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  const itm = viewItem;
                  setViewItem(null);
                  setDirectAddModalItem(itm);
                  setDirectAddAmount(itm.unit === 'Gram' ? 500 : 5);
                }}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ArrowUpRight size={13} />
                <span>Stok Ekle</span>
              </button>
              <button
                onClick={() => {
                  const itm = viewItem;
                  setViewItem(null);
                  setWasteModalItem(itm);
                  setWasteAmount(1);
                  setWasteReason('Bozulma / Son Kullanma');
                  setWasteOwnerPin('');
                }}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ArrowDownRight size={13} />
                <span>Fire Düş</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
