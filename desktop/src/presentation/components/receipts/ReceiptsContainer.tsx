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

  // Filtreleme Durumları
  const [searchTerm, setSearchTerm] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<string>('ALL');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('DATE_DESC');

  // Modal Durumları
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

  // Sunucudan fiş geçmişini çekme
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
      console.error('Fişler yüklenemedi:', e);
      addToast('Geçmiş fişler yüklenemedi.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchReceipts();
  }, []);

  // Para ve Tarih formatlama yardımcıları
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
      if (diffHrs < 24) return `${diffHrs} sa önce`;
      if (diffDays === 1) return 'Dün';
      if (diffDays < 7) return `${diffDays} gün önce`;
      return formatDate(iso);
    } catch {
      return iso;
    }
  };

  // Fiş No panoya kopyalama
  const handleCopyId = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    addToast(`Fiş No kopyalandı: ${id.substring(0, 8)}...`, 'info');
  };

  // ESC/POS termal yazıcıya fiş gönderme
  const handleReprint = async (receipt: ReceiptDto, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setPrintingReceiptId(receipt.id);

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
        totalCents: it.totalCents ?? it.total_cents ?? ((it.unitPriceCents ?? it.unit_price_cents ?? 0) * (it.quantity || 1)),
        total_cents: it.totalCents ?? it.total_cents ?? ((it.unitPriceCents ?? it.unit_price_cents ?? 0) * (it.quantity || 1)),
        modifiers: it.modifiers || [],
        notes: it.notes,
      })),
    };

    try {
      await invoke('print_receipt', { order: normalizedPayload });
      addToast(`Fiş (#${receipt.id.substring(0, 8)}) termal yazıcıya gönderildi.`, 'success');
    } catch (err) {
      console.error('Yazdırma hatası:', err);
      addToast('Yazdırma işlemi başarısız oldu.', 'error');
    } finally {
      setPrintingReceiptId(null);
    }
  };

  // ESC tuşu ile fiş detay modalını kapatma (Apple HIG klavye erişilebilirliği)
  useEffect(() => {
    if (!selectedReceipt) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedReceipt(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedReceipt]);

  // Tarayıcı üzerinden yalnızca 80mm termal fiş çıktısını yazdırma
  const handleBrowserPrint = () => {
    if (!thermalPrintRef.current) {
      window.print();
      return;
    }
    const printContent = thermalPrintRef.current.innerHTML;
    const printWindow = window.open('', '_blank', 'width=420,height=650');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Termal Fiş - #${selectedReceipt?.id || ''}</title>
            <style>
              @page { size: 80mm auto; margin: 0; }
              body { font-family: "Courier New", Courier, monospace; font-size: 11px; margin: 8px; color: #000; background: #fff; }
              * { box-sizing: border-box; }
            </style>
          </head>
          <body>
            ${printContent}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 250);
    } else {
      window.print();
    }
  };

  // Filtreleri sıfırlama
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

  // Filtrelenmiş ve sıralanmış liste hesaplama
  const filteredReceipts = useMemo(() => {
    return receipts.filter((rcp) => {
      const id = rcp.id.toLowerCase();
      const table = (rcp.table_id || rcp.tableId || '').toLowerCase();
      const cashier = (rcp.cashier_name || rcp.cashierName || rcp.cashier_id || rcp.cashierId || '').toLowerCase();
      const sTerm = searchTerm.trim().toLowerCase();

      // 1. Metin araması
      if (sTerm) {
        const matchesMain = id.includes(sTerm) || table.includes(sTerm) || cashier.includes(sTerm);
        const matchesItems = rcp.items?.some((it) =>
          (it.productName || it.product_name || '').toLowerCase().includes(sTerm)
        );
        if (!matchesMain && !matchesItems) return false;
      }

      // 2. Ödeme yöntemi filtresi
      if (paymentFilter !== 'ALL') {
        const method = (rcp.payment_method || rcp.paymentMethod || '').toLowerCase();
        if (paymentFilter === 'Nakit' && !method.includes('nakit') && !method.includes('cash')) return false;
        if (paymentFilter === 'Kredi Kartı' && !method.includes('kart') && !method.includes('card')) return false;
        if (paymentFilter === 'Parçalı' && !method.includes('parçalı') && !method.includes('split')) return false;
      }

      // 3. Tutar filtresi
      const totalCents = rcp.total_cents ?? rcp.totalCents ?? 0;
      if (minAmount.trim()) {
        const minCents = Math.round(parseFloat(minAmount) * 100);
        if (!isNaN(minCents) && totalCents < minCents) return false;
      }
      if (maxAmount.trim()) {
        const maxCents = Math.round(parseFloat(maxAmount) * 100);
        if (!isNaN(maxCents) && totalCents > maxCents) return false;
      }

      // 4. Tarih filtresi
      const createdAt = new Date(rcp.created_at || rcp.createdAt || '');
      if (isNaN(createdAt.getTime())) return true;

      const nowDate = new Date();
      if (datePreset === 'TODAY') {
        const isToday =
          createdAt.getDate() === nowDate.getDate() &&
          createdAt.getMonth() === nowDate.getMonth() &&
          createdAt.getFullYear() === nowDate.getFullYear();
        if (!isToday) return false;
      } else if (datePreset === 'YESTERDAY') {
        const yesterday = new Date(nowDate);
        yesterday.setDate(nowDate.getDate() - 1);
        const isYesterday =
          createdAt.getDate() === yesterday.getDate() &&
          createdAt.getMonth() === yesterday.getMonth() &&
          createdAt.getFullYear() === yesterday.getFullYear();
        if (!isYesterday) return false;
      } else if (datePreset === 'LAST_7_DAYS') {
        const sevenDaysAgo = new Date(nowDate);
        sevenDaysAgo.setDate(nowDate.getDate() - 7);
        if (createdAt < sevenDaysAgo) return false;
      } else if (datePreset === 'THIS_MONTH') {
        const isThisMonth =
          createdAt.getMonth() === nowDate.getMonth() &&
          createdAt.getFullYear() === nowDate.getFullYear();
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

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchTerm.trim()) count++;
    if (datePreset !== 'ALL') count++;
    if (paymentFilter !== 'ALL') count++;
    if (minAmount.trim() || maxAmount.trim()) count++;
    return count;
  }, [searchTerm, datePreset, paymentFilter, minAmount, maxAmount]);

  // Apple HIG Ödeme Rozeti
  const getPaymentBadge = (method?: string) => {
    const m = (method || 'Nakit').toLowerCase();
    if (m.includes('nakit') || m.includes('cash')) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
          <Banknote size={12} />
          Nakit
        </span>
      );
    }
    if (m.includes('kart') || m.includes('card')) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/25">
          <CreditCard size={12} />
          Kredi Kartı
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/25">
        <Layers size={12} />
        Parçalı
      </span>
    );
  };

  return (
    <div className="flex h-full w-full flex-col bg-transparent dark:text-[#f5f5f7] text-[#1c1c1e] p-4 sm:p-6 overflow-hidden select-none">
      {/* Üst Başlık ve Yenileme Butonu */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl dark:bg-white/[0.06] bg-black/[0.05] dark:text-white text-zinc-900 border dark:border-white/[0.08] border-black/10 shadow-inner">
            <Receipt size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight dark:text-white text-zinc-900">Geçmiş Fişler</h1>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full dark:bg-white/[0.06] bg-black/[0.05] dark:text-white/60 text-zinc-600 border dark:border-white/[0.08] border-black/10">
                Arşiv
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchReceipts(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl dark:bg-white/[0.06] bg-white hover:dark:bg-white/[0.1] hover:bg-zinc-50 dark:text-white text-zinc-800 border dark:border-white/[0.08] border-black/10 text-xs font-semibold transition-all active:scale-95 cursor-pointer disabled:opacity-40 shadow-sm"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin text-[#007AFF]' : 'dark:text-white/60 text-zinc-500'} />
            <span>Yenile</span>
          </button>
        </div>
      </div>

      {/* Apple Spatial KPI Özet Kartları */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 shrink-0">
        <div className="rounded-2xl border dark:border-white/[0.08] border-black/10 dark:bg-white/[0.04] bg-white/75 p-3.5 backdrop-blur-xl shadow-sm dark:shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between dark:text-white/50 text-zinc-500 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Toplam Fiş</span>
            <FileText size={15} className="dark:text-white/40 text-zinc-400" />
          </div>
          <div className="text-2xl font-bold tracking-tight dark:text-white text-zinc-900">{stats.count}</div>
        </div>

        <div className="rounded-2xl border dark:border-white/[0.08] border-black/10 dark:bg-white/[0.04] bg-white/75 p-3.5 backdrop-blur-xl shadow-sm dark:shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between dark:text-white/50 text-zinc-500 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Toplam Ciro</span>
            <DollarSign size={15} className="text-[#007AFF]" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-[#007AFF]">{formatMoney(stats.totalRevenueCents)}</div>
        </div>

        <div className="rounded-2xl border dark:border-white/[0.08] border-black/10 dark:bg-white/[0.04] bg-white/75 p-3.5 backdrop-blur-xl shadow-sm dark:shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between dark:text-white/50 text-zinc-500 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Nakit Satış</span>
            <Banknote size={15} className="text-emerald-500" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-emerald-500">{formatMoney(stats.cashTotalCents)}</div>
        </div>

        <div className="rounded-2xl border dark:border-white/[0.08] border-black/10 dark:bg-white/[0.04] bg-white/75 p-3.5 backdrop-blur-xl shadow-sm dark:shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between dark:text-white/50 text-zinc-500 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Kart / POS</span>
            <CreditCard size={15} className="text-blue-500" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-blue-500">{formatMoney(stats.cardTotalCents)}</div>
        </div>

        <div className="col-span-2 md:col-span-1 rounded-2xl border dark:border-white/[0.08] border-black/10 dark:bg-white/[0.04] bg-white/75 p-3.5 backdrop-blur-xl shadow-sm dark:shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between dark:text-white/50 text-zinc-500 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Ortalama Fiş</span>
            <Receipt size={15} className="text-amber-500" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-amber-500">{formatMoney(stats.avgTicket)}</div>
        </div>
      </div>

      {/* Arama & Filtreleme Araç Çubuğu */}
      <div className="rounded-2xl border dark:border-white/[0.08] border-black/10 dark:bg-white/[0.04] bg-white/75 p-3 mb-4 backdrop-blur-xl space-y-2.5 shrink-0 shadow-sm dark:shadow-none">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Canlı Arama Input (iOS Spotlight Tarzı) */}
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 dark:text-white/40 text-zinc-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Fiş No, Masa, Kasiyer veya Ürün ara..."
              className="w-full rounded-xl dark:bg-white/[0.04] bg-black/[0.04] border dark:border-white/[0.08] border-black/10 pl-9 pr-8 py-2 text-xs dark:text-white text-zinc-900 dark:placeholder-white/40 placeholder-zinc-400 focus:outline-none focus:border-[#007AFF] focus:dark:bg-white/[0.06] focus:bg-white transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 dark:text-white/40 text-zinc-400 hover:dark:text-white hover:text-black cursor-pointer"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Tarih Hazır Segmentleri (iOS Segmented Bar) */}
          <div className="flex items-center dark:bg-black/40 bg-black/[0.04] border dark:border-white/[0.06] border-black/10 rounded-xl p-1 text-xs">
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
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  datePreset === item.key
                    ? 'dark:bg-white/[0.15] bg-white text-[#007AFF] dark:text-white shadow-sm font-bold'
                    : 'dark:text-white/60 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.04] hover:bg-black/[0.04]'
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
            className="rounded-xl dark:bg-[#16171b] bg-white border dark:border-white/[0.08] border-black/10 px-3 py-2 text-xs font-medium dark:text-white/90 text-zinc-800 focus:outline-none focus:border-[#007AFF] cursor-pointer shadow-sm"
          >
            <option value="ALL">Tüm Ödemeler</option>
            <option value="Nakit">Nakit</option>
            <option value="Kredi Kartı">Kredi Kartı</option>
            <option value="Parçalı">Parçalı Ödeme</option>
          </select>

          {/* Sıralama Dropdown */}
          <div className="flex items-center gap-1 text-xs">
            <ArrowUpDown size={13} className="dark:text-white/40 text-zinc-500" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="rounded-xl dark:bg-[#16171b] bg-white border dark:border-white/[0.08] border-black/10 px-3 py-2 text-xs font-medium dark:text-white/90 text-zinc-800 focus:outline-none focus:border-[#007AFF] cursor-pointer shadow-sm"
            >
              <option value="DATE_DESC">En Yeni (İlk)</option>
              <option value="DATE_ASC">En Eski (İlk)</option>
              <option value="AMOUNT_DESC">Tutar: Yüksekten Düşüğe</option>
              <option value="AMOUNT_ASC">Tutar: Düşükten Yükseğe</option>
            </select>
          </div>

          {/* Filtreleri Sıfırla */}
          {activeFiltersCount > 0 && (
            <button
              onClick={handleResetFilters}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-500 dark:text-rose-300 border border-rose-500/30 text-xs font-semibold transition-all cursor-pointer"
            >
              <X size={13} />
              <span>Sıfırla ({activeFiltersCount})</span>
            </button>
          )}
        </div>

        {/* Özel Tarih & Tutar Aralığı */}
        {(datePreset === 'CUSTOM' || minAmount || maxAmount) && (
          <div className="pt-2 border-t dark:border-white/[0.06] border-black/10 flex flex-wrap items-center gap-3 text-xs">
            {datePreset === 'CUSTOM' && (
              <div className="flex items-center gap-2 dark:bg-white/[0.04] bg-black/[0.03] px-3 py-1.5 rounded-xl border dark:border-white/[0.08] border-black/10">
                <Calendar size={13} className="text-[#007AFF]" />
                <span className="dark:text-white/50 text-zinc-500">Başlangıç:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-transparent dark:text-white text-zinc-900 focus:outline-none border-b dark:border-white/20 border-black/20"
                />
                <span className="dark:text-white/50 text-zinc-500 ml-2">Bitiş:</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-transparent dark:text-white text-zinc-900 focus:outline-none border-b dark:border-white/20 border-black/20"
                />
              </div>
            )}

            <div className="flex items-center gap-2 dark:bg-white/[0.04] bg-black/[0.03] px-3 py-1.5 rounded-xl border dark:border-white/[0.08] border-black/10">
              <Filter size={13} className="text-amber-500" />
              <span className="dark:text-white/50 text-zinc-500">Min ₺:</span>
              <input
                type="number"
                placeholder="0"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                className="w-16 bg-transparent dark:text-white text-zinc-900 focus:outline-none border-b dark:border-white/20 border-black/20"
              />
              <span className="dark:text-white/50 text-zinc-500 ml-2">Max ₺:</span>
              <input
                type="number"
                placeholder="Limitsiz"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                className="w-20 bg-transparent dark:text-white text-zinc-900 focus:outline-none border-b dark:border-white/20 border-black/20"
              />
            </div>
          </div>
        )}
      </div>

      {/* Minimalist iOS Tarzı Fiş Listesi */}
      <div className="flex-1 overflow-hidden rounded-2xl border dark:border-white/[0.08] border-black/10 dark:bg-black/20 bg-white/75 backdrop-blur-2xl shadow-sm dark:shadow-2xl flex flex-col min-h-0">
        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#007AFF] border-t-transparent" />
            <p className="text-xs dark:text-white/50 text-zinc-500 font-medium">Fişler yükleniyor...</p>
          </div>
        ) : filteredReceipts.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl dark:bg-white/[0.04] bg-black/[0.04] dark:text-white/30 text-zinc-400 mb-3 border dark:border-white/[0.06] border-black/10">
              <Receipt size={28} />
            </div>
            <h3 className="text-sm font-semibold dark:text-white/80 text-zinc-800">Fiş Bulunamadı</h3>
            <p className="text-xs dark:text-white/40 text-zinc-500 max-w-sm mt-1 mb-4">
              {activeFiltersCount > 0
                ? 'Belirtilen arama ve filtre kriterlerine uygun fiş kaydı bulunmamaktadır.'
                : 'Sistemde henüz tamamlanmış ve kapanmış bir adisyon kaydı yok.'}
            </p>
            {activeFiltersCount > 0 && (
              <button
                onClick={handleResetFilters}
                className="px-3.5 py-1.5 rounded-xl bg-[#007AFF] hover:bg-[#0071E3] text-white text-xs font-semibold shadow transition-all cursor-pointer"
              >
                Filtreleri Temizle
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-auto no-scrollbar">
            <table className="w-full text-left text-xs dark:text-white/80 text-zinc-800 border-collapse">
              <thead className="dark:bg-black/40 bg-zinc-100/80 text-[11px] font-bold uppercase tracking-wider dark:text-white/40 text-zinc-500 sticky top-0 z-10 backdrop-blur-md border-b dark:border-white/[0.06] border-black/10">
                <tr>
                  <th className="px-5 py-3">Fiş No</th>
                  <th className="px-5 py-3">Masa</th>
                  <th className="px-5 py-3">Tarih</th>
                  <th className="px-5 py-3">Kasiyer</th>
                  <th className="px-5 py-3">Ödeme Tipi</th>
                  <th className="px-5 py-3 text-center">Kalem</th>
                  <th className="px-5 py-3 text-right">Tutar</th>
                  <th className="px-5 py-3 text-right">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
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
                      className="hover:dark:bg-white/[0.04] hover:bg-black/[0.03] cursor-pointer transition-colors group"
                    >
                      {/* Fiş No */}
                      <td className="px-5 py-3 font-medium dark:text-white text-zinc-900">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs dark:text-white/90 text-zinc-800 font-semibold">
                            #{receipt.id.length > 14 ? receipt.id.substring(0, 10) + '...' : receipt.id}
                          </span>
                          <button
                            onClick={(e) => handleCopyId(receipt.id, e)}
                            className="dark:text-white/40 text-zinc-400 hover:dark:text-white hover:text-black p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          >
                            {copiedId === receipt.id ? (
                              <Check size={12} className="text-emerald-500" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Masa */}
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-semibold dark:bg-white/[0.06] bg-black/[0.05] dark:text-white/90 text-zinc-800 border dark:border-white/[0.08] border-black/10">
                          {receipt.table_id || receipt.tableId || 'Masa'}
                        </span>
                      </td>

                      {/* Tarih */}
                      <td className="px-5 py-3">
                        <div className="flex flex-col">
                          <span className="text-xs dark:text-white text-zinc-900 font-medium">
                            {formatDate(receipt.created_at || receipt.createdAt || '')}
                          </span>
                          <span className="text-[11px] dark:text-white/40 text-zinc-500">
                            {formatRelativeTime(receipt.created_at || receipt.createdAt || '')}
                          </span>
                        </div>
                      </td>

                      {/* Kasiyer */}
                      <td className="px-5 py-3 text-xs dark:text-white/70 text-zinc-700">
                        {receipt.cashier_name || receipt.cashierName || receipt.cashier_id || receipt.cashierId || '—'}
                      </td>

                      {/* Ödeme Tipi */}
                      <td className="px-5 py-3">
                        {getPaymentBadge(receipt.payment_method || receipt.paymentMethod)}
                      </td>

                      {/* Kalem Sayısı */}
                      <td className="px-5 py-3 text-center">
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-mono font-medium dark:bg-white/[0.04] bg-black/[0.04] dark:text-white/60 text-zinc-600">
                          {itemsCount > 0 ? `${itemsCount} adet` : '—'}
                        </span>
                      </td>

                      {/* Tutar */}
                      <td className="px-5 py-3 text-right font-bold text-sm dark:text-white text-zinc-900 font-mono">
                        {formatMoney(total)}
                      </td>

                      {/* İşlemler */}
                      <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setSelectedReceipt(receipt);
                              setModalTab('DETAILS');
                            }}
                            className="p-1.5 rounded-xl dark:bg-white/[0.05] bg-black/[0.04] hover:dark:bg-white/[0.1] hover:bg-black/[0.08] dark:text-white/70 text-zinc-700 hover:dark:text-white hover:text-black border dark:border-white/[0.08] border-black/10 transition-all cursor-pointer active:scale-95"
                          >
                            <Eye size={14} />
                          </button>

                          <button
                            onClick={(e) => handleReprint(receipt, e)}
                            disabled={isPrinting}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#007AFF] hover:bg-[#0071E3] text-white text-xs font-semibold shadow-md shadow-[#007AFF]/20 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                          >
                            <Printer size={13} className={isPrinting ? 'animate-bounce' : ''} />
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
        <div className="px-5 py-2.5 border-t dark:border-white/[0.06] border-black/[0.06] dark:bg-white/[0.02] bg-black/[0.02] flex items-center justify-between text-xs dark:text-white/50 text-zinc-500 shrink-0">
          <div>
            Toplam <span className="font-semibold dark:text-white/80 text-zinc-800">{filteredReceipts.length}</span> fiş
          </div>
          <div className="flex items-center gap-4">
            <span>
              Listelenen Tutar: <strong className="dark:text-white text-zinc-900 font-bold">{formatMoney(stats.totalRevenueCents)}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* APPLE HIG FİŞ DETAY MODALI (DETAYLAR + 80mm TERMAL SİMÜLASYONU)         */}
      {/* ========================================================================= */}
      {selectedReceipt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-2xl p-4 animate-in fade-in duration-150"
          onClick={() => setSelectedReceipt(null)}
        >
          <div
            className="relative w-full max-w-2xl rounded-3xl border dark:border-white/[0.1] border-black/[0.08] backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 dark:text-[#f5f5f7] text-zinc-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b dark:border-white/[0.08] border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.02]">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl dark:bg-white/[0.06] bg-black/[0.05] dark:text-white text-zinc-800 border dark:border-white/[0.08] border-black/[0.08]">
                  <Receipt size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold dark:text-white text-zinc-900">Fiş Detayı</h3>
                    <span className="font-mono text-xs px-2 py-0.5 rounded-full dark:bg-white/[0.08] bg-black/[0.05] dark:text-white/80 text-zinc-700 border dark:border-white/[0.08] border-black/[0.08]">
                      #{selectedReceipt.id}
                    </span>
                  </div>
                  <p className="text-[11px] dark:text-white/40 text-zinc-500">
                    {formatDate(selectedReceipt.created_at || selectedReceipt.createdAt || '')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedReceipt(null)}
                  className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white/60 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal Sekmeleri (iOS Segmented Pill Bar) */}
            <div className="px-6 pt-3 shrink-0">
              <div className="flex bg-black/40 border border-white/[0.06] rounded-xl p-1 text-xs">
                <button
                  onClick={() => setModalTab('DETAILS')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg font-semibold transition-all cursor-pointer ${
                    modalTab === 'DETAILS'
                      ? 'bg-white/[0.15] text-white shadow-sm font-bold'
                      : 'text-white/60 hover:text-white'
                  }`}
                >
                  <FileText size={14} />
                  Sipariş & Kalem Dökümü
                </button>
                <button
                  onClick={() => setModalTab('THERMAL')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg font-semibold transition-all cursor-pointer ${
                    modalTab === 'THERMAL'
                      ? 'bg-white/[0.15] text-white shadow-sm font-bold'
                      : 'text-white/60 hover:text-white'
                  }`}
                >
                  <Printer size={14} />
                  80mm Termal Fiş Önizleme
                </button>
              </div>
            </div>

            {/* Modal İçeriği */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar">
              {modalTab === 'DETAILS' ? (
                <>
                  {/* Apple Glass Bilgi Kartları Izgarası */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
                      <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider block mb-1">
                        Masa No
                      </span>
                      <span className="text-sm font-bold text-white">
                        {selectedReceipt.table_id || selectedReceipt.tableId || 'Masa Belirtilmedi'}
                      </span>
                    </div>

                    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
                      <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider block mb-1">
                        Kasiyer
                      </span>
                      <span className="text-sm font-bold text-white/90">
                        {selectedReceipt.cashier_name || selectedReceipt.cashierName || selectedReceipt.cashier_id || '—'}
                      </span>
                    </div>

                    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
                      <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider block mb-1">
                        Ödeme Tipi
                      </span>
                      <div>{getPaymentBadge(selectedReceipt.payment_method || selectedReceipt.paymentMethod)}</div>
                    </div>

                    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
                      <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider block mb-1">
                        Durum
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Kapandı & Ödendi
                      </span>
                    </div>
                  </div>

                  {/* Kalemler Tablosu (iOS Grouped Table) */}
                  <div>
                    <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
                      <table className="w-full text-left text-xs text-white/80">
                        <thead className="bg-white/[0.03] text-white/40 font-bold uppercase text-[10px] tracking-wider border-b border-white/[0.06]">
                          <tr>
                            <th className="px-4 py-2.5">Ürün</th>
                            <th className="px-4 py-2.5 text-center">Adet</th>
                            <th className="px-4 py-2.5 text-right">Birim Fiyat</th>
                            <th className="px-4 py-2.5 text-center">KDV</th>
                            <th className="px-4 py-2.5 text-right">Toplam</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                          {selectedReceipt.items && selectedReceipt.items.length > 0 ? (
                            selectedReceipt.items.map((it, idx) => {
                              const qty = it.quantity || 1;
                              const unitPrice = it.unitPriceCents ?? it.unit_price_cents ?? 0;
                              const totalCents = it.totalCents ?? it.total_cents ?? unitPrice * qty;
                              const taxRate = it.taxRate ?? it.tax_rate ?? 10;
                              const name = it.productName || it.product_name || 'Ürün';

                              return (
                                <tr key={it.id || idx} className="hover:bg-white/[0.02] transition-colors">
                                  <td className="px-4 py-2.5">
                                    <div className="font-semibold text-white">{name}</div>
                                    {it.modifiers && it.modifiers.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {it.modifiers.map((m, mIdx) => (
                                          <span
                                            key={mIdx}
                                            className="px-1.5 py-0.5 text-[10px] rounded bg-white/[0.06] text-white/70 border border-white/[0.06]"
                                          >
                                            {m}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    {it.notes && (
                                      <div className="text-[11px] text-amber-300/80 italic mt-0.5">
                                        Not: {it.notes}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5 text-center font-bold text-white">{qty}</td>
                                  <td className="px-4 py-2.5 text-right font-mono text-white/70">
                                    {formatMoney(unitPrice)}
                                  </td>
                                  <td className="px-4 py-2.5 text-center font-mono text-white/40">%{taxRate}</td>
                                  <td className="px-4 py-2.5 text-right font-mono font-bold text-white">
                                    {formatMoney(totalCents)}
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={5} className="px-4 py-6 text-center text-white/40">
                                Kalem detay bilgisi bulunamadı.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Finansal Döküm ve Vergi Dağılımı */}
                  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 space-y-2 text-xs">
                    <div className="flex justify-between text-white/50">
                      <span>Ara Toplam (Matrah):</span>
                      <span className="font-mono text-white/80">
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
                          <Percent size={12} />
                          Uygulanan İndirim:
                        </span>
                        <span className="font-mono font-semibold">
                          -{formatMoney(Math.abs(selectedReceipt.discount_cents ?? selectedReceipt.discountCents ?? 0))}
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between text-white/50">
                      <span>Hesaplanan KDV Tutarı:</span>
                      <span className="font-mono text-white/80">
                        {formatMoney(
                          selectedReceipt.tax_total_cents ??
                            selectedReceipt.taxTotalCents ??
                            Math.round((selectedReceipt.total_cents ?? selectedReceipt.totalCents ?? 0) * 0.1)
                        )}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-white/[0.08] flex justify-between text-base font-bold text-white">
                      <span>Genel Toplam:</span>
                      <span className="font-mono text-white text-lg">
                        {formatMoney(selectedReceipt.total_cents ?? selectedReceipt.totalCents ?? 0)}
                      </span>
                    </div>

                    {/* Tahsilat ve Para Üstü */}
                    {((selectedReceipt.tendered_cents != null || selectedReceipt.tenderedCents != null) ||
                      (selectedReceipt.change_cents != null || selectedReceipt.changeCents != null)) && (
                      <div className="pt-2 border-t border-white/[0.06] grid grid-cols-2 gap-2 text-white/50 text-[11px]">
                        {(selectedReceipt.tendered_cents != null || selectedReceipt.tenderedCents != null) && (
                          <div>
                            Tahsil Edilen Tutar:{' '}
                            <strong className="text-white">
                              {formatMoney(selectedReceipt.tendered_cents ?? selectedReceipt.tenderedCents ?? 0)}
                            </strong>
                          </div>
                        )}
                        {(selectedReceipt.change_cents != null || selectedReceipt.changeCents != null) && (
                          <div className="text-right">
                            Verilen Para Üstü:{' '}
                            <strong className="text-emerald-400">
                              {formatMoney(selectedReceipt.change_cents ?? selectedReceipt.changeCents ?? 0)}
                            </strong>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Fiş Notu */}
                  {selectedReceipt.notes && (
                    <div className="flex items-start gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3 text-xs text-white/60">
                      <Info size={15} className="text-[#007AFF] shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-white">Fiş Notu:</strong> {selectedReceipt.notes}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* ========================================================================= */
                /* TERMAL FİŞ 80mm SİMÜLASYONU                                              */
                /* ========================================================================= */
                <div className="flex justify-center py-2">
                  <div
                    ref={thermalPrintRef}
                    className="w-full max-w-[360px] bg-white text-black p-6 font-mono text-xs rounded-xl shadow-2xl border border-gray-300 select-text"
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
                          <span>-{formatMoney(Math.abs(selectedReceipt.discount_cents ?? selectedReceipt.discountCents ?? 0))}</span>
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
                      {((selectedReceipt.tendered_cents != null || selectedReceipt.tenderedCents != null) ||
                        (selectedReceipt.change_cents != null || selectedReceipt.changeCents != null)) && (
                        <div className="pt-1 mt-1 border-t border-dashed border-gray-400 text-[11px] space-y-0.5">
                          {(selectedReceipt.tendered_cents != null || selectedReceipt.tenderedCents != null) && (
                            <div className="flex justify-between">
                              <span>TAHSİLAT:</span>
                              <span className="font-bold">
                                {formatMoney(selectedReceipt.tendered_cents ?? selectedReceipt.tenderedCents ?? 0)}
                              </span>
                            </div>
                          )}
                          {(selectedReceipt.change_cents != null || selectedReceipt.changeCents != null) && (
                            <div className="flex justify-between">
                              <span>PARA ÜSTÜ:</span>
                              <span className="font-bold">
                                {formatMoney(selectedReceipt.change_cents ?? selectedReceipt.changeCents ?? 0)}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
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
            <div className="flex items-center justify-between px-6 py-4 border-t dark:border-white/[0.08] border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.02]">
              <button
                onClick={() => handleCopyId(selectedReceipt.id)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl dark:bg-white/[0.06] bg-black/[0.05] dark:hover:bg-white/[0.1] hover:bg-black/[0.08] dark:text-white text-zinc-800 text-xs font-semibold transition-all active:scale-95 cursor-pointer"
              >
                <Copy size={13} />
                <span>Fiş No Kopyala</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleBrowserPrint}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl dark:bg-white/[0.06] bg-black/[0.05] dark:hover:bg-white/[0.1] hover:bg-black/[0.08] dark:text-white text-zinc-800 border dark:border-white/[0.08] border-black/[0.08] text-xs font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  <Printer size={13} />
                  <span>Yazdır (PDF)</span>
                </button>

                <button
                  onClick={() => handleReprint(selectedReceipt)}
                  disabled={printingReceiptId === selectedReceipt.id}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#007AFF] hover:bg-[#0071E3] text-white text-xs font-bold shadow-lg shadow-[#007AFF]/25 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  <Printer size={14} className={printingReceiptId === selectedReceipt.id ? 'animate-bounce' : ''} />
                  <span>
                    {printingReceiptId === selectedReceipt.id ? 'Yazdırılıyor...' : 'Termal Fiş Yazdır'}
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
