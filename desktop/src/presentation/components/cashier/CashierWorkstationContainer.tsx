import { useEffect, useState, useMemo, useCallback } from 'react';
import { useFloorStore } from '../../store/useFloorStore';
import { useCartStore } from '../../store/useCartStore';
import { useAuthStore } from '../../store/useAuthStore';
import { PaymentMethod, CartItem, POSProduct, ModifierOption } from '../../types';
import {
  CheckCircle2, Clock, MapPin, Receipt, RefreshCcw, Banknote, CreditCard,
  XCircle, Lock, Unlock, History, Search, FileText, Printer, AlertCircle, Check, Info,
  Calculator, Delete, X,
} from 'lucide-react';
import { MoneyDisplay } from '../common/MoneyDisplay';
import { AppleButton } from '../common/AppleButton';
import { AppBadge } from '../common/AppBadge';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import { APPROVAL_OPERATIONS } from '../../../core/services/approvalService';
import InstantPinApprovalModal from './InstantPinApprovalModal';

// Hızlı nakit girişi için hazır banknot tutarları
const PRESET_AMOUNTS = [50, 100, 200, 500];

interface ShiftDto {
  id: string;
  tenantId?: string;
  tenant_id?: string;
  cashierId: string;
  cashier_id?: string;
  status: string;
  openedAt: string;
  opened_at?: string;
  closedAt?: string | null;
  closed_at?: string | null;
  expectedAmountCents: number;
  expected_amount_cents?: number;
  actualAmountCents?: number | null;
  actual_amount_cents?: number | null;
  differenceCents?: number | null;
  difference_cents?: number | null;
}

interface ShiftSummaryDto {
  shiftId: string;
  totalSales: number;
  totalCashIn: number;
  totalCashOut: number;
  expectedBalance: number;
  discrepancy: number;
  actualClosingBalance?: number | null;
}

// Backend snake_case ve frontend camelCase vardiya verilerini normalize eder
function normalizeShift(raw: Record<string, unknown> | null | undefined): ShiftDto | null {
  if (!raw) return null;
  return {
    id: (raw.id as string) || '',
    tenantId: (raw.tenantId || raw.tenant_id || 'DEFAULT_TENANT') as string,
    cashierId: (raw.cashierId || raw.cashier_id || '') as string,
    status: (raw.status as 'OPEN' | 'CLOSED') || 'OPEN',
    openedAt: (raw.openedAt || raw.opened_at || new Date().toISOString()) as string,
    closedAt: (raw.closedAt || raw.closed_at || null) as string | null,
    expectedAmountCents: Number(raw.expectedAmountCents ?? raw.expected_amount_cents ?? 0),
    actualAmountCents: raw.actualAmountCents !== undefined && raw.actualAmountCents !== null ? Number(raw.actualAmountCents) : (raw.actual_amount_cents !== undefined && raw.actual_amount_cents !== null ? Number(raw.actual_amount_cents) : null),
    differenceCents: raw.differenceCents !== undefined && raw.differenceCents !== null ? Number(raw.differenceCents) : (raw.difference_cents !== undefined && raw.difference_cents !== null ? Number(raw.difference_cents) : null),
  };
}

// Vardiya mutabakat özetini tutarlı formata dönüştürür
function normalizeShiftSummary(raw: Record<string, unknown> | null | undefined): ShiftSummaryDto | null {
  if (!raw) return null;
  return {
    shiftId: (raw.shiftId || raw.shift_id || '') as string,
    totalSales: Number(raw.totalSales ?? raw.total_sales ?? 0),
    totalCashIn: Number(raw.totalCashIn ?? raw.total_cash_in ?? 0),
    totalCashOut: Number(raw.totalCashOut ?? raw.total_cash_out ?? 0),
    expectedBalance: Number(raw.expectedBalance ?? raw.expected_balance ?? 0),
    discrepancy: Number(raw.discrepancy ?? 0),
    actualClosingBalance: raw.actualClosingBalance !== undefined && raw.actualClosingBalance !== null ? Number(raw.actualClosingBalance) : (raw.actual_closing_balance !== undefined && raw.actual_closing_balance !== null ? Number(raw.actual_closing_balance) : null),
  };
}

type ActiveTab = 'KASA' | 'GECMIS';

