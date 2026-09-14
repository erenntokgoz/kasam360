import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Receipt,
  Printer,
  Eye,
  Search,
  Calendar,
  Filter,
  X,
  RefreshCw,
  CreditCard,
  Banknote,
  ArrowUpDown,
  Copy,
  Check,
  Percent,
  Layers,
  FileText,
  DollarSign,
  Info,
} from 'lucide-react';
import { tauriInvoke as invoke } from '../../../data/ipc/tauriInvoke';
import { toast as useToast } from '@core/components/ui/toast';

export interface ReceiptItemDto {
  id: string;
  productId?: string;
  product_id?: string;
  productName?: string;
  product_name?: string;
  quantity: number;
  unitPriceCents?: number;
  unit_price_cents?: number;
  taxRate?: number;
  tax_rate?: number;
  subtotalCents?: number;
  subtotal_cents?: number;
  taxAmountCents?: number;
  tax_amount_cents?: number;
  totalCents?: number;
  total_cents?: number;
  modifiers?: string[];
  notes?: string | null;
}

export interface ReceiptDto {
  id: string;
  table_id: string;
  tableId?: string;
  total_cents: number;
  totalCents?: number;
  subtotal_cents?: number;
  subtotalCents?: number;
  tax_total_cents?: number;
  taxTotalCents?: number;
  discount_cents?: number;
  discountCents?: number;
  created_at: string;
  createdAt?: string;
  cashier_id?: string | null;
  cashierId?: string | null;
  cashier_name?: string | null;
  cashierName?: string | null;
  payment_method?: string;
  paymentMethod?: string;
  notes?: string | null;
  items?: ReceiptItemDto[];
  tendered_cents?: number | null;
  tenderedCents?: number | null;
  change_cents?: number | null;
  changeCents?: number | null;
}

type DatePreset = 'ALL' | 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'THIS_MONTH' | 'CUSTOM';
type SortOption = 'DATE_DESC' | 'DATE_ASC' | 'AMOUNT_DESC' | 'AMOUNT_ASC';
type ModalTab = 'DETAILS' | 'THERMAL';