export function CashierWorkstationContainer() {
  const { tables, fetchFloorPlan } = useFloorStore();
  const { user } = useAuthStore();
  const cashierId = user?.userId || 'UNKNOWN';
  const cashierRole = user?.role || 'CASHIER';

  const [activeTab, setActiveTab] = useState<ActiveTab>('KASA');
  const [tableSearch, setTableSearch] = useState('');

  // Seçili masa ve sipariş kalemleri durumu
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [tableItems, setTableItems] = useState<CartItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);

  // Tuş takımı (numpad) görünürlük toggle durumu
  const [showNumpad, setShowNumpad] = useState(false);

  const [tenderedAmount, setTenderedAmount] = useState<string>('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState<{
    method: PaymentMethod;
    transactionId: string;
    totalCents: number;
    tenderedCents: number;
    changeCents: number;
    tableName: string;
    items: CartItem[];
  } | null>(null);

  // Apple tarzı bildirim göstergesi
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const showToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Vardiya oturumu durumu
  const [isShiftOpen, setIsShiftOpen] = useState(false);
  const [activeShift, setActiveShift] = useState<ShiftDto | null>(null);
  const [shiftSummary, setShiftSummary] = useState<ShiftSummaryDto | null>(null);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [showShiftModal, setShowShiftModal] = useState<'OPEN' | 'CLOSE' | null>(null);
  const [shiftAmount, setShiftAmount] = useState('');

  // X-Raporu gün içi ara mutabakat modalı
  const [showXReportModal, setShowXReportModal] = useState(false);
  const [xReportSummary, setXReportSummary] = useState<ShiftSummaryDto | null>(null);
  const [xReportLoading, setXReportLoading] = useState(false);

  // Kasa nakit giriş/çıkış modalı
  const [showCashModal, setShowCashModal] = useState<'IN' | 'OUT' | null>(null);
  const [cashAmount, setCashAmount] = useState('');
  const [cashReason, setCashReason] = useState('');

  // İptal (Void) modalı
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [showApprovalModal, setShowApprovalModal] = useState(false);

  // Vardiya geçmiş kayıtları
  const [shiftHistory, setShiftHistory] = useState<ShiftDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Z-Raporu detay modalı
  const [zReportShift, setZReportShift] = useState<ShiftDto | null>(null);
  const [zReportSummary, setZReportSummary] = useState<ShiftSummaryDto | null>(null);
  const [zReportLoading, setZReportLoading] = useState(false);

  // Kapanmış vardiya geçmişini veritabanından çeker
  const loadShiftHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const rawHistory = await tauriInvoke<Record<string, unknown>[]>('get_shift_history', {
        cashierId,
        cashier_id: cashierId,
      });
      const history = (rawHistory || []).map(normalizeShift).filter(Boolean) as ShiftDto[];
      setShiftHistory(history);
    } catch (err) {
      console.error('Failed to load shift history', err);
      showToast('error', 'Vardiya geçmişi yüklenemedi.');
    } finally {
      setHistoryLoading(false);
    }
  }, [cashierId, showToast]);

  // Sayfa ilk yüklendiğinde aktif vardiyayı kontrol eder
  useEffect(() => {
    const checkShift = async () => {
      try {
        const rawShift = await tauriInvoke<Record<string, unknown>>('get_active_shift', {
          cashierId,
          cashier_id: cashierId,
        });
        const shift = normalizeShift(rawShift);
        if (shift && shift.status === 'OPEN') {
          setIsShiftOpen(true);
          setActiveShift(shift);
        } else {
          setIsShiftOpen(false);
          setActiveShift(null);
          setShowShiftModal('OPEN');
        }
      } catch (err) {
        console.error('Failed to get active shift', err);
      } finally {
        setShiftLoading(false);
      }
    };
    checkShift();
  }, [cashierId]);

  // Salon masa durumunu periyodik senkronize eder
  useEffect(() => {
    fetchFloorPlan();
    const interval = setInterval(fetchFloorPlan, 10000);
    return () => clearInterval(interval);
  }, [fetchFloorPlan]);

  // Geçmiş sekmesine geçildiğinde listeyi tazeler
  useEffect(() => {
    if (activeTab === 'GECMIS') {
      loadShiftHistory();
    }
  }, [activeTab, loadShiftHistory]);

  // Z-Raporu detaylarını getirir
  const handleOpenZReport = async (shift: ShiftDto) => {
    setZReportShift(shift);
    setZReportSummary(null);
    setZReportLoading(true);
    try {
      const summary = await tauriInvoke<Record<string, unknown>>('get_shift_summary', {
        shiftId: shift.id,
        shift_id: shift.id,
      });
      setZReportSummary(normalizeShiftSummary(summary));
    } catch (err) {
      console.error('Failed to load Z-Report summary', err);
      showToast('error', 'Z-Raporu detayları alınamadı.');
    } finally {
      setZReportLoading(false);
    }
  };

  // Z-Raporu fişini yazıcıya iletir
  const handlePrintZReport = async () => {
    if (!zReportShift || !zReportSummary) return;
    try {
      // Faz 7: Z-Rapor artık çağıranın gönderdiği tutarlarla değil, veritabanındaki
      // vardiya kaydından basılır; özet ekranda gösterilen değerlerle eşleşir.
      await tauriInvoke('print_z_report', {
        shiftId: zReportShift.id,
        actorRole: cashierRole,
        tenantId: user?.tenantId,
      });
      showToast('success', 'Z-Raporu yazıcıya gönderildi.');
    } catch (err) {
      console.error('Print failed', err);
      showToast('error', `Yazdırma başarısız: ${String(err)}`);
    }
  };

  const occupiedTables = tables.filter((t) => t.status === 'OCCUPIED' || t.status === 'RESERVED');
  const filteredTables = tableSearch.trim()
    ? occupiedTables.filter((t) => t.name.toLowerCase().includes(tableSearch.trim().toLowerCase()))
    : occupiedTables;

  const selectedTable = tables.find((t) => t.id === selectedTableId);

  // Masaya tıklandığında sipariş kalemlerini yükler
  const handleSelectTable = async (tableId: string) => {
    setSelectedTableId(tableId);
    setTenderedAmount('');
    setPaymentSuccess(null);
    setIsLoadingItems(true);

    try {
      const items = await tauriInvoke<Record<string, unknown>[]>('get_order_items', {
        tableId,
        table_id: tableId,
        tenantId: user?.tenantId,
      });

      if (items && items.length > 0) {
        const formatted: CartItem[] = items.map((it: Record<string, unknown>) => {
          const prodObj = (typeof it.product === 'object' && it.product !== null ? it.product : {}) as Record<string, unknown>;
          const rawPrice = Number(it.unitPrice ?? it.unit_price ?? prodObj.price ?? prodObj.priceCents ?? 0);
          const rawTaxRate = Number(it.taxRate ?? it.tax_rate ?? prodObj.taxRate ?? 10);
          const rawQty = Number(it.quantity || 1);
          const rawSubtotal = Number(it.subtotal ?? (rawPrice * rawQty));
          const rawTax = Number(it.taxAmount ?? it.tax_amount ?? Math.round(rawSubtotal * (rawTaxRate / 100)));
          const rawTotal = Number(it.total ?? (rawSubtotal + rawTax));

          return {
            id: String(it.id || `item_${Math.random()}`),
            product: typeof it.product === 'object' && it.product !== null ? (it.product as POSProduct) : {
              id: String(it.product_id || it.id || 'prod_unknown'),
              sku: String(it.sku || `SKU-${it.product_id || it.id || 'ITEM'}`),
              name: String(it.product_name || it.name || 'Ürün'),
              price: rawPrice,
              taxRate: rawTaxRate,
              category: String(it.category || 'general'),
              inStock: true,
            },
            quantity: rawQty,
            unitPrice: rawPrice,
            taxRate: rawTaxRate,
            subtotal: rawSubtotal,
            taxAmount: rawTax,
            total: rawTotal,
            modifiers: it.modifiers as ModifierOption[] | undefined,
            note: it.note ? String(it.note) : undefined,
          };
        });
        setTableItems(formatted);
        useCartStore.setState({ activeTableId: tableId, items: formatted });
      } else {
        const table = tables.find((t) => t.id === tableId);
        if (table && table.currentTotal > 0) {
          const fallbackItem: CartItem = {
            id: `item_table_${table.id}`,
            product: {
              id: `prod_${table.id}`,
              sku: `SKU-${table.id}`,
              name: `${table.name} Sipariş Tutarı`,
              price: table.currentTotal,
              taxRate: 10,
              category: 'general',
              inStock: true,
            },
            quantity: 1,
            unitPrice: table.currentTotal,
            taxRate: 10,
            subtotal: Math.round(table.currentTotal / 1.1),
            taxAmount: table.currentTotal - Math.round(table.currentTotal / 1.1),
            total: table.currentTotal,
          };
          setTableItems([fallbackItem]);
          useCartStore.setState({ activeTableId: tableId, items: [fallbackItem] });
        } else {
          setTableItems([]);
          useCartStore.setState({ activeTableId: tableId, items: [] });
        }
      }
    } catch (err) {
      console.error('Failed to get order items', err);
      setTableItems([]);
    } finally {
      setIsLoadingItems(false);
    }
  };

  // Seçili masa tutarlarını hesaplar
  const tableTotals = useMemo(() => {
    let subtotal = 0;
    let taxTotal = 0;
    let grandTotal = 0;

    for (const item of tableItems) {
      subtotal += item.subtotal;
      taxTotal += item.taxAmount;
      grandTotal += item.total;
    }

    if (grandTotal === 0 && selectedTable && selectedTable.currentTotal > 0) {
      grandTotal = selectedTable.currentTotal;
      subtotal = Math.round(grandTotal / 1.1);
      taxTotal = grandTotal - subtotal;
    }

    return { subtotal, taxTotal, grandTotal };
  }, [tableItems, selectedTable]);

  const grandTotalCents = tableTotals.grandTotal;

  // Alınan tutar ve para üstü hesaplamaları
  const parsedTenderedLira = parseFloat(tenderedAmount) || 0;
  const tenderedCents = Math.round(parsedTenderedLira * 100);
  const changeCents = tenderedCents > 0 ? Math.max(0, tenderedCents - grandTotalCents) : 0;

  // Vardiya açılış veya kapanış işlemini tamamlar
  const handleShiftSubmit = async () => {
    const amountCents = Math.round((parseFloat(shiftAmount) || 0) * 100);
    if (amountCents < 0) {
      showToast('error', showShiftModal === 'OPEN' ? 'Geçersiz başlangıç tutarı.' : 'Geçersiz kasa sayım tutarı.');
      return;
    }
    try {
      if (showShiftModal === 'OPEN') {
        const rawShift = await tauriInvoke<Record<string, unknown>>('open_shift', {
          cashierId,
          cashier_id: cashierId,
          expectedAmountCents: amountCents,
          expected_amount_cents: amountCents,
        });
        const shift = normalizeShift(rawShift);
        if (shift) {
          setIsShiftOpen(true);
          setActiveShift(shift);
        }
        setShowShiftModal(null);
        setShiftAmount('');
        showToast('success', 'Vardiya başarıyla açıldı.');
      } else {
        await tauriInvoke('close_shift', {
          cashierId,
          cashier_id: cashierId,
          actualAmountCents: amountCents,
          actual_amount_cents: amountCents,
        });

        // Vardiya kapanışında otomatik Z-Raporu yazdır
        if (activeShift && shiftSummary) {
          await tauriInvoke('print_z_report', {
            shiftId: activeShift.id,
            actorRole: cashierRole,
            tenantId: user?.tenantId,
          }).catch(console.error);
        }

        setIsShiftOpen(false);
        setActiveShift(null);
        setShowShiftModal(null);
        setShiftAmount('');
        setShiftSummary(null);
        showToast('success', 'Vardiya kapatıldı ve Z-Raporu yazdırıldı.');
        if (activeTab === 'GECMIS') {
          loadShiftHistory();
        }
      }
    } catch (err: unknown) {
      showToast('error', `Vardiya Hatası: ${String(err)}`);
    }
  };

  const handleOpenCloseShiftModal = async () => {
    if (!activeShift) return;
    try {
      const rawSummary = await tauriInvoke<Record<string, unknown>>('get_shift_summary', {
        shiftId: activeShift.id,
        shift_id: activeShift.id,
      });
      setShiftSummary(normalizeShiftSummary(rawSummary));
      setShiftAmount('');
      setShowShiftModal('CLOSE');
    } catch (e) {
      showToast('error', `Vardiya özeti alınamadı: ${String(e)}`);
    }
  };

  // Gün içi anlık X-Raporu özeti çeker
  const handleOpenXReport = async () => {
    if (!activeShift) return;
    setShowXReportModal(true);
    setXReportLoading(true);
    try {
      const rawSummary = await tauriInvoke<Record<string, unknown>>('get_shift_summary', {
        shiftId: activeShift.id,
        shift_id: activeShift.id,
      });
      setXReportSummary(normalizeShiftSummary(rawSummary));
    } catch (err) {
      showToast('error', `Vardiya özeti alınamadı: ${String(err)}`);
    } finally {
      setXReportLoading(false);
    }
  };

  // X-Raporunu fiş olarak yazdırır
  const handlePrintXReport = async () => {
    if (!activeShift || !xReportSummary) return;
    try {
      await tauriInvoke('print_z_report', {
        shiftId: activeShift.id,
        actorRole: cashierRole,
        tenantId: user?.tenantId,
      });
      showToast('success', 'X-Raporu yazıcıya gönderildi.');
    } catch (err) {
      showToast('error', `Yazdırma hatası: ${String(err)}`);
    }
  };

  // Kasa nakit giriş ve çıkışını işler
  const handleCashMovementSubmit = async () => {
    if (!activeShift) return;
    const amountCents = Math.round((parseFloat(cashAmount) || 0) * 100);
    if (amountCents <= 0) {
      showToast('error', 'Lütfen geçerli bir tutar girin.');
      return;
    }
    if (!cashReason.trim()) {
      showToast('error', 'Lütfen açıklama gerekçesi girin.');
      return;
    }

    try {
      const args = {
        shiftId: activeShift.id,
        shift_id: activeShift.id,
        amountCents,
        amount_cents: amountCents,
        reason: cashReason.trim(),
        actorId: cashierId,
        actor_id: cashierId,
      };

      // Kasa fişi kayıtlı hareketten basılır: ekranda yazan tutar değil,
      // veritabanındaki hareket satırı esas alınır.
      const movement = await tauriInvoke<{ id?: string }>(
        showCashModal === 'IN' ? 'cash_in' : 'cash_out',
        args,
      );

      if (movement?.id) {
        await tauriInvoke('print_cash_slip', {
          movementId: movement.id,
          actorRole: cashierRole,
          tenantId: user?.tenantId,
        }).catch(console.error);
      }

      setShowCashModal(null);
      setCashAmount('');
      setCashReason('');
      showToast('success', `Kasa ${showCashModal === 'IN' ? 'girişi' : 'çıkışı'} kaydedildi.`);
    } catch (err: unknown) {
      showToast('error', `Kasa Hareketi Hatası: ${String(err)}`);
    }
  };

  // Hesap iptali (Void) işlemini yönetici onayıyla tamamlar.
  //
  // Akış iki adımlıdır: önce gerekçe toplanır, sonra `InstantPinApprovalModal`
  // açılır ve tek kullanımlık jeton üretilir. PIN bu bileşende hiçbir zaman
  // tutulmaz; jeton doğrudan `void_order` çağrısına verilir.
  const handleVoidSubmit = async () => {
    if (!selectedTableId) return;
    if (!voidReason.trim()) {
      showToast('error', 'Lütfen iptal gerekçesini belirtin.');
      return;
    }
    setShowApprovalModal(true);
  };

  // Onay penceresinden dönen tek kullanımlık jetonla iptali yürüt.
  const handleVoidApproved = async (approvalToken: string) => {
    if (!selectedTableId) return;
    try {
      const payload = {
        orderId: selectedTableId,
        tableId: selectedTableId,
        reason: voidReason.trim(),
        actorId: cashierId,
        actorRole: cashierRole,
        approvalToken,
      };

      await tauriInvoke('void_order', {
        payload,
        tenantId: user?.tenantId || 'DEFAULT_TENANT',
        tenant_id: user?.tenantId || 'DEFAULT_TENANT',
      });

      await tauriInvoke('print_void_slip', {
        tableId: selectedTableId,
        actorRole: cashierRole,
        tenantId: user?.tenantId,
      }).catch(console.error);

      setShowApprovalModal(false);
      setShowVoidModal(false);
      setVoidReason('');
      setSelectedTableId(null);
      setTableItems([]);
      useCartStore.getState().clearCart();
      await fetchFloorPlan();
      showToast('success', 'Hesap başarıyla iptal edildi.');
    } catch (err: unknown) {
      // Jeton tek kullanımlıktır: iptal geçerse onay yeniden istenir.
      setShowApprovalModal(false);
      setShowVoidModal(false);
      setVoidReason('');
      showToast('error', `İptal hatası: ${String(err)}`);
    }
  };

  // Tuş takımı basım kontrolü
  const handleNumpadPress = (value: string) => {
    if (value === 'C') {
      setTenderedAmount('');
      return;
    }

    if (value === 'BACKSPACE') {
      setTenderedAmount((prev) => prev.slice(0, -1));
      return;
    }

    if (value.startsWith('PRESET_')) {
      const amount = value.replace('PRESET_', '');
      setTenderedAmount(amount);
      return;
    }

    if (value === '00') {
      setTenderedAmount((prev) => {
        if (!prev || prev === '0') return '0';
        if (prev.includes('.')) {
          const [, decimal] = prev.split('.');
          if (decimal && decimal.length >= 2) return prev;
          if (decimal && decimal.length === 1) return prev + '0';
        }
        return prev + '00';
      });
      return;
    }

    if (value === '.') {
      if (!tenderedAmount.includes('.')) {
        setTenderedAmount((prev) => (prev ? prev + '.' : '0.'));
      }
      return;
    }

    setTenderedAmount((prev) => {
      if (prev === '0' && value !== '.') {
        return value;
      }
      if (prev.includes('.')) {
        const [, decimal] = prev.split('.');
        if (decimal && decimal.length >= 2) return prev;
      }
      return prev + value;
    });
  };

  // Nakit veya Kart tahsilatını backend ödeme servisine gönderir
  const handleSubmitPayment = async (method: PaymentMethod) => {
    if (!selectedTableId || grandTotalCents <= 0 || isSubmittingPayment) return;

    const isCreditCard = method === 'CREDIT_CARD';
    // Kredi kartında tahsilat adisyon tutarı kadardır; nakitte girilen tutar veya tam tutar kullanılır
    const finalAmountCents = isCreditCard ? grandTotalCents : (tenderedCents === 0 ? grandTotalCents : tenderedCents);
    const changeAmountCents = isCreditCard ? 0 : Math.max(0, finalAmountCents - grandTotalCents);

    if (!isCreditCard && finalAmountCents < grandTotalCents && method !== 'SPLIT') {
      showToast('error', 'Alınan nakit tutar toplam tutardan az olamaz.');
      return;
    }

    setIsSubmittingPayment(true);
    const txnId = `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const payload = {
      transactionId: txnId,
      transaction_id: txnId,
      orderId: `ORD_${Date.now().toString().slice(-6)}`,
      order_id: `ORD_${Date.now().toString().slice(-6)}`,
      timestamp: new Date().toISOString(),
      method,
      amountTendered: finalAmountCents,
      amount_tendered: finalAmountCents,
      totalAmount: grandTotalCents,
      total_amount: grandTotalCents,
      changeAmount: changeAmountCents,
      change_amount: changeAmountCents,
      items: tableItems.map((it) => ({
        id: it.id,
        product: it.product,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        taxRate: it.taxRate,
        subtotal: it.subtotal,
        taxAmount: it.taxAmount,
        total: it.total,
        modifiers: it.modifiers ?? null,
      })),
      notes: '',
      customerRef: selectedTableId,
      customer_ref: selectedTableId,
      cashierId: cashierId,
      cashier_id: cashierId,
      terminalId: 'CASHIER_WS_01',
      terminal_id: 'CASHIER_WS_01',
    };

    try {
      const res = await tauriInvoke<{ success: boolean; transactionId?: string }>('process_payment', {
        payload,
        actorRole: user?.role ?? 'WAITER',
      });

      const paidItems = [...tableItems];
      const tableName = selectedTable?.name || selectedTableId;
      const transactionId = res?.transactionId || txnId;

      // Fiş içeriği tahsilat kaydından okunur; burada yalnız kimlik gönderilir.
      await tauriInvoke('print_receipt', {
        receiptId: transactionId,
        actorRole: cashierRole,
        tenantId: user?.tenantId,
      }).catch((err) => {
        console.warn('Fiş yazdırma uyarısı:', err);
      });

      setPaymentSuccess({
        method,
        transactionId,
        totalCents: grandTotalCents,
        tenderedCents: finalAmountCents,
        changeCents: changeAmountCents,
        tableName,
        items: paidItems,
      });

      setSelectedTableId(null);
      setTableItems([]);
      setTenderedAmount('');
      useCartStore.getState().clearCart();

      await fetchFloorPlan();
      showToast('success', `${tableName} hesabı tahsil edildi.`);
    } catch (err: unknown) {
      console.error('Payment error', err);
      showToast('error', `Ödeme hatası: ${String(err)}`);
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  // Müşteriye adisyon ara fişi basar
  const handlePrintBill = async () => {
    if (!selectedTableId || grandTotalCents <= 0) return;
    try {
      // Adisyon fişi tahsilat değildir; içerik masanın açık siparişinden okunur.
      const orderId = await tauriInvoke<string | null>('get_active_order_id', {
        tableId: selectedTableId,
        tenantId: user?.tenantId,
      });
      if (!orderId) {
        showToast('error', 'Bu masa için açık sipariş bulunamadı.');
        return;
      }
      await tauriInvoke('print_order_slip', {
        orderId,
        actorRole: cashierRole,
        tenantId: user?.tenantId,
      });
      showToast('success', 'Adisyon bilgi fişi yazıcıya iletildi.');
    } catch (err) {
      showToast('error', `Yazdırma hatası: ${String(err)}`);
    }
  };

  // Son ödemeye ait tahsilat fişini tekrar yazdırır
  const handleReprintReceipt = async () => {
    if (!paymentSuccess) return;
    try {
      await tauriInvoke('print_receipt', {
        receiptId: paymentSuccess.transactionId,
        actorRole: cashierRole,
        tenantId: user?.tenantId,
      });
      showToast('success', 'Fiş tekrar yazıcıya iletildi.');
    } catch (err) {
      showToast('error', `Yazdırma hatası: ${String(err)}`);
    }
  };

  const fmtDate = (iso?: string | null) => {
    if (!iso) return '—';
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

  return (
    // Ana kapsayıcı: #060609 zemin, renksiz şeffaf cam ve açık/koyu tema desteği
    <div className="flex h-full w-full overflow-hidden dark:bg-[#060609] bg-[#f5f5f7] dark:text-white text-zinc-900 relative flex-col select-none font-sans">

      {/* Apple tarzı bildirim göstergesi (renksiz şeffaf cam) */}
      {toast && (
        <div className="absolute top-4 right-4 z-[100] max-w-md animate-in fade-in slide-in-from-top-2">
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl border text-sm font-medium backdrop-blur-2xl dark:bg-white/[0.06] bg-white/90 ${
              toast.type === 'success'
                ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                : toast.type === 'error'
                ? 'border-rose-500/40 text-rose-600 dark:text-rose-400'
                : 'border-blue-500/40 text-blue-600 dark:text-blue-400'
            }`}
          >
            {toast.type === 'success' && <Check size={18} className="shrink-0" />}
            {toast.type === 'error' && <AlertCircle size={18} className="shrink-0" />}
            {toast.type === 'info' && <Info size={18} className="shrink-0" />}
            <span className="dark:text-white text-zinc-900">{toast.message}</span>
          </div>
        </div>
      )}

      {/* Üst Bar ve Sekme Yönetimi: Renksiz frosted glass */}
      <div className="flex items-center justify-between border-b dark:border-white/10 border-black/[0.08] backdrop-blur-xl dark:bg-white/[0.03] bg-white/70 shadow-xl shrink-0 px-6 py-3">
        {/* Apple Segmented Control stili sekmeler */}
        <div className="inline-flex p-1 dark:bg-black/30 bg-black/[0.04] border dark:border-white/10 border-black/[0.08] rounded-2xl">
          <button
            onClick={() => setActiveTab('KASA')}
            className={`flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
              activeTab === 'KASA'
                ? 'dark:bg-white/[0.12] bg-white text-zinc-900 dark:text-white shadow-sm ring-1 dark:ring-white/10 ring-black/[0.06]'
                : 'dark:text-white/60 text-zinc-500 hover:dark:text-white hover:text-zinc-900'
            }`}
          >
            <Receipt size={14} />
            <span>Kasiyer İstasyonu</span>
          </button>
          <button
            onClick={() => setActiveTab('GECMIS')}
            className={`flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
              activeTab === 'GECMIS'
                ? 'dark:bg-white/[0.12] bg-white text-zinc-900 dark:text-white shadow-sm ring-1 dark:ring-white/10 ring-black/[0.06]'
                : 'dark:text-white/60 text-zinc-500 hover:dark:text-white hover:text-zinc-900'
            }`}
          >
            <History size={14} />
            <span>Vardiya Geçmişi</span>
          </button>
        </div>

        {/* Vardiya durum bilgisi ve hızlı aksiyon butonları */}
        <div className="flex items-center gap-2.5">
          {shiftLoading ? (
            <div className="flex items-center gap-2 px-3.5 py-1.5 dark:bg-white/[0.04] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-full text-xs dark:text-white/50 text-zinc-500">
              <RefreshCcw size={12} className="animate-spin text-[#007AFF]" />
              <span>Vardiya kontrol ediliyor...</span>
            </div>
          ) : isShiftOpen && activeShift ? (
            <>
              <div className="flex items-center gap-2 px-3.5 py-1.5 dark:bg-white/[0.04] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl text-xs shadow-inner">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="dark:text-white text-zinc-900 font-medium">Vardiya Açık</span>
                <span className="dark:text-white/20 text-zinc-300">|</span>
                <span className="dark:text-white/70 text-zinc-600">
                  Açılış: <MoneyDisplay amountInCents={activeShift.expectedAmountCents} className="dark:text-white text-zinc-900 font-medium" />
                </span>
              </div>

              <AppleButton
                variant="glass"
                size="sm"
                onClick={handleOpenXReport}
                icon={<FileText size={14} />}
                className="rounded-2xl h-8 text-xs font-semibold"
              >
                X-Raporu
              </AppleButton>

              <AppleButton
                variant="glass"
                size="sm"
                onClick={() => setShowCashModal('IN')}
                icon={<Banknote size={14} className="dark:text-white text-zinc-900" />}
                className="rounded-2xl h-8 dark:text-white text-zinc-900 border dark:border-white/10 border-black/[0.08] text-xs font-semibold"
              >
                Kasa Girişi
              </AppleButton>

              <AppleButton
                variant="glass"
                size="sm"
                onClick={() => setShowCashModal('OUT')}
                icon={<Banknote size={14} className="dark:text-white text-zinc-900" />}
                className="rounded-2xl h-8 dark:text-white text-zinc-900 border dark:border-white/10 border-black/[0.08] text-xs font-semibold"
              >
                Kasa Çıkışı
              </AppleButton>

              <AppleButton
                variant="glass"
                size="sm"
                onClick={handleOpenCloseShiftModal}
                icon={<Lock size={14} className="dark:text-white text-zinc-900" />}
                className="rounded-2xl h-8 dark:text-white text-zinc-900 border dark:border-white/10 border-black/[0.08] text-xs font-semibold"
              >
                Vardiyayı Kapat
              </AppleButton>
            </>
          ) : (
            <AppleButton
              variant="primary"
              size="sm"
              onClick={() => {
                setShiftAmount('');
                setShowShiftModal('OPEN');
              }}
              icon={<Unlock size={14} />}
              className="rounded-2xl h-8 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 dark:text-white text-zinc-900 text-xs font-semibold"
            >
              Vardiyayı Aç
            </AppleButton>
          )}
        </div>
      </div>

      {/* Ana İçerik Alanı: Bağımsız yüzen cam adalar ve aralıklar */}
      <div className="flex-1 overflow-hidden flex p-3.5 gap-3.5">

        {/* ==================== KASA SEKMESİ ==================== */}
        {activeTab === 'KASA' && (
          <>
            {/* Vardiya Açma / Kapatma Modalı: Renksiz şeffaf cam */}
            {showShiftModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
                <div className="backdrop-blur-2xl dark:bg-white/[0.05] bg-white/80 border dark:border-white/10 border-black/[0.08] p-7 md:p-8 rounded-3xl shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-150">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center dark:bg-white/[0.06] bg-black/[0.04] border dark:border-white/10 border-black/[0.08]">
                      {showShiftModal === 'OPEN' ? (
                        <Unlock size={24} className="dark:text-white text-zinc-900" />
                      ) : (
                        <Lock size={24} className="dark:text-white text-zinc-900" />
                      )}
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight dark:text-white text-zinc-900">
                        Vardiya {showShiftModal === 'OPEN' ? 'Açılışı' : 'Kapanışı'}
                      </h2>
                      <p className="text-xs dark:text-white/50 text-zinc-500 mt-0.5">
                        {showShiftModal === 'OPEN' ? 'Kasa başlangıç nakit mevcudunu girin' : 'Fiili kasa sayımını tamamlayın'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 mb-7">
                    {showShiftModal === 'CLOSE' && shiftSummary && (
                      <div className="dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/[0.08] border-black/[0.06] p-5 rounded-2xl space-y-2.5 text-sm">
                        <div className="flex justify-between dark:text-white/70 text-zinc-600">
                          <span>Açılış Kasası</span>
                          <MoneyDisplay amountInCents={activeShift?.expectedAmountCents || 0} className="dark:text-white text-zinc-900 font-mono" />
                        </div>
                        <div className="flex justify-between dark:text-white/70 text-zinc-600">
                          <span>Toplam Satış</span>
                          <MoneyDisplay amountInCents={shiftSummary.totalSales} className="dark:text-white text-zinc-900 font-mono" />
                        </div>
                        <div className="flex justify-between dark:text-white/80 text-zinc-700">
                          <span>Nakit Girişleri (+)</span>
                          <MoneyDisplay amountInCents={shiftSummary.totalCashIn} className="font-mono dark:text-white text-zinc-900" />
                        </div>
                        <div className="flex justify-between dark:text-white/80 text-zinc-700">
                          <span>Nakit Çıkışları (-)</span>
                          <MoneyDisplay amountInCents={shiftSummary.totalCashOut} className="font-mono dark:text-white text-zinc-900" />
                        </div>
                        <div className="flex justify-between dark:text-white text-zinc-900 font-semibold pt-2.5 border-t dark:border-white/[0.08] border-black/[0.06]">
                          <span>Beklenen Kasa Bakiyesi</span>
                          <MoneyDisplay amountInCents={shiftSummary.expectedBalance} className="dark:text-white text-zinc-900 font-bold text-lg font-mono" />
                        </div>

                        {/* Canlı mutabakat farkı */}
                        {shiftAmount && (
                          <div className="flex justify-between font-semibold pt-2.5 border-t dark:border-white/[0.08] border-black/[0.06]">
                            <span className="dark:text-white/80 text-zinc-700">Kasa Farkı</span>
                            {(() => {
                              const enteredCents = Math.round((parseFloat(shiftAmount) || 0) * 100);
                              const diff = enteredCents - shiftSummary.expectedBalance;
                              return (
                                <span className={diff < 0 ? 'text-rose-500 dark:text-rose-400 font-mono' : diff > 0 ? 'dark:text-white text-zinc-900 font-mono' : 'dark:text-white/60 text-zinc-500 font-mono'}>
                                  {diff > 0 ? '+' : ''}
                                  <MoneyDisplay amountInCents={diff} />
                                  {diff === 0 ? ' (Denk)' : diff > 0 ? ' (Fazla)' : ' (Eksik)'}
                                </span>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}

                    <div>
                      <label className="block text-xs uppercase tracking-wider dark:text-white/50 text-zinc-500 font-medium mb-2">
                        {showShiftModal === 'OPEN'
                          ? 'Başlangıç Nakit Tutarı (₺)'
                          : 'Sayılan Fiili Nakit Tutar (₺)'}
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.01"
                          autoFocus
                          value={shiftAmount}
                          onChange={(e) => setShiftAmount(e.target.value)}
                          className="w-full p-4 dark:bg-white/[0.04] bg-white border dark:border-white/10 border-black/[0.08] rounded-2xl text-3xl font-semibold font-mono dark:text-white text-zinc-900 outline-none focus:dark:border-white/30 focus:border-black/20 focus:dark:bg-white/[0.06] pr-12 transition-all shadow-inner"
                          placeholder="0.00"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 dark:text-white/40 text-zinc-400 text-xl font-medium">
                          ₺
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <AppleButton
                      variant="secondary"
                      onClick={() => setShowShiftModal(null)}
                      className="flex-1 rounded-2xl h-12"
                    >
                      {showShiftModal === 'CLOSE' ? 'İptal' : 'Vazgeç'}
                    </AppleButton>
                    <AppleButton
                      variant="primary"
                      onClick={handleShiftSubmit}
                      className="flex-1 rounded-2xl h-12 text-white bg-[#007AFF] hover:bg-[#0071eb] border-transparent font-semibold shadow-md shadow-[#007AFF]/25"
                    >
                      {showShiftModal === 'OPEN' ? 'Vardiyayı Başlat' : 'Kapat & Z-Raporu Al'}
                    </AppleButton>
                  </div>
                </div>
              </div>
            )}

            {/* X-Raporu Modalı: Renksiz şeffaf cam */}
            {showXReportModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
                <div className="backdrop-blur-2xl dark:bg-white/[0.05] bg-white/80 border dark:border-white/10 border-black/[0.08] p-7 md:p-8 rounded-3xl shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-150">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center dark:bg-white/[0.06] bg-black/[0.04] border dark:border-white/10 border-black/[0.08]">
                      <FileText size={24} className="dark:text-white text-zinc-900" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight dark:text-white text-zinc-900">X-Raporu</h2>
                      <p className="text-xs dark:text-white/50 text-zinc-500 mt-0.5">Gün içi ara kasa durumu ve ciro mutabakatı</p>
                    </div>
                  </div>

                  {xReportLoading ? (
                    <div className="py-12 flex justify-center dark:text-white/40 text-zinc-400">
                      <RefreshCcw size={24} className="animate-spin dark:text-white text-zinc-900" />
                    </div>
                  ) : xReportSummary ? (
                    <div className="space-y-4 mb-6">
                      <div className="dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/[0.08] border-black/[0.06] p-5 rounded-2xl space-y-2.5 text-sm">
                        <div className="flex justify-between dark:text-white/50 text-zinc-500 text-xs">
                          <span>Açılış Zamanı</span>
                          <span className="font-mono dark:text-white/80 text-zinc-700">{fmtDate(activeShift?.openedAt)}</span>
                        </div>
                        <div className="flex justify-between dark:text-white/50 text-zinc-500 text-xs">
                          <span>Rapor Saati</span>
                          <span className="font-mono dark:text-white/80 text-zinc-700">{new Date().toLocaleTimeString('tr-TR')}</span>
                        </div>
                        <div className="flex justify-between dark:text-white/70 text-zinc-600 pt-2 border-t dark:border-white/[0.08] border-black/[0.06]">
                          <span>Açılış Bakiyesi</span>
                          <MoneyDisplay amountInCents={activeShift?.expectedAmountCents || 0} className="dark:text-white text-zinc-900 font-mono" />
                        </div>
                        <div className="flex justify-between dark:text-white/80 text-zinc-700">
                          <span>Toplam Satış Hasılatı</span>
                          <MoneyDisplay amountInCents={xReportSummary.totalSales} className="font-mono dark:text-white text-zinc-900 font-medium" />
                        </div>
                        <div className="flex justify-between dark:text-white/80 text-zinc-700">
                          <span>Nakit Girişleri</span>
                          <MoneyDisplay amountInCents={xReportSummary.totalCashIn} className="font-mono dark:text-white text-zinc-900 font-medium" />
                        </div>
                        <div className="flex justify-between dark:text-white/80 text-zinc-700">
                          <span>Nakit Çıkışları</span>
                          <MoneyDisplay amountInCents={xReportSummary.totalCashOut} className="font-mono dark:text-white text-zinc-900 font-medium" />
                        </div>
                        <div className="flex justify-between dark:text-white text-zinc-900 font-semibold pt-2.5 border-t dark:border-white/[0.08] border-black/[0.06] text-base">
                          <span>Kasadaki Beklenen Tutar</span>
                          <MoneyDisplay amountInCents={xReportSummary.expectedBalance} className="dark:text-white text-zinc-900 font-bold text-xl font-mono" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-rose-500 dark:text-rose-400 text-sm py-4">Özet verisi alınamadı.</p>
                  )}

                  <div className="flex gap-3">
                    <AppleButton
                      variant="secondary"
                      onClick={() => setShowXReportModal(false)}
                      className="flex-1 rounded-2xl h-12"
                    >
                      Kapat
                    </AppleButton>
                    <AppleButton
                      variant="primary"
                      onClick={handlePrintXReport}
                      disabled={!xReportSummary}
                      icon={<Printer size={16} />}
                      className="flex-1 rounded-2xl h-12 text-white bg-[#007AFF] hover:bg-[#0071eb] border-transparent font-semibold shadow-md shadow-[#007AFF]/25"
                    >
                      Yazdır
                    </AppleButton>
                  </div>
                </div>
              </div>
            )}

            {/* Kasa Nakit Giriş / Çıkış Modalı: Renksiz şeffaf cam */}
            {showCashModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
                <div className="backdrop-blur-2xl dark:bg-white/[0.05] bg-white/80 border dark:border-white/10 border-black/[0.08] p-7 md:p-8 rounded-3xl shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-150">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center dark:bg-white/[0.06] bg-black/[0.04] border dark:border-white/10 border-black/[0.08]">
                      <Banknote
                        size={24}
                        className="dark:text-white text-zinc-900"
                      />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight dark:text-white text-zinc-900">
                        Kasa {showCashModal === 'IN' ? 'Giriş İşlemi' : 'Çıkış İşlemi'}
                      </h2>
                      <p className="text-xs dark:text-white/50 text-zinc-500 mt-0.5">
                        {showCashModal === 'IN' ? 'Kasaya nakit ilavesi yapın' : 'Kasadan nakit çıkışı yapın'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 mb-7">
                    <div>
                      <label className="block text-xs uppercase tracking-wider dark:text-white/50 text-zinc-500 font-medium mb-2">Tutar (₺)</label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.01"
                          autoFocus
                          value={cashAmount}
                          onChange={(e) => setCashAmount(e.target.value)}
                          className="w-full p-4 dark:bg-white/[0.04] bg-white border dark:border-white/10 border-black/[0.08] rounded-2xl text-3xl font-semibold font-mono dark:text-white text-zinc-900 outline-none focus:dark:border-white/30 focus:border-black/20 pr-12 transition-all shadow-inner"
                          placeholder="0.00"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 dark:text-white/40 text-zinc-400 text-xl font-medium">
                          ₺
                        </span>
                      </div>
                    </div>

                    {/* Hızlı banknot butonları (renksiz buzlu cam) */}
                    <div className="grid grid-cols-4 gap-2">
                      {PRESET_AMOUNTS.map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setCashAmount(amt.toString())}
                          className="py-2.5 dark:bg-white/[0.04] bg-white/70 hover:dark:bg-white/[0.08] hover:bg-black/[0.04] border dark:border-white/10 border-black/[0.08] rounded-2xl text-xs font-semibold dark:text-white text-zinc-900 transition-all active:scale-95 cursor-pointer"
                        >
                          {`${amt} ₺`}
                        </button>
                      ))}
                    </div>

                    <div>
                      <label className="block text-xs uppercase tracking-wider dark:text-white/50 text-zinc-500 font-medium mb-2">Açıklama</label>
                      <input
                        type="text"
                        value={cashReason}
                        onChange={(e) => setCashReason(e.target.value)}
                        className="w-full p-3.5 dark:bg-white/[0.04] bg-white border dark:border-white/10 border-black/[0.08] rounded-2xl dark:text-white text-zinc-900 outline-none focus:dark:border-white/30 focus:border-black/20 text-sm dark:placeholder-white/30 placeholder-zinc-400 transition-all shadow-inner"
                        placeholder={showCashModal === 'IN' ? 'Giriş gerekçesi... (Örn: Bozuk para, Avans)' : 'Çıkış gerekçesi... (Örn: Masraf, Avans)'}
                      />
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <AppleButton
                      variant="secondary"
                      onClick={() => {
                        setShowCashModal(null);
                        setCashAmount('');
                        setCashReason('');
                      }}
                      className="flex-1 rounded-2xl h-12"
                    >
                      İptal
                    </AppleButton>
                    <AppleButton
                      variant="primary"
                      onClick={handleCashMovementSubmit}
                      disabled={!cashAmount || parseFloat(cashAmount) <= 0 || !cashReason.trim()}
                      className="flex-1 rounded-2xl h-12 text-white bg-[#007AFF] hover:bg-[#0071eb] border-transparent font-semibold shadow-md shadow-[#007AFF]/25"
                    >
                      {showCashModal === 'IN' ? 'Girişi Kaydet' : 'Çıkışı Kaydet'}
                    </AppleButton>
                  </div>
                </div>
              </div>
            )}

            {/* Hesap İptal (Void) Modalı: Renksiz şeffaf cam */}
            {showVoidModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
                <div className="backdrop-blur-2xl dark:bg-white/[0.05] bg-white/80 border dark:border-white/10 border-black/[0.08] p-7 md:p-8 rounded-3xl shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-150">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center dark:bg-white/[0.06] bg-black/[0.04] border dark:border-white/10 border-black/[0.08]">
                      <XCircle size={24} className="dark:text-white text-zinc-900" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight dark:text-white text-zinc-900">Hesap İptali</h2>
                      <p className="text-xs dark:text-white/50 text-zinc-500 mt-0.5">Adisyon iptali yönetici onayı gerektirir</p>
                    </div>
                  </div>

                  <div className="space-y-4 mb-7">
                    <div>
                      <label className="block text-xs uppercase tracking-wider dark:text-white/50 text-zinc-500 font-medium mb-2">İptal Nedeni</label>
                      <input
                        type="text"
                        autoFocus
                        value={voidReason}
                        onChange={(e) => setVoidReason(e.target.value)}
                        className="w-full p-3.5 dark:bg-white/[0.04] bg-white border dark:border-white/10 border-black/[0.08] rounded-2xl dark:text-white text-zinc-900 outline-none focus:dark:border-white/30 focus:border-black/20 text-sm dark:placeholder-white/30 placeholder-zinc-400 transition-all shadow-inner"
                        placeholder="Örn: Yanlış masa siparişi..."
                      />
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <AppleButton
                      variant="secondary"
                      onClick={() => {
                        setShowVoidModal(false);
                        setVoidReason('');
                      }}
                      className="flex-1 rounded-2xl h-12"
                    >
                      Vazgeç
                    </AppleButton>
                    <AppleButton
                      variant="danger"
                      onClick={handleVoidSubmit}
                      disabled={!voidReason.trim()}
                      className="flex-1 rounded-2xl h-12"
                    >
                      Onaya Gönder
                    </AppleButton>
                  </div>
                </div>
              </div>
            )}

            {/* Anlık PIN onay penceresi: iptal ve indirim tek ortak yüzey. */}
            <InstantPinApprovalModal
              open={showApprovalModal}
              request={{
                operation: APPROVAL_OPERATIONS.VOID,
                resourceId: selectedTableId ?? '',
                actorId: cashierId,
                actorRole: cashierRole,
                amountCents: grandTotalCents,
                tenantId: user?.tenantId,
              }}
              formatCents={(cents) =>
                `${(cents / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`
              }
              onApproved={handleVoidApproved}
              onCancel={() => setShowApprovalModal(false)}
            />

            {/* ========================================================= */}
            {/* SOL KOLON: AÇIK HESAPLAR LİSTESİ (BAĞIMSIZ YÜZEN CAM ADA) */}
            {/* ========================================================= */}
            <div className="w-80 shrink-0 backdrop-blur-2xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.4)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] rounded-3xl flex flex-col h-full overflow-hidden">
              {/* Başlık ve Masa Yenileme */}
              <div className="p-4 border-b dark:border-white/10 border-black/[0.08] flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-bold tracking-tight dark:text-white text-zinc-900">Açık Hesaplar</h2>
                  <span className="px-2.5 py-0.5 rounded-full dark:bg-white/[0.08] bg-black/[0.05] dark:text-white/80 text-zinc-700 text-xs font-mono font-medium">
                    {occupiedTables.length}
                  </span>
                </div>
                <button
                  onClick={() => fetchFloorPlan()}
                  className="p-2 dark:bg-white/[0.04] bg-black/[0.03] hover:dark:bg-white/[0.08] hover:bg-black/[0.06] border dark:border-white/10 border-black/[0.08] rounded-2xl dark:text-white/70 text-zinc-600 hover:dark:text-white hover:text-zinc-900 transition-all active:scale-95 cursor-pointer"
                  title="Masaları Yenile"
                >
                  <RefreshCcw size={15} />
                </button>
              </div>

              {/* Masa Arama Çubuğu */}
              <div className="px-3.5 py-2.5 shrink-0 border-b dark:border-white/10 border-black/[0.08]">
                <div className="relative">
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 dark:text-white/30 text-zinc-400 pointer-events-none" />
                  <input
                    type="text"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    placeholder="Masa ara..."
                    className="w-full pl-9 pr-8 py-2.5 dark:bg-white/[0.04] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl text-sm dark:text-white text-zinc-900 dark:placeholder-white/30 placeholder-zinc-400 outline-none focus:dark:border-white/30 focus:border-black/20 focus:ring-1 focus:ring-white/10 transition-all"
                  />
                  {tableSearch && (
                    <button
                      type="button"
                      onClick={() => setTableSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 dark:text-white/40 text-zinc-400 hover:dark:text-white hover:text-zinc-800 transition-colors cursor-pointer"
                      title="Aramayı Temizle"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Masa Listesi */}
              <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
                {filteredTables.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full dark:text-white/40 text-zinc-400 py-12">
                    <CheckCircle2 size={40} className="mb-2.5 opacity-20" />
                    <p className="text-xs font-medium">{tableSearch ? 'Eşleşen masa yok.' : 'Açık hesap bulunmuyor.'}</p>
                  </div>
                ) : (
                  filteredTables.map((t) => {
                    const isSelected = selectedTableId === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => handleSelectTable(t.id)}
                        className={`w-full text-left p-3.5 rounded-2xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'backdrop-blur-xl dark:bg-white/[0.10] bg-black/[0.06] border dark:border-white/25 border-black/20 ring-1 ring-white/10 shadow-lg'
                            : 'backdrop-blur-md dark:bg-white/[0.03] bg-black/[0.02] dark:border-white/[0.08] border-black/[0.06] hover:dark:bg-white/[0.06] hover:bg-black/[0.04] hover:dark:border-white/15 hover:border-black/10'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-1.5">
                          <div className="flex items-center gap-2">
                            <MapPin size={15} className={isSelected ? 'dark:text-white text-zinc-900' : 'dark:text-white/40 text-zinc-400'} />
                            <span className="font-semibold text-sm dark:text-white text-zinc-900">{t.name}</span>
                          </div>
                          <MoneyDisplay
                            amountInCents={t.currentTotal || 0}
                            className="dark:text-white text-zinc-900 font-mono font-semibold text-sm"
                          />
                        </div>
                        <div className="flex justify-between items-center text-[11px] dark:text-white/40 text-zinc-500">
                          <div className="flex items-center gap-1">
                            <Clock size={11} />
                            <span>
                              {t.openedAt
                                ? new Date(t.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : 'Açık'}
                            </span>
                          </div>
                          <span className="px-2 py-0.5 rounded-xl dark:bg-white/[0.05] bg-black/[0.04] dark:text-white/60 text-zinc-600">{t.waiterId || 'Kasa'}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* ========================================================= */}
            {/* ORTA KOLON: SEÇİLİ MASANIN ADİSYON ÖZETİ (YÜZEN CAM ADA)  */}
            {/* ========================================================= */}
            <div className="w-96 shrink-0 backdrop-blur-2xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.4)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] rounded-3xl flex flex-col h-full overflow-hidden">
              {/* Masa Başlığı & Kalem Sayacı */}
              <div className="p-4 border-b dark:border-white/10 border-black/[0.08] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-bold tracking-tight dark:text-white text-zinc-900">
                    {selectedTable ? `${selectedTable.name} Adisyonu` : 'Hesap Detayı'}
                  </h2>
                  {selectedTableId && (
                    <span className="px-2.5 py-0.5 rounded-full dark:bg-white/[0.08] bg-black/[0.05] dark:text-white/80 text-zinc-700 text-xs font-mono font-medium">
                      {tableItems.length} kalem
                    </span>
                  )}
                </div>
                <Receipt size={18} className="dark:text-white/40 text-zinc-400" />
              </div>

              {/* Sipariş Kalemleri Listesi */}
              <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
                {!selectedTableId ? (
                  <div className="flex flex-col items-center justify-center h-full dark:text-white/40 text-zinc-400 py-12 px-6 text-center">
                    <Receipt size={48} className="mb-3 opacity-20" />
                    <p className="text-sm font-medium dark:text-white/60 text-zinc-600">Masa Seçilmedi</p>
                    <p className="text-xs dark:text-white/40 text-zinc-400 mt-1">Tahsilat yapmak veya adisyonu görüntülemek için sol taraftan bir masa seçin.</p>
                  </div>
                ) : isLoadingItems ? (
                  <div className="flex flex-col items-center justify-center h-full dark:text-white/40 text-zinc-400 py-12">
                    <RefreshCcw size={24} className="animate-spin mb-2.5 dark:text-white text-zinc-900" />
                    <p className="text-xs">Sipariş yükleniyor...</p>
                  </div>
                ) : tableItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full dark:text-white/40 text-zinc-400 py-12">
                    <p className="text-xs">Masada kayıtlı ürün bulunmuyor.</p>
                  </div>
                ) : (
                  tableItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex justify-between items-center dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/[0.07] border-black/[0.05] p-3.5 rounded-2xl hover:dark:bg-white/[0.06] hover:bg-black/[0.04] transition-all"
                    >
                      <div className="pr-3">
                        <div className="font-semibold text-sm dark:text-white text-zinc-900">{item.product.name}</div>
                        <div className="text-xs dark:text-white/50 text-zinc-500 mt-0.5 font-mono">
                          {item.quantity} adet × <MoneyDisplay amountInCents={item.unitPrice} />
                        </div>
                        {item.note && (
                          <div className="text-[11px] text-zinc-500 dark:text-white/40 italic mt-0.5">
                            Not: {item.note}
                          </div>
                        )}
                      </div>
                      <MoneyDisplay
                        amountInCents={item.total}
                        className="font-mono font-semibold text-sm dark:text-white text-zinc-900 shrink-0"
                      />
                    </div>
                  ))
                )}
              </div>

              {/* Alt Özet ve Hızlı İşlem Butonları */}
              {selectedTableId && tableItems.length > 0 && (
                <div className="p-4 backdrop-blur-xl dark:bg-white/[0.02] bg-black/[0.02] border-t dark:border-white/10 border-black/[0.08] space-y-3 shrink-0">
                  <div className="space-y-1.5 text-xs dark:text-white/60 text-zinc-500 font-medium">
                    <div className="flex justify-between">
                      <span>Ara Toplam</span>
                      <MoneyDisplay amountInCents={tableTotals.subtotal} className="font-mono dark:text-white/80 text-zinc-700" />
                    </div>
                    <div className="flex justify-between">
                      <span>KDV Tutarı</span>
                      <MoneyDisplay amountInCents={tableTotals.taxTotal} className="font-mono dark:text-white/80 text-zinc-700" />
                    </div>
                  </div>

                  <div className="flex justify-between items-baseline pt-2 border-t dark:border-white/10 border-black/[0.08]">
                    <span className="text-xs uppercase tracking-wider dark:text-white/50 text-zinc-500 font-bold">Toplam Tutar</span>
                    <MoneyDisplay
                      amountInCents={grandTotalCents}
                      className="text-2xl font-bold tracking-tight dark:text-white text-zinc-900 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <AppleButton
                      variant="glass"
                      size="sm"
                      onClick={handlePrintBill}
                      icon={<Printer size={14} />}
                      className="rounded-2xl h-10 text-xs font-semibold"
                    >
                      Adisyon Fişi
                    </AppleButton>
                    <AppleButton
                      variant="glass"
                      size="sm"
                      onClick={() => setShowVoidModal(true)}
                      icon={<XCircle size={14} className="text-rose-500 dark:text-rose-400" />}
                      className="rounded-2xl h-10 text-xs font-semibold text-rose-600 dark:text-rose-300 hover:text-rose-700 dark:hover:text-rose-200 border-rose-500/20 hover:border-rose-500/30"
                    >
                      Hesap İptal
                    </AppleButton>
                  </div>
                </div>
              )}
            </div>

            {/* ========================================================= */}
            {/* SAĞ KOLON: HIZLI TAHSİLAT (BAĞIMSIZ YÜZEN CAM ADA)        */}
            {/* ========================================================= */}
            <div className="flex-1 h-full overflow-y-auto p-6 flex flex-col gap-5 backdrop-blur-2xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.4)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] rounded-3xl">
              {/* ÜST BİLGİ VE TOPLAM BORÇ GÖSTERGESİ */}
              <div className="flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-xl font-bold tracking-tight dark:text-white text-zinc-900">Hızlı Tahsilat</h2>
                  <p className="text-xs dark:text-white/50 text-zinc-500 mt-0.5">
                    {selectedTable ? `${selectedTable.name} için ödeme alınıyor` : 'Ödeme almak için açık bir hesap seçin'}
                  </p>
                </div>
                <div className="px-4 py-2 rounded-2xl backdrop-blur-xl dark:bg-white/[0.06] bg-black/[0.04] border dark:border-white/10 border-black/10 dark:text-white text-zinc-900 font-mono flex items-center gap-2.5 shadow-lg">
                  <span className="text-xs uppercase tracking-wider dark:text-white/60 text-zinc-500 font-medium">Toplam Borç:</span>
                  <MoneyDisplay amountInCents={grandTotalCents} className="text-2xl font-bold tracking-tight dark:text-white text-zinc-900 font-mono" />
                </div>
              </div>

              {/* TAHSİLAT BAŞARILI BİLDİRİM KARTI (RENKSİZ FROSTED GLASS) */}
              {paymentSuccess && (
                <div className="p-4 rounded-3xl backdrop-blur-2xl dark:bg-white/[0.06] bg-white/90 border dark:border-white/15 border-black/10 flex items-center justify-between shadow-2xl animate-in fade-in duration-200 shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl dark:bg-white/[0.08] bg-black/[0.05] dark:text-white text-zinc-900 flex items-center justify-center shrink-0 border dark:border-white/10 border-black/[0.08]">
                      <Check size={20} />
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm dark:text-white text-zinc-900">
                        {paymentSuccess.tableName} Tahsilatı Tamamlandı
                      </h4>
                      <p className="text-xs dark:text-white/60 text-zinc-500 font-mono mt-0.5">
                        Tahsil: <MoneyDisplay amountInCents={paymentSuccess.totalCents} /> • Para Üstü:{' '}
                        <MoneyDisplay amountInCents={paymentSuccess.changeCents} />
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <AppleButton
                      variant="glass"
                      size="sm"
                      onClick={handleReprintReceipt}
                      icon={<Printer size={14} />}
                      className="rounded-2xl h-9 text-xs"
                    >
                      Fişi Tekrar Yazdır
                    </AppleButton>
                    <button
                      type="button"
                      onClick={() => setPaymentSuccess(null)}
                      className="p-2 hover:dark:bg-white/10 hover:bg-black/5 rounded-2xl dark:text-white/60 text-zinc-500 hover:dark:text-white hover:text-zinc-900 transition-all cursor-pointer"
                      title="Kapat"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* ALINAN VE PARA ÜSTÜ GÖSTERGELERİ (RENKSİZ CAM KARTLAR) */}
              <div className="grid grid-cols-2 gap-4 shrink-0">
                <div className="p-5 rounded-3xl backdrop-blur-xl dark:bg-white/[0.03] bg-white/80 border dark:border-white/10 border-black/[0.08] shadow-xl flex flex-col justify-between">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-medium dark:text-white/50 text-zinc-500 uppercase tracking-wider">
                      Müşteriden Alınan Tutar
                    </span>
                    {tenderedAmount && (
                      <button
                        type="button"
                        onClick={() => setTenderedAmount('')}
                        disabled={isSubmittingPayment}
                        className="px-2.5 py-0.5 hover:dark:bg-white/10 hover:bg-black/5 rounded-xl text-xs dark:text-white/40 text-zinc-500 hover:dark:text-white hover:text-zinc-900 transition-all active:scale-90 cursor-pointer"
                        title="Tutarı Sıfırla"
                      >
                        Temizle
                      </button>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={tenderedAmount}
                      onChange={(e) => {
                        let val = e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.');
                        const parts = val.split('.');
                        if (parts.length > 2) {
                          val = parts[0] + '.' + parts.slice(1).join('');
                        }
                        if (val.includes('.')) {
                          const [intPart, decPart] = val.split('.');
                          val = `${intPart}.${decPart.slice(0, 2)}`;
                        }
                        setTenderedAmount(val);
                      }}
                      disabled={isSubmittingPayment || !selectedTableId || grandTotalCents <= 0}
                      placeholder="0,00"
                      className="w-full bg-transparent text-3xl font-semibold tracking-tight dark:text-white text-zinc-900 font-mono focus:outline-none dark:placeholder-white/20 placeholder-zinc-300"
                    />
                    <span className="text-2xl font-semibold dark:text-white/50 text-zinc-400">₺</span>
                  </div>
                </div>

                <div className="p-5 rounded-3xl backdrop-blur-xl dark:bg-white/[0.03] bg-white/80 border dark:border-white/10 border-black/[0.08] shadow-xl flex flex-col justify-between">
                  <span
                    className={`text-xs font-medium uppercase tracking-wider mb-1 ${
                      tenderedCents > 0 && tenderedCents < grandTotalCents
                        ? 'text-rose-500 dark:text-rose-400'
                        : 'dark:text-white/50 text-zinc-500'
                    }`}
                  >
                    {tenderedCents > 0 && tenderedCents < grandTotalCents
                      ? 'Kalan Tutar (Eksik)'
                      : 'Verilecek Para Üstü'}
                  </span>
                  <div>
                    {tenderedCents > 0 && tenderedCents < grandTotalCents ? (
                      <MoneyDisplay
                        amountInCents={grandTotalCents - tenderedCents}
                        className="text-3xl font-semibold tracking-tight text-rose-500 dark:text-rose-400 font-mono"
                      />
                    ) : (
                      <MoneyDisplay
                        amountInCents={changeCents}
                        className="text-3xl font-semibold tracking-tight dark:text-white text-zinc-900 font-mono"
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* HIZLI BANKNOTLAR, OPSİYONEL TUŞ TAKIMI VE TAHSİLAT AKSİYONLARI */}
              <div className="p-5 rounded-3xl backdrop-blur-xl dark:bg-white/[0.03] bg-white/80 border dark:border-white/10 border-black/[0.08] shadow-xl flex-1 flex flex-col gap-4">
                {/* Hızlı Banknot Seçenekleri & Tuş Takımı Toggle */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider dark:text-white/50 text-zinc-500">
                      Hızlı Banknotlar & Nakit Girişi
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNumpad((prev) => !prev)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-2xl border text-xs font-medium transition-all cursor-pointer backdrop-blur-md ${
                        showNumpad
                          ? 'dark:bg-white/[0.12] bg-black/[0.08] dark:border-white/25 border-black/20 dark:text-white text-zinc-900 ring-1 ring-white/10 shadow-sm'
                          : 'dark:bg-white/[0.04] bg-white/70 dark:border-white/10 border-black/[0.08] dark:text-white/70 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.08] hover:bg-black/[0.04]'
                      }`}
                    >
                      <Calculator size={13} />
                      <span>{showNumpad ? 'Tuş Takımını Gizle' : 'Tuş Takımını Göster'}</span>
                    </button>
                  </div>

                  {/* Hızlı Banknot ve Tam Tutar Seçenekleri (5'li Şık Izgara) */}
                  <div className="grid grid-cols-5 gap-2.5">
                    {PRESET_AMOUNTS.map((amount) => {
                      const isSelected = tenderedAmount === amount.toString();
                      return (
                        <button
                          key={amount}
                          type="button"
                          onClick={() => handleNumpadPress(`PRESET_${amount}`)}
                          disabled={isSubmittingPayment || !selectedTableId || grandTotalCents <= 0}
                          className={`py-3 rounded-2xl font-semibold text-base dark:text-white text-zinc-900 border active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer shadow-sm flex flex-col items-center justify-center backdrop-blur-md ${
                            isSelected
                              ? 'dark:bg-white/[0.12] bg-black/[0.08] border dark:border-white/25 border-black/20 ring-1 ring-white/10 shadow-md'
                              : 'dark:bg-white/[0.04] bg-white/70 hover:dark:bg-white/[0.08] hover:bg-black/[0.04] border dark:border-white/10 border-black/[0.08]'
                          }`}
                        >
                          <span>{`${amount} ₺`}</span>
                        </button>
                      );
                    })}
                    {/* Tam Tutar Butonu */}
                    {(() => {
                      const isExact = grandTotalCents > 0 && tenderedCents === grandTotalCents;
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            if (grandTotalCents > 0) {
                              setTenderedAmount((grandTotalCents / 100).toFixed(2));
                            }
                          }}
                          disabled={isSubmittingPayment || !selectedTableId || grandTotalCents <= 0}
                          className={`py-3 border font-semibold rounded-2xl active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer shadow-sm flex flex-col items-center justify-center backdrop-blur-md dark:text-white text-zinc-900 ${
                            isExact
                              ? 'dark:bg-white/[0.14] bg-black/[0.08] border dark:border-white/25 border-black/20 ring-1 ring-white/10 shadow-md'
                              : 'dark:bg-white/[0.04] bg-white/70 hover:dark:bg-white/[0.08] hover:bg-black/[0.04] border dark:border-white/10 border-black/[0.08]'
                          }`}
                        >
                          <span className="text-xs uppercase tracking-wider font-bold">Tam Tutar</span>
                          {grandTotalCents > 0 && (
                            <span className="text-[11px] dark:text-white/60 text-zinc-500 font-mono mt-0.5">
                              {`${(grandTotalCents / 100).toFixed(2)} ₺`}
                            </span>
                          )}
                        </button>
                      );
                    })()}
                  </div>

                  {/* Tuş takımı kapalıyken gösterilen rehber bar */}
                  {!showNumpad && (
                    <div className="flex items-center justify-between px-4 py-3 rounded-2xl dark:bg-white/[0.02] bg-black/[0.02] border dark:border-white/[0.06] border-black/[0.05] text-xs dark:text-white/50 text-zinc-500">
                      <div className="flex items-center gap-2">
                        <Calculator size={14} className="dark:text-white/40 text-zinc-400" />
                        <span>Özel küsurat veya serbest tutar girişi için tuş takımını açabilirsiniz.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowNumpad(true)}
                        className="dark:text-white text-zinc-900 hover:underline font-semibold transition-colors cursor-pointer"
                      >
                        Aç
                      </button>
                    </div>
                  )}

                  {/* OPSİYONEL KOMPAKT TUŞ TAKIMI (NUMPAD) */}
                  {showNumpad && (
                    <div className="grid grid-cols-4 gap-2 pt-3 border-t dark:border-white/[0.06] border-black/[0.06] animate-in fade-in duration-150">
                      {['7', '8', '9', 'C'].map((btn) => (
                        <button
                          key={btn}
                          type="button"
                          onClick={() => handleNumpadPress(btn)}
                          disabled={isSubmittingPayment || !selectedTableId || grandTotalCents <= 0}
                          className={`py-3.5 rounded-2xl font-mono text-base font-semibold border transition-all active:scale-95 cursor-pointer disabled:opacity-30 ${
                            btn === 'C'
                              ? 'backdrop-blur-md bg-rose-500/10 dark:border-rose-500/20 border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 active:bg-rose-500/30'
                              : 'backdrop-blur-md dark:bg-white/[0.04] bg-white/70 dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 hover:dark:bg-white/[0.08] hover:bg-black/[0.04] active:dark:bg-white/[0.12] active:bg-black/[0.08]'
                          }`}
                        >
                          {btn}
                        </button>
                      ))}
                      {['4', '5', '6', 'BACKSPACE'].map((btn) => (
                        <button
                          key={btn}
                          type="button"
                          onClick={() => handleNumpadPress(btn)}
                          disabled={isSubmittingPayment || !selectedTableId || grandTotalCents <= 0}
                          className="py-3.5 rounded-2xl font-mono text-base font-semibold border transition-all active:scale-95 cursor-pointer disabled:opacity-30 backdrop-blur-md dark:bg-white/[0.04] bg-white/70 dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 hover:dark:bg-white/[0.08] hover:bg-black/[0.04] active:dark:bg-white/[0.12] active:bg-black/[0.08] flex items-center justify-center"
                        >
                          {btn === 'BACKSPACE' ? <Delete size={18} className="dark:text-white/70 text-zinc-500" /> : btn}
                        </button>
                      ))}
                      {['1', '2', '3', '00'].map((btn) => (
                        <button
                          key={btn}
                          type="button"
                          onClick={() => handleNumpadPress(btn)}
                          disabled={isSubmittingPayment || !selectedTableId || grandTotalCents <= 0}
                          className="py-3.5 rounded-2xl font-mono text-base font-semibold border transition-all active:scale-95 cursor-pointer disabled:opacity-30 backdrop-blur-md dark:bg-white/[0.04] bg-white/70 dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 hover:dark:bg-white/[0.08] hover:bg-black/[0.04] active:dark:bg-white/[0.12] active:bg-black/[0.08]"
                        >
                          {btn}
                        </button>
                      ))}
                      {['.', '0', 'Tam'].map((btn) => (
                        <button
                          key={btn}
                          type="button"
                          onClick={() => {
                            if (btn === 'Tam') {
                              if (grandTotalCents > 0) {
                                setTenderedAmount((grandTotalCents / 100).toFixed(2));
                              }
                            } else {
                              handleNumpadPress(btn);
                            }
                          }}
                          disabled={isSubmittingPayment || !selectedTableId || grandTotalCents <= 0}
                          className={`py-3.5 rounded-2xl font-mono text-base font-semibold border transition-all active:scale-95 cursor-pointer disabled:opacity-30 ${
                            btn === 'Tam'
                              ? 'col-span-2 backdrop-blur-md dark:bg-white/[0.10] bg-black/[0.06] dark:border-white/20 border-black/15 dark:text-white text-zinc-900 hover:dark:bg-white/[0.16] hover:bg-black/[0.10] active:scale-95 text-xs font-sans tracking-wide uppercase font-bold flex items-center justify-center'
                              : 'backdrop-blur-md dark:bg-white/[0.04] bg-white/70 dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 hover:dark:bg-white/[0.08] hover:bg-black/[0.04] active:dark:bg-white/[0.12] active:bg-black/[0.08]'
                          }`}
                        >
                          {btn === 'Tam' ? 'Tam Tutar' : btn}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Ödenecek Tutar Özeti ve Resmi Tahsilat Butonları */}
                <div className="mt-auto space-y-3 pt-2">
                  <div className="flex items-center justify-between py-3.5 px-4 rounded-2xl backdrop-blur-md dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/[0.06] border-black/[0.05]">
                    <span className="text-xs font-medium dark:text-white/60 text-zinc-500 uppercase tracking-wider">Ödenecek Net Tutar</span>
                    <MoneyDisplay
                      amountInCents={grandTotalCents}
                      className="text-2xl font-bold tracking-tight dark:text-white text-zinc-900 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3.5">
                    <button
                      type="button"
                      onClick={() => handleSubmitPayment('CASH')}
                      disabled={
                        isSubmittingPayment ||
                        !selectedTableId ||
                        grandTotalCents <= 0 ||
                        (tenderedCents > 0 && tenderedCents < grandTotalCents)
                      }
                      className="py-4 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 dark:text-white text-zinc-900 rounded-2xl backdrop-blur-xl shadow-lg font-semibold active:scale-[0.98] flex items-center justify-center gap-2.5 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                    >
                      <Banknote size={20} />
                      <span>Nakit Tahsilat</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSubmitPayment('CREDIT_CARD')}
                      disabled={
                        isSubmittingPayment ||
                        !selectedTableId ||
                        grandTotalCents <= 0
                      }
                      className="py-4 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 dark:text-white text-zinc-900 rounded-2xl backdrop-blur-xl shadow-lg font-semibold active:scale-[0.98] flex items-center justify-center gap-2.5 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                    >
                      <CreditCard size={20} />
                      <span>Kredi Kartı</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ==================== VARDİYA GEÇMİŞİ SEKMESİ ==================== */}
        {activeTab === 'GECMIS' && (
          <div className="flex-1 flex flex-col overflow-hidden backdrop-blur-2xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.4)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] rounded-3xl">
            {/* Z-Raporu Detay Modalı: Renksiz şeffaf cam */}
            {zReportShift && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
                <div className="backdrop-blur-2xl dark:bg-white/[0.05] bg-white/80 border dark:border-white/10 border-black/[0.08] p-7 md:p-8 rounded-3xl shadow-2xl max-w-lg w-full animate-in zoom-in-95 duration-150">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center dark:bg-white/[0.06] bg-black/[0.04] border dark:border-white/10 border-black/[0.08]">
                      <FileText size={24} className="dark:text-white text-zinc-900" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight dark:text-white text-zinc-900">Z-Raporu</h2>
                      <p className="text-xs dark:text-white/50 text-zinc-500 mt-0.5">Vardiya sonu resmi mutabakat raporu</p>
                    </div>
                  </div>

                  {zReportLoading ? (
                    <div className="py-12 flex justify-center dark:text-white/40 text-zinc-400">
                      <RefreshCcw size={24} className="animate-spin dark:text-white text-zinc-900" />
                    </div>
                  ) : zReportSummary ? (
                    <div className="space-y-3.5 text-sm mb-6">
                      <div className="grid grid-cols-2 gap-2 dark:bg-white/[0.03] bg-black/[0.02] p-4 rounded-2xl border dark:border-white/[0.08] border-black/[0.06] text-xs">
                        <div className="dark:text-white/50 text-zinc-500">Açılış Zamanı</div>
                        <div className="text-right font-mono dark:text-white/80 text-zinc-700">{fmtDate(zReportShift.openedAt)}</div>
                        <div className="dark:text-white/50 text-zinc-500">Kapanış Zamanı</div>
                        <div className="text-right font-mono dark:text-white/80 text-zinc-700">{fmtDate(zReportShift.closedAt)}</div>
                        <div className="dark:text-white/50 text-zinc-500">Açılış Bakiyesi</div>
                        <div className="text-right font-mono dark:text-white/80 text-zinc-700">
                          <MoneyDisplay amountInCents={zReportShift.expectedAmountCents} />
                        </div>
                      </div>

                      <div className="dark:bg-white/[0.03] bg-black/[0.02] p-4 rounded-2xl border dark:border-white/[0.08] border-black/[0.06] space-y-2">
                        <div className="flex justify-between">
                          <span className="dark:text-white/70 text-zinc-600">Toplam Satış</span>
                          <MoneyDisplay amountInCents={zReportSummary.totalSales} className="dark:text-white text-zinc-900 font-semibold font-mono" />
                        </div>
                        <div className="flex justify-between dark:text-white/80 text-zinc-700">
                          <span>Nakit Girişleri (+)</span>
                          <MoneyDisplay amountInCents={zReportSummary.totalCashIn} className="font-mono dark:text-white text-zinc-900" />
                        </div>
                        <div className="flex justify-between dark:text-white/80 text-zinc-700">
                          <span>Nakit Çıkışları (-)</span>
                          <MoneyDisplay amountInCents={zReportSummary.totalCashOut} className="font-mono dark:text-white text-zinc-900" />
                        </div>
                        <div className="flex justify-between border-t dark:border-white/[0.08] border-black/[0.06] pt-2 font-semibold">
                          <span className="dark:text-white/90 text-zinc-800">Beklenen Kapanış Kasası</span>
                          <MoneyDisplay amountInCents={zReportSummary.expectedBalance} className="dark:text-white text-zinc-900 font-mono" />
                        </div>
                        {zReportShift.actualAmountCents != null && (
                          <div className="flex justify-between font-semibold">
                            <span className="dark:text-white/90 text-zinc-800">Sayılan Fiili Kapanış</span>
                            <MoneyDisplay amountInCents={zReportShift.actualAmountCents} className="dark:text-white text-zinc-900 font-mono" />
                          </div>
                        )}
                        <div
                          className={`flex justify-between border-t dark:border-white/[0.08] border-black/[0.06] pt-2 font-semibold ${
                            zReportSummary.discrepancy < 0
                              ? 'text-rose-500 dark:text-rose-400'
                              : zReportSummary.discrepancy > 0
                              ? 'dark:text-white text-zinc-900'
                              : 'dark:text-white/60 text-zinc-500'
                          }`}
                        >
                          <span>Kasa Mutabakat Farkı</span>
                          <MoneyDisplay amountInCents={zReportSummary.discrepancy} className="font-mono font-bold" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-rose-500 dark:text-rose-400 text-center py-6 text-sm">Z-Raporu özeti yüklenemedi.</div>
                  )}

                  <div className="flex gap-3">
                    <AppleButton
                      variant="secondary"
                      onClick={() => {
                        setZReportShift(null);
                        setZReportSummary(null);
                      }}
                      className="flex-1 rounded-2xl h-12"
                    >
                      Kapat
                    </AppleButton>
                    <AppleButton
                      variant="primary"
                      onClick={handlePrintZReport}
                      disabled={!zReportSummary}
                      icon={<Printer size={16} />}
                      className="flex-1 rounded-2xl h-12 text-white bg-[#007AFF] hover:bg-[#0071eb] border-transparent font-semibold shadow-md shadow-[#007AFF]/25"
                    >
                      Yazdır
                    </AppleButton>
                  </div>
                </div>
              </div>
            )}

            {/* Vardiya Geçmişi Başlığı */}
            <div className="p-6 border-b dark:border-white/10 border-black/[0.08] flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-2xl font-bold tracking-tight dark:text-white text-zinc-900">Vardiya Geçmişi</h2>
                <p className="text-xs dark:text-white/50 text-zinc-500 mt-0.5">Geçmiş vardiya kapanışları ve Z-Raporu kayıtları</p>
              </div>
              <button
                onClick={loadShiftHistory}
                className="p-2.5 dark:bg-white/[0.04] bg-black/[0.03] hover:dark:bg-white/[0.08] hover:bg-black/[0.06] border dark:border-white/10 border-black/[0.08] rounded-2xl dark:text-white/70 text-zinc-600 hover:dark:text-white hover:text-zinc-900 transition-all active:scale-95 cursor-pointer"
                title="Yenile"
              >
                <RefreshCcw size={16} />
              </button>
            </div>

            {/* Vardiya Geçmiş Tablosu: Renksiz şeffaf frosted glass */}
            <div className="flex-1 overflow-y-auto p-6">
              {historyLoading ? (
                <div className="flex items-center justify-center h-40 dark:text-white/40 text-zinc-400 gap-2">
                  <RefreshCcw size={20} className="animate-spin dark:text-white text-zinc-900" />
                  <span>Vardiya kayıtları yükleniyor...</span>
                </div>
              ) : shiftHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 dark:text-white/40 text-zinc-400">
                  <History size={40} className="mb-2.5 opacity-20" />
                  <p className="text-xs">Henüz vardiya kaydı bulunmuyor.</p>
                </div>
              ) : (
                <div className="backdrop-blur-xl dark:bg-white/[0.03] bg-white/70 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 overflow-x-auto shadow-xl">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left dark:text-white/40 text-zinc-500 border-b dark:border-white/10 border-black/[0.08] text-xs uppercase tracking-wider">
                        <th className="pb-3 pr-4 font-semibold">Açılış / Kapanış</th>
                        <th className="pb-3 pr-4 font-semibold">Durum</th>
                        <th className="pb-3 pr-4 font-semibold text-right">Açılış Kasası</th>
                        <th className="pb-3 pr-4 font-semibold text-right">Kapanış Sayımı</th>
                        <th className="pb-3 pr-4 font-semibold text-right">Fark</th>
                        <th className="pb-3 pr-4 font-semibold text-right">Rapor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y dark:divide-white/[0.06] divide-black/[0.06]">
                      {shiftHistory.map((shift) => {
                        const diff = shift.differenceCents ?? 0;
                        const isClosed = shift.status === 'CLOSED';
                        return (
                          <tr key={shift.id} className="hover:dark:bg-white/[0.03] hover:bg-black/[0.02] transition-colors">
                            <td className="py-4 pr-4">
                              <div className="font-mono dark:text-white/90 text-zinc-800 text-xs">{fmtDate(shift.openedAt)}</div>
                              {shift.closedAt && (
                                <div className="text-[11px] dark:text-white/40 text-zinc-500 mt-0.5 font-mono">
                                  {fmtDate(shift.closedAt)}
                                </div>
                              )}
                            </td>
                            <td className="py-4 pr-4">
                              <AppBadge variant={isClosed ? 'neutral' : 'available'}>
                                {isClosed ? 'KAPALI' : 'AÇIK'}
                              </AppBadge>
                            </td>
                            <td className="py-4 pr-4 text-right font-mono dark:text-white/90 text-zinc-800">
                              <MoneyDisplay amountInCents={shift.expectedAmountCents} />
                            </td>
                            <td className="py-4 pr-4 text-right font-mono dark:text-white/90 text-zinc-800">
                              {shift.actualAmountCents != null ? (
                                <MoneyDisplay amountInCents={shift.actualAmountCents} />
                              ) : (
                                <span className="dark:text-white/20 text-zinc-300">—</span>
                              )}
                            </td>
                            <td className="py-4 pr-4 text-right font-mono font-semibold">
                              {isClosed && shift.differenceCents != null ? (
                                <span
                                  className={
                                    diff < 0 ? 'text-rose-500 dark:text-rose-400' : diff > 0 ? 'dark:text-white text-zinc-900' : 'dark:text-white/50 text-zinc-500'
                                  }
                                >
                                  {diff > 0 ? '+' : ''}
                                  <MoneyDisplay amountInCents={diff} />
                                </span>
                              ) : (
                                <span className="dark:text-white/20 text-zinc-300">—</span>
                              )}
                            </td>
                            <td className="py-4 text-right">
                              {isClosed ? (
                                <AppleButton
                                  variant="glass"
                                  size="sm"
                                  onClick={() => handleOpenZReport(shift)}
                                  icon={<FileText size={13} className="dark:text-white text-zinc-900" />}
                                  className="rounded-2xl h-8 text-xs dark:text-white text-zinc-900"
                                >
                                  Z-Raporu
                                </AppleButton>
                              ) : (
                                <span className="dark:text-white/20 text-zinc-300 text-xs">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