export function ReceiptsContainer(): JSX.Element {
  const [receipts, setReceipts] = useState<ReceiptDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filtreleme State'leri
  const [searchTerm, setSearchTerm] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<string>('ALL');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('DATE_DESC');

  // Modal State'leri
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptDto | null>(null);
  const [modalTab, setModalTab] = useState<ModalTab>('DETAILS');
  const [printingReceiptId, setPrintingReceiptId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const thermalPrintRef = useRef<HTMLDivElement>(null);

  const addToast = (msg: string, type: 'success' | 'error' | 'info') => {
    try {
      useToast.add({ title: msg, type });
    } catch {
      console.log(`[Toast ${type}]: ${msg}`);
    }
  };

  const fetchReceipts = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await invoke<ReceiptDto[]>('get_receipts');
      setReceipts(data || []);
      if (isManualRefresh) {
        addToast('Geçmiş fiş listesi güncellendi.', 'success');
      }
    } catch (e) {
      console.error('Failed to fetch receipts:', e);
      addToast('Geçmiş fişler yüklenemedi.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchReceipts();
  }, []);

  // Para ve Tarih formatlayıcıları
  const formatMoney = (cents: number | undefined): string => {
    const val = (cents || 0) / 100;
    return val.toLocaleString('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 2,
    });
  };

  const formatDate = (iso: string): string => {
    try {
      return new Date(iso).toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const formatRelativeTime = (iso: string): string => {
    try {
      const diffMs = Date.now() - new Date(iso).getTime();
      const diffMin = Math.floor(diffMs / 60000);
      const diffHrs = Math.floor(diffMin / 60);
      const diffDays = Math.floor(diffHrs / 24);

      if (diffMin < 2) return 'Az önce';
      if (diffMin < 60) return `${diffMin} dk önce`;
      if (diffHrs < 24) return `${diffHrs} saat önce`;
      if (diffDays === 1) return 'Dün';
      if (diffDays < 7) return `${diffDays} gün önce`;
      return formatDate(iso);
    } catch {
      return iso;
    }
  };

  // Fiş No Kopyalama
  const handleCopyId = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    addToast(`Fiş No kopyalandı: ${id.substring(0, 8)}...`, 'info');
  };

  // Yeniden Yazdırma Fonksiyonu (ESC/POS 80mm)
  const handleReprint = async (receipt: ReceiptDto, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setPrintingReceiptId(receipt.id);

    // Normalleştirilmiş DTO oluştur (snake_case & camelCase uyumlu)
    const normalizedPayload = {
      id: receipt.id,
      orderId: receipt.id,
      table_id: receipt.table_id || receipt.tableId || 'Masa Belirtilmedi',
      tableId: receipt.table_id || receipt.tableId || 'Masa Belirtilmedi',
      customerRef: receipt.table_id || receipt.tableId,
      total_cents: receipt.total_cents ?? receipt.totalCents ?? 0,
      totalCents: receipt.total_cents ?? receipt.totalCents ?? 0,
      totalAmount: receipt.total_cents ?? receipt.totalCents ?? 0,
      subtotal_cents: receipt.subtotal_cents ?? receipt.subtotalCents ?? 0,
      tax_total_cents: receipt.tax_total_cents ?? receipt.taxTotalCents ?? 0,
      discount_cents: receipt.discount_cents ?? receipt.discountCents ?? 0,
      created_at: receipt.created_at || receipt.createdAt || new Date().toISOString(),
      timestamp: receipt.created_at || receipt.createdAt || new Date().toISOString(),
      cashier_id: receipt.cashier_id || receipt.cashierId || 'Kasiyer',
      cashier_name: receipt.cashier_name || receipt.cashierName || 'Kasiyer',
      cashierName: receipt.cashier_name || receipt.cashierName || 'Kasiyer',
      payment_method: receipt.payment_method || receipt.paymentMethod || 'Nakit',
      paymentMethod: receipt.payment_method || receipt.paymentMethod || 'Nakit',
      notes: receipt.notes,
      tendered_cents: receipt.tendered_cents ?? receipt.tenderedCents,
      change_cents: receipt.change_cents ?? receipt.changeCents,
      items: (receipt.items || []).map((it) => ({
        id: it.id,
        productId: it.productId || it.product_id,
        productName: it.productName || it.product_name || 'Ürün',
        product_name: it.productName || it.product_name || 'Ürün',
        quantity: it.quantity,
        unitPriceCents: it.unitPriceCents ?? it.unit_price_cents ?? 0,
        unit_price_cents: it.unitPriceCents ?? it.unit_price_cents ?? 0,
        taxRate: it.taxRate ?? it.tax_rate ?? 0,
        tax_rate: it.taxRate ?? it.tax_rate ?? 0,
        subtotalCents: it.subtotalCents ?? it.subtotal_cents ?? 0,
        taxAmountCents: it.taxAmountCents ?? it.tax_amount_cents ?? 0,
        totalCents: it.totalCents ?? it.total_cents ?? 0,
        total_cents: it.totalCents ?? it.total_cents ?? 0,
        modifiers: it.modifiers || [],
        notes: it.notes,
      })),
    };

    try {
      await invoke('print_receipt', { order: normalizedPayload });
      addToast(`Fiş (#${receipt.id.substring(0, 8)}) termal yazıcıya gönderildi.`, 'success');
    } catch (err) {
      console.error('Reprint failed:', err);
      addToast('Yazdırma işlemi başarısız oldu.', 'error');
    } finally {
      setPrintingReceiptId(null);
    }
  };

  // Tarayıcı Yazdırma (Window Print)
  const handleBrowserPrint = () => {
    window.print();
  };

  // Filtre Temizleme
  const handleResetFilters = () => {
    setSearchTerm('');
    setDatePreset('ALL');
    setStartDate('');
    setEndDate('');
    setPaymentFilter('ALL');
    setMinAmount('');
    setMaxAmount('');
    setSortBy('DATE_DESC');
  };

  // Filtrelenmiş ve Sıralanmış Fiş Listesi
  const filteredReceipts = useMemo(() => {
    return receipts.filter((rcp) => {
      const id = rcp.id.toLowerCase();
      const table = (rcp.table_id || rcp.tableId || '').toLowerCase();
      const cashier = (rcp.cashier_name || rcp.cashierName || rcp.cashier_id || rcp.cashierId || '').toLowerCase();
      const sTerm = searchTerm.trim().toLowerCase();

      // 1. Metin Araması (Fiş No, Masa, Kasiyer, Ürün Adı)
      if (sTerm) {
        const matchesMain = id.includes(sTerm) || table.includes(sTerm) || cashier.includes(sTerm);
        const matchesItems = rcp.items?.some((it) =>
          (it.productName || it.product_name || '').toLowerCase().includes(sTerm)
        );
        if (!matchesMain && !matchesItems) return false;
      }

      // 2. Ödeme Yöntemi Filtresi
      if (paymentFilter !== 'ALL') {
        const method = (rcp.payment_method || rcp.paymentMethod || '').toLowerCase();
        if (paymentFilter === 'Nakit' && !method.includes('nakit') && !method.includes('cash')) return false;
        if (paymentFilter === 'Kredi Kartı' && !method.includes('kart') && !method.includes('card')) return false;
        if (paymentFilter === 'Parçalı' && !method.includes('parçalı') && !method.includes('split')) return false;
      }

      // 3. Tutar Filtresi
      const totalCents = rcp.total_cents ?? rcp.totalCents ?? 0;
      if (minAmount.trim()) {
        const minCents = Math.round(parseFloat(minAmount) * 100);
        if (!isNaN(minCents) && totalCents < minCents) return false;
      }
      if (maxAmount.trim()) {
        const maxCents = Math.round(parseFloat(maxAmount) * 100);
        if (!isNaN(maxCents) && totalCents > maxCents) return false;
      }

      // 4. Tarih Filtresi
      const createdAt = new Date(rcp.created_at || rcp.createdAt || '');
      if (isNaN(createdAt.getTime())) return true;

      const now = new Date();
      if (datePreset === 'TODAY') {
        const isToday =
          createdAt.getDate() === now.getDate() &&
          createdAt.getMonth() === now.getMonth() &&
          createdAt.getFullYear() === now.getFullYear();
        if (!isToday) return false;
      } else if (datePreset === 'YESTERDAY') {
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const isYesterday =
          createdAt.getDate() === yesterday.getDate() &&
          createdAt.getMonth() === yesterday.getMonth() &&
          createdAt.getFullYear() === yesterday.getFullYear();
        if (!isYesterday) return false;
      } else if (datePreset === 'LAST_7_DAYS') {
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(now.getDate() - 7);
        if (createdAt < sevenDaysAgo) return false;
      } else if (datePreset === 'THIS_MONTH') {
        const isThisMonth =
          createdAt.getMonth() === now.getMonth() &&
          createdAt.getFullYear() === now.getFullYear();
        if (!isThisMonth) return false;
      } else if (datePreset === 'CUSTOM') {
        if (startDate) {
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          if (createdAt < start) return false;
        }
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          if (createdAt > end) return false;
        }
      }

      return true;
    }).sort((a, b) => {
      const totalA = a.total_cents ?? a.totalCents ?? 0;
      const totalB = b.total_cents ?? b.totalCents ?? 0;
      const dateA = new Date(a.created_at || a.createdAt || '').getTime() || 0;
      const dateB = new Date(b.created_at || b.createdAt || '').getTime() || 0;

      if (sortBy === 'DATE_DESC') return dateB - dateA;
      if (sortBy === 'DATE_ASC') return dateA - dateB;
      if (sortBy === 'AMOUNT_DESC') return totalB - totalA;
      if (sortBy === 'AMOUNT_ASC') return totalA - totalB;
      return 0;
    });
  }, [receipts, searchTerm, paymentFilter, minAmount, maxAmount, datePreset, startDate, endDate, sortBy]);

  // KPI İstatistikleri
  const stats = useMemo(() => {
    let totalRevenueCents = 0;
    let cashTotalCents = 0;
    let cardTotalCents = 0;

    for (const r of filteredReceipts) {
      const amount = r.total_cents ?? r.totalCents ?? 0;
      totalRevenueCents += amount;

      const method = (r.payment_method || r.paymentMethod || '').toLowerCase();
      if (method.includes('nakit') || method.includes('cash')) {
        cashTotalCents += amount;
      } else if (method.includes('kart') || method.includes('card')) {
        cardTotalCents += amount;
      } else {
        // Parçalı veya diğer
        cashTotalCents += Math.round(amount * 0.5);
        cardTotalCents += Math.round(amount * 0.5);
      }
    }

    const count = filteredReceipts.length;
    const avgTicket = count > 0 ? Math.round(totalRevenueCents / count) : 0;

    return {
      count,
      totalRevenueCents,
      cashTotalCents,
      cardTotalCents,
      avgTicket,
    };
  }, [filteredReceipts]);

  // Aktif filtre sayısı
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchTerm.trim()) count++;
    if (datePreset !== 'ALL') count++;
    if (paymentFilter !== 'ALL') count++;
    if (minAmount.trim() || maxAmount.trim()) count++;
    return count;
  }, [searchTerm, datePreset, paymentFilter, minAmount, maxAmount]);

  // Ödeme Rozeti Rengi
  const getPaymentBadge = (method?: string) => {
    const m = (method || 'Nakit').toLowerCase();
    if (m.includes('nakit') || m.includes('cash')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          <Banknote size={12} />
          Nakit
        </span>
      );
    }
    if (m.includes('kart') || m.includes('card')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
          <CreditCard size={12} />
          Kredi Kartı
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30">
        <Layers size={12} />
        Parçalı
      </span>
    );
  };

  return (
    <div className="flex h-full w-full flex-col bg-slate-950 text-slate-100 p-6 overflow-hidden">
      {/* Üst Başlık ve Yenileme Butonu */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 shadow-inner">
            <Receipt size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              Geçmiş Fişler
              <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">
                Arşiv & Rapor
              </span>
            </h1>
            <p className="text-sm text-slate-400">
              Kapanmış ve ödenmiş tüm adisyonların detayları, kalem dökümleri ve termal çıktıları.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchReceipts(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 text-sm font-medium transition-all shadow-sm active:scale-95 disabled:opacity-50"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin text-indigo-400' : 'text-slate-400'} />
            <span>Yenile</span>
          </button>
        </div>
      </div>

      {/* KPI Özet Kartları */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 backdrop-blur shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Toplam Fiş</span>
            <FileText size={16} className="text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white">{stats.count}</div>
          <div className="text-xs text-slate-500 mt-1">Filtrelenen fiş adedi</div>
        </div>

        <div className="rounded-xl border border-indigo-900/30 bg-indigo-950/20 p-4 backdrop-blur shadow-sm">
          <div className="flex items-center justify-between text-indigo-300 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Toplam Ciro</span>
            <DollarSign size={16} className="text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-indigo-400">{formatMoney(stats.totalRevenueCents)}</div>
          <div className="text-xs text-indigo-300/60 mt-1">Net tahsil edilen tutar</div>
        </div>

        <div className="rounded-xl border border-emerald-900/30 bg-emerald-950/20 p-4 backdrop-blur shadow-sm">
          <div className="flex items-center justify-between text-emerald-300 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Nakit Satış</span>
            <Banknote size={16} className="text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400">{formatMoney(stats.cashTotalCents)}</div>
          <div className="text-xs text-emerald-300/60 mt-1">Nakit kasa girişi</div>
        </div>

        <div className="rounded-xl border border-blue-900/30 bg-blue-950/20 p-4 backdrop-blur shadow-sm">
          <div className="flex items-center justify-between text-blue-300 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Kart / POS</span>
            <CreditCard size={16} className="text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-blue-400">{formatMoney(stats.cardTotalCents)}</div>
          <div className="text-xs text-blue-300/60 mt-1">Banka & Kredi Kartı</div>
        </div>

        <div className="col-span-2 md:col-span-1 rounded-xl border border-slate-800 bg-slate-900/70 p-4 backdrop-blur shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Ortalama Fiş</span>
            <Receipt size={16} className="text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400">{formatMoney(stats.avgTicket)}</div>
          <div className="text-xs text-slate-500 mt-1">Fiş başına düşen sepet</div>
        </div>
      </div>

      {/* Arama & Filtreleme Araç Çubuğu */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 mb-4 backdrop-blur space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Canlı Arama Input */}
          <div className="relative flex-1 min-w-[240px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Fiş No, Masa No, Kasiyer veya Ürün ara..."
              className="w-full rounded-lg bg-slate-950 border border-slate-700 pl-9 pr-8 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Tarih Hazır Butonları */}
          <div className="flex items-center bg-slate-950 border border-slate-700 rounded-lg p-1 text-xs font-medium">
            {(
              [
                { key: 'ALL', label: 'Tümü' },
                { key: 'TODAY', label: 'Bugün' },
                { key: 'YESTERDAY', label: 'Dün' },
                { key: 'LAST_7_DAYS', label: '7 Gün' },
                { key: 'THIS_MONTH', label: 'Bu Ay' },
                { key: 'CUSTOM', label: 'Özel' },
              ] as { key: DatePreset; label: string }[]
            ).map((item) => (
              <button
                key={item.key}
                onClick={() => setDatePreset(item.key)}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  datePreset === item.key
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Ödeme Yöntemi Dropdown */}
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">Tüm Ödemeler</option>
            <option value="Nakit">Nakit</option>
            <option value="Kredi Kartı">Kredi Kartı</option>
            <option value="Parçalı">Parçalı Ödeme</option>
          </select>

          {/* Sıralama Dropdown */}
          <div className="flex items-center gap-1 text-xs">
            <ArrowUpDown size={14} className="text-slate-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="DATE_DESC">En Yeni (İlk)</option>
              <option value="DATE_ASC">En Eski (İlk)</option>
              <option value="AMOUNT_DESC">Tutar: Yüksekten Düşüğe</option>
              <option value="AMOUNT_ASC">Tutar: Düşükten Yükseğe</option>
            </select>
          </div>

          {/* Filtreleri Sıfırla Butonu */}
          {activeFiltersCount > 0 && (
            <button
              onClick={handleResetFilters}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 text-xs font-medium transition-colors"
            >
              <X size={14} />
              <span>Sıfırla ({activeFiltersCount})</span>
            </button>
          )}
        </div>

        {/* Özel Tarih & Tutar Aralığı Genişletmesi */}
        {(datePreset === 'CUSTOM' || minAmount || maxAmount) && (
          <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center gap-3 text-xs">
            {datePreset === 'CUSTOM' && (
              <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
                <Calendar size={14} className="text-indigo-400" />
                <span className="text-slate-400">Başlangıç:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-transparent text-slate-200 focus:outline-none border-b border-slate-700"
                />
                <span className="text-slate-400 ml-2">Bitiş:</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-transparent text-slate-200 focus:outline-none border-b border-slate-700"
                />
              </div>
            )}

            <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
              <Filter size={14} className="text-amber-400" />
              <span className="text-slate-400">Min ₺:</span>
              <input
                type="number"
                placeholder="0"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                className="w-16 bg-transparent text-slate-200 focus:outline-none border-b border-slate-700"
              />
              <span className="text-slate-400 ml-2">Max ₺:</span>
              <input
                type="number"
                placeholder="Limitsiz"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                className="w-20 bg-transparent text-slate-200 focus:outline-none border-b border-slate-700"
              />
            </div>
          </div>
        )}
      </div>

      {/* Fişler Tablosu */}
      <div className="flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg flex flex-col">
        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"></div>
            <p className="text-sm text-slate-400">Geçmiş fişler yükleniyor...</p>
          </div>
        ) : filteredReceipts.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-800/80 text-slate-500 mb-3 border border-slate-700">
              <Receipt size={32} />
            </div>
            <h3 className="text-base font-semibold text-slate-300">Fiş Bulunamadı</h3>
            <p className="text-sm text-slate-500 max-w-sm mt-1 mb-4">
              {activeFiltersCount > 0
                ? 'Belirlediğiniz arama ve filtre kriterlerine uygun geçmiş fiş kaydı bulunmamaktadır.'
                : 'Sistemde henüz tamamlanmış ve kapanmış bir adisyon kaydı yok.'}
            </p>
            {activeFiltersCount > 0 && (
              <button
                onClick={handleResetFilters}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition-colors"
              >
                Filtreleri Temizle
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left text-sm text-slate-300 border-collapse">
              <thead className="bg-slate-900/90 text-xs font-semibold uppercase tracking-wider text-slate-400 sticky top-0 z-10 backdrop-blur border-b border-slate-800">
                <tr>
                  <th className="px-5 py-3.5">Fiş No</th>
                  <th className="px-5 py-3.5">Masa</th>
                  <th className="px-5 py-3.5">Tarih & Saat</th>
                  <th className="px-5 py-3.5">Kasiyer</th>
                  <th className="px-5 py-3.5">Ödeme Tipi</th>
                  <th className="px-5 py-3.5 text-center">Kalem</th>
                  <th className="px-5 py-3.5 text-right">Tutar</th>
                  <th className="px-5 py-3.5 text-right">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filteredReceipts.map((receipt) => {
                  const itemsCount = receipt.items?.reduce((acc, it) => acc + (it.quantity || 1), 0) || 0;
                  const total = receipt.total_cents ?? receipt.totalCents ?? 0;
                  const isPrinting = printingReceiptId === receipt.id;

                  return (
                    <tr
                      key={receipt.id}
                      onClick={() => {
                        setSelectedReceipt(receipt);
                        setModalTab('DETAILS');
                      }}
                      className="hover:bg-slate-800/50 cursor-pointer transition-colors group"
                    >
                      {/* Fiş No */}
                      <td className="px-5 py-3.5 font-medium text-slate-200">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-indigo-300 font-semibold">
                            #{receipt.id.length > 14 ? receipt.id.substring(0, 10) + '...' : receipt.id}
                          </span>
                          <button
                            onClick={(e) => handleCopyId(receipt.id, e)}
                            title="Fiş numarasını kopyala"
                            className="text-slate-500 hover:text-slate-300 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            {copiedId === receipt.id ? (
                              <Check size={12} className="text-emerald-400" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Masa */}
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 text-slate-200 border border-slate-700">
                          {receipt.table_id || receipt.tableId || 'Masa'}
                        </span>
                      </td>

                      {/* Tarih */}
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col">
                          <span className="text-xs text-slate-200 font-medium">
                            {formatDate(receipt.created_at || receipt.createdAt || '')}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {formatRelativeTime(receipt.created_at || receipt.createdAt || '')}
                          </span>
                        </div>
                      </td>

                      {/* Kasiyer */}
                      <td className="px-5 py-3.5 text-xs text-slate-300">
                        {receipt.cashier_name || receipt.cashierName || receipt.cashier_id || receipt.cashierId || '—'}
                      </td>

                      {/* Ödeme Tipi */}
                      <td className="px-5 py-3.5">
                        {getPaymentBadge(receipt.payment_method || receipt.paymentMethod)}
                      </td>

                      {/* Kalem Sayısı */}
                      <td className="px-5 py-3.5 text-center">
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-mono font-medium bg-slate-800/80 text-slate-400">
                          {itemsCount > 0 ? `${itemsCount} adet` : '—'}
                        </span>
                      </td>

                      {/* Tutar */}
                      <td className="px-5 py-3.5 text-right font-bold text-sm text-indigo-300">
                        {formatMoney(total)}
                      </td>

                      {/* İşlemler */}
                      <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setSelectedReceipt(receipt);
                              setModalTab('DETAILS');
                            }}
                            title="Fiş Detayını Gör"
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600/30 text-slate-300 hover:text-indigo-300 border border-slate-700 hover:border-indigo-500/40 transition-colors"
                          >
                            <Eye size={15} />
                          </button>

                          <button
                            onClick={(e) => handleReprint(receipt, e)}
                            disabled={isPrinting}
                            title="Termal Fiş Yeniden Yazdır"
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-sm transition-all disabled:opacity-50"
                          >
                            <Printer size={14} className={isPrinting ? 'animate-bounce' : ''} />
                            <span>{isPrinting ? 'Yazdırılıyor...' : 'Yazdır'}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Tablo Alt Bilgi Çubuğu */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs text-slate-500">
          <div>
            Toplam <span className="font-semibold text-slate-300">{filteredReceipts.length}</span> fiş listeleniyor
          </div>
          <div className="flex items-center gap-4">
            <span>
              Listelenen Tutar: <strong className="text-indigo-400">{formatMoney(stats.totalRevenueCents)}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODERN FİŞ DETAY MODALI (DETAYLAR + 80mm TERMAL ÖNİZLEME)               */}
      {/* ========================================================================= */}
      {selectedReceipt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={() => setSelectedReceipt(null)}
        >
          <div
            className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                  <Receipt size={22} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-white">Fiş Detayı</h3>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/50">
                      #{selectedReceipt.id}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {formatDate(selectedReceipt.created_at || selectedReceipt.createdAt || '')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedReceipt(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Modal Sekmeleri (Tab Switcher) */}
            <div className="flex border-b border-slate-800 bg-slate-950/40 px-6 pt-2">
              <button
                onClick={() => setModalTab('DETAILS')}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                  modalTab === 'DETAILS'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileText size={15} />
                Sipariş & Kalem Dökümü
              </button>
              <button
                onClick={() => setModalTab('THERMAL')}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                  modalTab === 'THERMAL'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Printer size={15} />
                80mm Termal Fiş Önizleme
              </button>
            </div>

            {/* Modal İçeriği */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {modalTab === 'DETAILS' ? (
                <>
                  {/* Bilgi Kartları Izgarası */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block mb-1">
                        Masa No
                      </span>
                      <span className="text-sm font-bold text-white">
                        {selectedReceipt.table_id || selectedReceipt.tableId || 'Masa Belirtilmedi'}
                      </span>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block mb-1">
                        Kasiyer
                      </span>
                      <span className="text-sm font-bold text-slate-200">
                        {selectedReceipt.cashier_name || selectedReceipt.cashierName || selectedReceipt.cashier_id || '—'}
                      </span>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block mb-1">
                        Ödeme Tipi
                      </span>
                      <div>{getPaymentBadge(selectedReceipt.payment_method || selectedReceipt.paymentMethod)}</div>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block mb-1">
                        Durum
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                        <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
                        Kapandı & Ödendi
                      </span>
                    </div>
                  </div>

                  {/* Kalemler Tablosu */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center justify-between">
                      <span>Sipariş Kalemleri ({selectedReceipt.items?.length || 0})</span>
                      <span className="text-[11px] text-slate-500 lowercase font-normal">KDV Dahil</span>
                    </h4>

                    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50">
                      <table className="w-full text-left text-xs text-slate-300">
                        <thead className="bg-slate-900 text-slate-400 font-semibold uppercase border-b border-slate-800">
                          <tr>
                            <th className="px-4 py-2.5">Ürün</th>
                            <th className="px-4 py-2.5 text-center">Adet</th>
                            <th className="px-4 py-2.5 text-right">Birim Fiyat</th>
                            <th className="px-4 py-2.5 text-center">KDV</th>
                            <th className="px-4 py-2.5 text-right">Toplam</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {selectedReceipt.items && selectedReceipt.items.length > 0 ? (
                            selectedReceipt.items.map((it, idx) => {
                              const qty = it.quantity || 1;
                              const unitPrice = it.unitPriceCents ?? it.unit_price_cents ?? 0;
                              const totalCents = it.totalCents ?? it.total_cents ?? unitPrice * qty;
                              const taxRate = it.taxRate ?? it.tax_rate ?? 10;
                              const name = it.productName || it.product_name || 'Ürün';

                              return (
                                <tr key={it.id || idx} className="hover:bg-slate-800/30 transition-colors">
                                  <td className="px-4 py-3">
                                    <div className="font-semibold text-slate-200">{name}</div>
                                    {it.modifiers && it.modifiers.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {it.modifiers.map((m, mIdx) => (
                                          <span
                                            key={mIdx}
                                            className="px-1.5 py-0.2 text-[10px] rounded bg-slate-800 text-indigo-300 border border-slate-700"
                                          >
                                            {m}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    {it.notes && (
                                      <div className="text-[11px] text-amber-400/80 italic mt-0.5">
                                        Not: {it.notes}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-center font-bold text-slate-100">{qty}</td>
                                  <td className="px-4 py-3 text-right font-mono text-slate-300">
                                    {formatMoney(unitPrice)}
                                  </td>
                                  <td className="px-4 py-3 text-center font-mono text-slate-400">%{taxRate}</td>
                                  <td className="px-4 py-3 text-right font-mono font-bold text-slate-100">
                                    {formatMoney(totalCents)}
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                                Kalem detay bilgisi bulunamadı.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Finansal Döküm ve Vergi Dağılımı */}
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>Ara Toplam (Matrah):</span>
                      <span className="font-mono text-slate-200">
                        {formatMoney(
                          selectedReceipt.subtotal_cents ??
                            selectedReceipt.subtotalCents ??
                            Math.round(((selectedReceipt.total_cents ?? selectedReceipt.totalCents ?? 0) * 100) / 110)
                        )}
                      </span>
                    </div>

                    {(selectedReceipt.discount_cents ?? selectedReceipt.discountCents ?? 0) > 0 && (
                      <div className="flex justify-between text-emerald-400">
                        <span className="flex items-center gap-1">
                          <Percent size={13} />
                          Uygulanan İndirim:
                        </span>
                        <span className="font-mono font-semibold">
                          -{formatMoney(selectedReceipt.discount_cents ?? selectedReceipt.discountCents ?? 0)}
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between text-slate-400">
                      <span>Hesaplanan KDV Tutarı:</span>
                      <span className="font-mono text-slate-200">
                        {formatMoney(
                          selectedReceipt.tax_total_cents ??
                            selectedReceipt.taxTotalCents ??
                            Math.round((selectedReceipt.total_cents ?? selectedReceipt.totalCents ?? 0) * 0.1)
                        )}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-slate-800 flex justify-between text-base font-bold text-white">
                      <span>Genel Toplam:</span>
                      <span className="font-mono text-indigo-400 text-lg">
                        {formatMoney(selectedReceipt.total_cents ?? selectedReceipt.totalCents ?? 0)}
                      </span>
                    </div>

                    {/* Tahsilat ve Para Üstü */}
                    {(selectedReceipt.tendered_cents != null || selectedReceipt.change_cents != null) && (
                      <div className="pt-2 border-t border-slate-800/60 grid grid-cols-2 gap-2 text-slate-400 text-[11px]">
                        {selectedReceipt.tendered_cents != null && (
                          <div>
                            Tahsil Edilen Tutar:{' '}
                            <strong className="text-slate-200">{formatMoney(selectedReceipt.tendered_cents)}</strong>
                          </div>
                        )}
                        {selectedReceipt.change_cents != null && (
                          <div className="text-right">
                            Verilen Para Üstü:{' '}
                            <strong className="text-emerald-400">{formatMoney(selectedReceipt.change_cents)}</strong>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Fiş Notu */}
                  {selectedReceipt.notes && (
                    <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
                      <Info size={16} className="text-indigo-400 shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-slate-200">Fiş Notu:</strong> {selectedReceipt.notes}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* ========================================================================= */
                /* TERMAL FİŞ 80mm KAĞIT SİMÜLASYONU GÖRÜNÜMÜ                               */
                /* ========================================================================= */
                <div className="flex justify-center py-2">
                  <div
                    ref={thermalPrintRef}
                    className="w-full max-w-[360px] bg-white text-black p-6 font-mono text-xs rounded shadow-2xl border border-slate-300 select-text"
                    style={{ fontFamily: '"Courier New", Courier, monospace' }}
                  >
                    {/* Fiş Başlığı */}
                    <div className="text-center pb-3 border-b border-dashed border-gray-400">
                      <div className="text-base font-extrabold tracking-wider">KASAM360 RESTAURANT</div>
                      <div className="text-[11px] text-gray-700">MODERN ADİSYON & POS SİSTEMİ</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">Mersis: 012345678900001</div>
                      <div className="text-[10px] text-gray-500">Kadıköy / İstanbul - Tel: 0216 555 3636</div>
                    </div>

                    {/* Fiş Üst Bilgileri */}
                    <div className="py-2 border-b border-dashed border-gray-400 text-[11px] space-y-1">
                      <div className="flex justify-between">
                        <span>FİŞ NO:</span>
                        <span className="font-bold">#{selectedReceipt.id.substring(0, 12)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>TARİH:</span>
                        <span>{formatDate(selectedReceipt.created_at || selectedReceipt.createdAt || '')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>MASA:</span>
                        <span className="font-bold">{selectedReceipt.table_id || selectedReceipt.tableId || 'Masa'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>KASİYER:</span>
                        <span>{selectedReceipt.cashier_name || selectedReceipt.cashierName || 'Kasiyer'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>ÖDEME:</span>
                        <span className="font-bold uppercase">
                          {selectedReceipt.payment_method || selectedReceipt.paymentMethod || 'NAKİT'}
                        </span>
                      </div>
                    </div>

                    {/* Ürün Listesi */}
                    <div className="py-2 border-b border-dashed border-gray-400 text-[11px]">
                      <div className="flex justify-between font-bold border-b border-gray-300 pb-1 mb-1">
                        <span className="w-1/2">ÜRÜN</span>
                        <span className="w-1/6 text-center">ADET</span>
                        <span className="w-1/3 text-right">TUTAR</span>
                      </div>
                      {selectedReceipt.items?.map((it, i) => (
                        <div key={i} className="py-0.5">
                          <div className="flex justify-between">
                            <span className="w-1/2 font-semibold truncate">
                              {it.productName || it.product_name || 'Ürün'}
                            </span>
                            <span className="w-1/6 text-center">{it.quantity}</span>
                            <span className="w-1/3 text-right">
                              {formatMoney(it.totalCents ?? it.total_cents ?? 0)}
                            </span>
                          </div>
                          {it.modifiers && it.modifiers.length > 0 && (
                            <div className="text-[9px] text-gray-600 pl-2">
                              + {it.modifiers.join(', ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Finansal Özet */}
                    <div className="py-2 border-b border-dashed border-gray-400 text-[11px] space-y-1">
                      <div className="flex justify-between">
                        <span>ARA TOPLAM (Matrah):</span>
                        <span>
                          {formatMoney(
                            selectedReceipt.subtotal_cents ??
                              selectedReceipt.subtotalCents ??
                              Math.round(((selectedReceipt.total_cents ?? selectedReceipt.totalCents ?? 0) * 100) / 110)
                          )}
                        </span>
                      </div>
                      {(selectedReceipt.discount_cents ?? selectedReceipt.discountCents ?? 0) > 0 && (
                        <div className="flex justify-between text-gray-700">
                          <span>İNDİRİM:</span>
                          <span>-{formatMoney(selectedReceipt.discount_cents ?? selectedReceipt.discountCents ?? 0)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>KDV TOPLAMI:</span>
                        <span>
                          {formatMoney(
                            selectedReceipt.tax_total_cents ??
                              selectedReceipt.taxTotalCents ??
                              Math.round((selectedReceipt.total_cents ?? selectedReceipt.totalCents ?? 0) * 0.1)
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm font-extrabold pt-1 border-t border-gray-400">
                        <span>TOPLAM:</span>
                        <span>{formatMoney(selectedReceipt.total_cents ?? selectedReceipt.totalCents ?? 0)}</span>
                      </div>
                    </div>

                    {/* Barkod Görsel Simülasyonu */}
                    <div className="pt-4 text-center">
                      <div className="inline-block tracking-widest text-[16px] font-barcode scale-y-150 my-1 font-bold">
                        ||||| | |||| ||| |||||| | ||||| || |||
                      </div>
                      <div className="text-[9px] text-gray-600 font-mono mt-1">*{selectedReceipt.id}*</div>
                      <div className="text-[10px] font-bold text-gray-800 mt-2">
                        MALİ DEĞERİ YOKTUR - BİLGİ FİŞİDİR
                      </div>
                      <div className="text-[9px] text-gray-500 mt-0.5">
                        Bizi Tercih Ettiğiniz İçin Teşekkür Ederiz!
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/80">
              <button
                onClick={() => handleCopyId(selectedReceipt.id)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
              >
                <Copy size={14} />
                <span>Fiş No Kopyala</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleBrowserPrint}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors"
                >
                  <Printer size={14} />
                  <span>Yazdır (PDF)</span>
                </button>

                <button
                  onClick={() => handleReprint(selectedReceipt)}
                  disabled={printingReceiptId === selectedReceipt.id}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md transition-all active:scale-95 disabled:opacity-50"
                >
                  <Printer size={15} className={printingReceiptId === selectedReceipt.id ? 'animate-bounce' : ''} />
                  <span>
                    {printingReceiptId === selectedReceipt.id ? 'Yazdırılıyor...' : 'Termal Fiş Yazdır (ESC/POS)'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

