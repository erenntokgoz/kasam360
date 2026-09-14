import { useEffect, useState, useMemo, useCallback } from 'react';
import { useFloorStore } from '../../store/useFloorStore';
import { useCartStore } from '../../store/useCartStore';
import { useAuthStore } from '../../store/useAuthStore';
import { PaymentMethod, CartItem, POSProduct, ModifierOption } from '../../types';
import {
  CheckCircle2, Clock, MapPin, Receipt, RefreshCcw, Banknote, CreditCard,
  XCircle, Lock, Unlock, History, Search, FileText, Printer, AlertCircle, Check, Info,
} from 'lucide-react';
import { MoneyDisplay } from '../common/MoneyDisplay';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';

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

  // Selected table & items for cashier workstation
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [tableItems, setTableItems] = useState<CartItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);

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

  // Toast / notification feedback (replaces alert/prompt)
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Shift state
  const [isShiftOpen, setIsShiftOpen] = useState(false);
  const [activeShift, setActiveShift] = useState<ShiftDto | null>(null);
  const [shiftSummary, setShiftSummary] = useState<ShiftSummaryDto | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [showShiftModal, setShowShiftModal] = useState<'OPEN' | 'CLOSE' | null>(null);
  const [shiftAmount, setShiftAmount] = useState('');

  // X-Report modal (mid-shift summary)
  const [showXReportModal, setShowXReportModal] = useState(false);
  const [xReportSummary, setXReportSummary] = useState<ShiftSummaryDto | null>(null);
  const [xReportLoading, setXReportLoading] = useState(false);

  // Cash In/Out modal
  const [showCashModal, setShowCashModal] = useState<'IN' | 'OUT' | null>(null);
  const [cashAmount, setCashAmount] = useState('');
  const [cashReason, setCashReason] = useState('');

  // Void modal
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [managerPin, setManagerPin] = useState('');

  // Shift history
  const [shiftHistory, setShiftHistory] = useState<ShiftDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Z-Report modal (historical)
  const [zReportShift, setZReportShift] = useState<ShiftDto | null>(null);
  const [zReportSummary, setZReportSummary] = useState<ShiftSummaryDto | null>(null);
  const [zReportLoading, setZReportLoading] = useState(false);

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

  // Initial shift check
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

  // Periodic floor plan poll
  useEffect(() => {
    fetchFloorPlan();
    const interval = setInterval(fetchFloorPlan, 10000);
    return () => clearInterval(interval);
  }, [fetchFloorPlan]);

  // Load history when switching to history tab
  useEffect(() => {
    if (activeTab === 'GECMIS') {
      loadShiftHistory();
    }
  }, [activeTab, loadShiftHistory]);

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

  const handlePrintZReport = async () => {
    if (!zReportShift || !zReportSummary) return;
    try {
      await tauriInvoke('print_receipt', {
        order: {
          type: 'Z_REPORT',
          title: 'Z-RAPORU (GÜN SONU MUTABAKATI)',
          shiftId: zReportShift.id,
          cashierId: zReportShift.cashierId,
          openedAt: zReportShift.openedAt,
          closedAt: zReportShift.closedAt,
          openingBalance: zReportShift.expectedAmountCents,
          totalSales: zReportSummary.totalSales,
          totalCashIn: zReportSummary.totalCashIn,
          totalCashOut: zReportSummary.totalCashOut,
          expectedBalance: zReportSummary.expectedBalance,
          actualBalance: zReportShift.actualAmountCents,
          discrepancy: zReportSummary.discrepancy,
          timestamp: new Date().toISOString(),
        },
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

  // Table selection & order items loading
  const handleSelectTable = async (tableId: string) => {
    setSelectedTableId(tableId);
    setTenderedAmount('');
    setPaymentSuccess(null);
    setIsLoadingItems(true);

    try {
      const items = await tauriInvoke<Record<string, unknown>[]>('get_order_items', {
        tableId,
        table_id: tableId,
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
        // Fallback for mock or unitemized table total
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

  // Financial totals for the selected table
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

  // Tendered & Change calculations
  const parsedTenderedLira = parseFloat(tenderedAmount) || 0;
  const tenderedCents = Math.round(parsedTenderedLira * 100);
  const changeCents = tenderedCents > 0 ? Math.max(0, tenderedCents - grandTotalCents) : 0;

  // Shift open/close submit
  const handleShiftSubmit = async () => {
    const amountCents = Math.round((parseFloat(shiftAmount) || 0) * 100);
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
        // CLOSE SHIFT
        await tauriInvoke('close_shift', {
          cashierId,
          cashier_id: cashierId,
          actualAmountCents: amountCents,
          actual_amount_cents: amountCents,
        });

        // Print Z-Report automatically on shift closure
        if (activeShift && shiftSummary) {
          const diff = amountCents - shiftSummary.expectedBalance;
          await tauriInvoke('print_receipt', {
            order: {
              type: 'Z_REPORT',
              title: 'Z-RAPORU (GÜN SONU MUTABAKATI)',
              shiftId: activeShift.id,
              cashierId: activeShift.cashierId,
              openedAt: activeShift.openedAt,
              closedAt: new Date().toISOString(),
              openingBalance: activeShift.expectedAmountCents,
              totalSales: shiftSummary.totalSales,
              totalCashIn: shiftSummary.totalCashIn,
              totalCashOut: shiftSummary.totalCashOut,
              expectedBalance: shiftSummary.expectedBalance,
              actualBalance: amountCents,
              discrepancy: diff,
              timestamp: new Date().toISOString(),
            },
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

  // X-Report (Mid-shift summary)
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

  const handlePrintXReport = async () => {
    if (!activeShift || !xReportSummary) return;
    try {
      await tauriInvoke('print_receipt', {
        order: {
          type: 'X_REPORT',
          title: 'X-RAPORU (GÜN İÇİ ARA MUTABAKAT)',
          shiftId: activeShift.id,
          cashierId: activeShift.cashierId,
          openedAt: activeShift.openedAt,
          reportTime: new Date().toISOString(),
          openingBalance: activeShift.expectedAmountCents,
          totalSales: xReportSummary.totalSales,
          totalCashIn: xReportSummary.totalCashIn,
          totalCashOut: xReportSummary.totalCashOut,
          expectedBalance: xReportSummary.expectedBalance,
          timestamp: new Date().toISOString(),
        },
      });
      showToast('success', 'X-Raporu yazıcıya gönderildi.');
    } catch (err) {
      showToast('error', `Yazdırma hatası: ${String(err)}`);
    }
  };

  // Cash In / Cash Out Submit
  const handleCashMovementSubmit = async () => {
    if (!activeShift) return;
    const amountCents = Math.round((parseFloat(cashAmount) || 0) * 100);
    if (amountCents <= 0 || !cashReason.trim()) return;

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

      if (showCashModal === 'IN') {
        await tauriInvoke('cash_in', args);
      } else {
        await tauriInvoke('cash_out', args);
      }

      // Print Cash Movement Slip
      await tauriInvoke('print_receipt', {
        order: {
          type: showCashModal === 'IN' ? 'CASH_IN_SLIP' : 'CASH_OUT_SLIP',
          title: showCashModal === 'IN' ? 'KASA GİRİŞ FİŞİ' : 'KASA ÇIKIŞ FİŞİ',
          shiftId: activeShift.id,
          cashierId,
          movementType: showCashModal,
          amountCents,
          reason: cashReason.trim(),
          timestamp: new Date().toISOString(),
        },
      }).catch(console.error);

      setShowCashModal(null);
      setCashAmount('');
      setCashReason('');
      showToast('success', `Kasa ${showCashModal === 'IN' ? 'girişi' : 'çıkışı'} kaydedildi ve fiş yazdırıldı.`);
    } catch (err: unknown) {
      showToast('error', `Kasa Hareketi Hatası: ${String(err)}`);
    }
  };

  // Void Order Submit
  const handleVoidSubmit = async () => {
    if (!selectedTableId) return;
    try {
      const payload = {
        orderId: selectedTableId,
        tableId: selectedTableId,
        reason: voidReason.trim(),
        actorId: cashierId,
        actorRole: cashierRole,
        managerPin: managerPin.trim() ? managerPin.trim() : undefined,
      };

      await tauriInvoke('void_order', {
        payload,
        tenantId: user?.tenantId || 'DEFAULT_TENANT',
        tenant_id: user?.tenantId || 'DEFAULT_TENANT',
      });

      // Print Void Slip
      await tauriInvoke('print_receipt', {
        order: {
          type: 'VOID_RECEIPT',
          title: 'HESAP İPTAL (VOID) FİŞİ',
          tableName: selectedTable?.name || selectedTableId,
          tableId: selectedTableId,
          cashierId,
          reason: voidReason.trim(),
          totalAmount: grandTotalCents,
          timestamp: new Date().toISOString(),
        },
      }).catch(console.error);

      setShowVoidModal(false);
      setVoidReason('');
      setManagerPin('');
      setSelectedTableId(null);
      setTableItems([]);
      useCartStore.getState().clearCart();
      await fetchFloorPlan();
      showToast('success', 'Hesap başarıyla iptal edildi.');
    } catch (err: unknown) {
      showToast('error', `İptal hatası: ${String(err)}`);
    }
  };

  // Numpad Press Handler
  const handleNumpadPress = (value: string) => {
    if (value === 'C') {
      setTenderedAmount('');
      return;
    }

    if (value.startsWith('PRESET_')) {
      const amount = value.replace('PRESET_', '');
      setTenderedAmount(amount);
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

  // Submit Payment Handler
  const handleSubmitPayment = async (method: PaymentMethod) => {
    if (!selectedTableId || grandTotalCents <= 0 || isSubmittingPayment) return;

    const finalAmountCents = tenderedCents === 0 ? grandTotalCents : tenderedCents;
    if (finalAmountCents < grandTotalCents && method !== 'SPLIT') {
      showToast('error', 'Alınan tutar toplam tutardan az olamaz.');
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
      changeAmount: Math.max(0, finalAmountCents - grandTotalCents),
      change_amount: Math.max(0, finalAmountCents - grandTotalCents),
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
      const res = await tauriInvoke<{ success: boolean; transactionId?: string }>('process_payment', { payload });

      const paidItems = [...tableItems];
      const tableName = selectedTable?.name || selectedTableId;

      // Print Payment Receipt
      const receiptData = {
        type: 'PAYMENT_RECEIPT',
        title: 'ÖDEME TAHSİLAT FİŞİ',
        transactionId: res?.transactionId || txnId,
        tableName,
        tableId: selectedTableId,
        cashierId,
        method,
        amountTendered: finalAmountCents,
        totalAmount: grandTotalCents,
        changeAmount: Math.max(0, finalAmountCents - grandTotalCents),
        items: paidItems.map(it => ({
          name: it.product.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          total: it.total,
        })),
        timestamp: new Date().toISOString(),
      };

      await tauriInvoke('print_receipt', { order: receiptData }).catch((err) => {
        console.warn('Fiş yazdırma uyarısı:', err);
      });

      setPaymentSuccess({
        method,
        transactionId: res?.transactionId || txnId,
        totalCents: grandTotalCents,
        tenderedCents: finalAmountCents,
        changeCents: Math.max(0, finalAmountCents - grandTotalCents),
        tableName,
        items: paidItems,
      });

      // Clear table state
      setSelectedTableId(null);
      setTableItems([]);
      setTenderedAmount('');
      useCartStore.getState().clearCart();

      // Refresh tables list
      await fetchFloorPlan();
      showToast('success', `${tableName} hesabı başarıyla tahsil edildi.`);
    } catch (err: unknown) {
      console.error('Payment error', err);
      showToast('error', `Ödeme hatası: ${String(err)}`);
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  // Print Bill Preview
  const handlePrintBill = async () => {
    if (!selectedTableId || grandTotalCents <= 0) return;
    try {
      const billData = {
        type: 'BILL_SLIP',
        title: 'ADİSYON BİLGİ FİŞİ',
        tableName: selectedTable?.name || selectedTableId,
        tableId: selectedTableId,
        cashierId,
        totalAmount: grandTotalCents,
        subtotal: tableTotals.subtotal,
        taxTotal: tableTotals.taxTotal,
        items: tableItems.map(it => ({
          name: it.product.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          total: it.total,
        })),
        timestamp: new Date().toISOString(),
      };
      await tauriInvoke('print_receipt', { order: billData });
      showToast('success', 'Adisyon bilgi fişi yazıcıya iletildi.');
    } catch (err) {
      showToast('error', `Yazdırma hatası: ${String(err)}`);
    }
  };

  // Reprint Receipt for last payment
  const handleReprintReceipt = async () => {
    if (!paymentSuccess) return;
    try {
      await tauriInvoke('print_receipt', {
        order: {
          type: 'PAYMENT_RECEIPT',
          title: 'ÖDEME TAHSİLAT FİŞİ (KOPYA)',
          transactionId: paymentSuccess.transactionId,
          tableName: paymentSuccess.tableName,
          cashierId,
          method: paymentSuccess.method,
          amountTendered: paymentSuccess.tenderedCents,
          totalAmount: paymentSuccess.totalCents,
          changeAmount: paymentSuccess.changeCents,
          items: paymentSuccess.items.map(it => ({
            name: it.product.name,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            total: it.total,
          })),
          timestamp: new Date().toISOString(),
        },
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

  if (shiftLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-950 text-slate-100">
        <div className="flex flex-col items-center gap-3">
          <RefreshCcw size={32} className="animate-spin text-blue-500" />
          <p className="text-slate-400 font-medium">Kasiyer İstasyonu Yükleniyor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-slate-950 text-slate-100 relative flex-col select-none">

      {/* TOAST FEEDBACK */}
      {toast && (
        <div className="absolute top-4 right-4 z-[100] max-w-md animate-in fade-in slide-in-from-top-2">
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium ${
              toast.type === 'success'
                ? 'bg-emerald-950 border-emerald-800 text-emerald-200'
                : toast.type === 'error'
                ? 'bg-red-950 border-red-800 text-red-200'
                : 'bg-blue-950 border-blue-800 text-blue-200'
            }`}
          >
            {toast.type === 'success' && <Check size={18} className="text-emerald-400 shrink-0" />}
            {toast.type === 'error' && <AlertCircle size={18} className="text-red-400 shrink-0" />}
            {toast.type === 'info' && <Info size={18} className="text-blue-400 shrink-0" />}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* TAB BAR & TOP WORKSTATION HEADER */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 shrink-0 px-4">
        <div className="flex">
          <button
            onClick={() => setActiveTab('KASA')}
            className={`flex items-center gap-2 px-6 py-3.5 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'KASA'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Receipt size={16} />
            Kasiyer İstasyonu
          </button>
          <button
            onClick={() => setActiveTab('GECMIS')}
            className={`flex items-center gap-2 px-6 py-3.5 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'GECMIS'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <History size={16} />
            Vardiya Geçmişi
          </button>
        </div>

        {/* SHIFT STATUS BADGE & QUICK ACTIONS */}
        <div className="flex items-center gap-3 py-2">
          {isShiftOpen && activeShift ? (
            <>
              <div className="hidden lg:flex items-center gap-3 px-3 py-1.5 bg-slate-800/80 border border-slate-700 rounded-lg text-xs">
                <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Vardiya Açık
                </span>
                <span className="text-slate-400 font-mono">#{activeShift.id.slice(0, 8)}</span>
                <span className="text-slate-500">|</span>
                <span className="text-slate-400">
                  Açılış: <MoneyDisplay amountInCents={activeShift.expectedAmountCents} />
                </span>
              </div>

              <button
                onClick={handleOpenXReport}
                className="px-3 py-1.5 bg-blue-900/30 text-blue-400 border border-blue-900/50 rounded-lg hover:bg-blue-900/50 flex items-center gap-1.5 text-xs font-semibold transition-colors"
                title="Gün içi ara mutabakat özeti"
              >
                <FileText size={14} />
                X-Raporu
              </button>

              <button
                onClick={() => setShowCashModal('IN')}
                className="px-3 py-1.5 bg-emerald-900/30 text-emerald-400 border border-emerald-900/50 rounded-lg hover:bg-emerald-900/50 flex items-center gap-1.5 text-xs font-semibold transition-colors"
              >
                <Banknote size={14} />
                Kasa Girişi
              </button>

              <button
                onClick={() => setShowCashModal('OUT')}
                className="px-3 py-1.5 bg-amber-900/30 text-amber-400 border border-amber-900/50 rounded-lg hover:bg-amber-900/50 flex items-center gap-1.5 text-xs font-semibold transition-colors"
              >
                <Banknote size={14} />
                Kasa Çıkışı
              </button>

              <button
                onClick={handleOpenCloseShiftModal}
                className="px-3 py-1.5 bg-red-900/30 text-red-400 border border-red-900/50 rounded-lg hover:bg-red-900/50 flex items-center gap-1.5 text-xs font-semibold transition-colors"
              >
                <Lock size={14} />
                Vardiyayı Kapat
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setShiftAmount('');
                setShowShiftModal('OPEN');
              }}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center gap-2 text-xs font-bold transition-colors shadow-lg shadow-emerald-900/30"
            >
              <Unlock size={14} />
              Vardiyayı Aç
            </button>
          )}
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 overflow-hidden flex">

        {/* ==================== KASA TAB ==================== */}
        {activeTab === 'KASA' && (
          <>
            {/* SHIFT MODAL (OPEN / CLOSE) */}
            {showShiftModal && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
                <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl max-w-md w-full animate-in zoom-in-95">
                  <div className="flex items-center gap-4 mb-6">
                    {showShiftModal === 'OPEN' ? (
                      <Unlock size={32} className="text-emerald-400" />
                    ) : (
                      <Lock size={32} className="text-amber-400" />
                    )}
                    <div>
                      <h2 className="text-2xl font-bold">
                        Vardiya {showShiftModal === 'OPEN' ? 'Açılışı' : 'Kapanışı'}
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Kasiyer: <span className="font-mono text-slate-200">{cashierId}</span>
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 mb-8">
                    {showShiftModal === 'CLOSE' && shiftSummary && (
                      <div className="bg-slate-800/80 p-4 rounded-xl space-y-2.5 text-sm border border-slate-700">
                        <div className="flex justify-between text-slate-300">
                          <span>Açılış Kasası:</span>
                          <MoneyDisplay amountInCents={activeShift?.expectedAmountCents || 0} />
                        </div>
                        <div className="flex justify-between text-slate-300">
                          <span>Toplam Satış (Sistem):</span>
                          <MoneyDisplay amountInCents={shiftSummary.totalSales} />
                        </div>
                        <div className="flex justify-between text-emerald-400">
                          <span>Nakit Girişleri (+):</span>
                          <MoneyDisplay amountInCents={shiftSummary.totalCashIn} />
                        </div>
                        <div className="flex justify-between text-red-400">
                          <span>Nakit Çıkışları (-):</span>
                          <MoneyDisplay amountInCents={shiftSummary.totalCashOut} />
                        </div>
                        <div className="flex justify-between text-white font-bold pt-2 border-t border-slate-700">
                          <span>Beklenen Kasa Bakiyesi:</span>
                          <MoneyDisplay amountInCents={shiftSummary.expectedBalance} className="text-blue-400" />
                        </div>

                        {/* Live discrepancy calculation */}
                        {shiftAmount && (
                          <div className="flex justify-between font-bold pt-2 border-t border-slate-700">
                            <span>Kasa Farkı:</span>
                            {(() => {
                              const enteredCents = Math.round((parseFloat(shiftAmount) || 0) * 100);
                              const diff = enteredCents - shiftSummary.expectedBalance;
                              return (
                                <span className={diff < 0 ? 'text-red-400 font-mono' : diff > 0 ? 'text-emerald-400 font-mono' : 'text-slate-300 font-mono'}>
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
                      <label className="block text-slate-400 text-sm mb-2 font-medium">
                        {showShiftModal === 'OPEN'
                          ? 'Kasadaki Başlangıç Nakit Tutarı (₺)'
                          : 'Kasadaki Fiili Nakit Tutar (Sayım) (₺)'}
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.01"
                          autoFocus
                          value={shiftAmount}
                          onChange={(e) => setShiftAmount(e.target.value)}
                          className="w-full p-4 bg-slate-950 border border-slate-700 rounded-xl text-2xl font-mono text-white outline-none focus:border-blue-500 pr-12"
                          placeholder="0.00"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-xl font-bold">
                          ₺
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    {showShiftModal === 'CLOSE' ? (
                      <button
                        onClick={() => setShowShiftModal(null)}
                        className="flex-1 py-3.5 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold transition-colors"
                      >
                        İptal
                      </button>
                    ) : (
                      <button
                        onClick={() => setShowShiftModal(null)}
                        className="flex-1 py-3.5 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold transition-colors text-slate-400"
                      >
                        Vazgeç
                      </button>
                    )}
                    <button
                      onClick={handleShiftSubmit}
                      className={`flex-1 py-3.5 rounded-xl font-bold transition-colors text-white ${
                        showShiftModal === 'OPEN'
                          ? 'bg-emerald-600 hover:bg-emerald-500'
                          : 'bg-amber-600 hover:bg-amber-500'
                      }`}
                    >
                      {showShiftModal === 'OPEN' ? 'Vardiyayı Aç' : 'Kapat & Z-Raporu Al'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* X-REPORT MODAL (MID-SHIFT SUMMARY) */}
            {showXReportModal && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
                <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl max-w-md w-full animate-in zoom-in-95">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <FileText size={28} className="text-blue-400" />
                      <div>
                        <h2 className="text-2xl font-bold">X-Raporu</h2>
                        <p className="text-xs text-slate-400">Gün içi anlık kasa durumu</p>
                      </div>
                    </div>
                  </div>

                  {xReportLoading ? (
                    <div className="py-12 flex justify-center text-slate-400">
                      <RefreshCcw size={24} className="animate-spin text-blue-500" />
                    </div>
                  ) : xReportSummary ? (
                    <div className="space-y-4 mb-6">
                      <div className="bg-slate-800/80 p-4 rounded-xl space-y-2 text-sm border border-slate-700">
                        <div className="flex justify-between text-slate-400">
                          <span>Açılış Tarihi:</span>
                          <span className="font-mono text-slate-200">{fmtDate(activeShift?.openedAt)}</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Rapor Saati:</span>
                          <span className="font-mono text-slate-200">{new Date().toLocaleTimeString('tr-TR')}</span>
                        </div>
                        <div className="flex justify-between text-slate-400 pt-2 border-t border-slate-700">
                          <span>Açılış Bakiyesi:</span>
                          <MoneyDisplay amountInCents={activeShift?.expectedAmountCents || 0} />
                        </div>
                        <div className="flex justify-between text-emerald-400">
                          <span>Toplam Satış Hasılatı:</span>
                          <MoneyDisplay amountInCents={xReportSummary.totalSales} />
                        </div>
                        <div className="flex justify-between text-emerald-400">
                          <span>Nakit Girişleri:</span>
                          <MoneyDisplay amountInCents={xReportSummary.totalCashIn} />
                        </div>
                        <div className="flex justify-between text-red-400">
                          <span>Nakit Çıkışları:</span>
                          <MoneyDisplay amountInCents={xReportSummary.totalCashOut} />
                        </div>
                        <div className="flex justify-between text-white font-bold pt-2 border-t border-slate-700 text-base">
                          <span>Kasadaki Beklenen Tutar:</span>
                          <MoneyDisplay amountInCents={xReportSummary.expectedBalance} className="text-blue-400" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-red-400 text-sm py-4">Özet verisi alınamadı.</p>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowXReportModal(false)}
                      className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold transition-colors"
                    >
                      Kapat
                    </button>
                    <button
                      onClick={handlePrintXReport}
                      disabled={!xReportSummary}
                      className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
                    >
                      <Printer size={16} />
                      Yazdır
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* CASH MOVEMENT MODAL (CASH IN / CASH OUT) */}
            {showCashModal && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
                <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl max-w-md w-full animate-in zoom-in-95">
                  <div className="flex items-center gap-4 mb-6">
                    <Banknote
                      size={32}
                      className={showCashModal === 'IN' ? 'text-emerald-400' : 'text-amber-400'}
                    />
                    <div>
                      <h2 className="text-2xl font-bold">
                        Kasa {showCashModal === 'IN' ? 'Girişi (Tahsilat)' : 'Çıkışı (Ödeme/Gider)'}
                      </h2>
                      <p className="text-xs text-slate-400">Nakit hareketini sisteme ve deftere kaydeder.</p>
                    </div>
                  </div>

                  <div className="space-y-4 mb-8">
                    <div>
                      <label className="block text-slate-400 text-sm mb-2 font-medium">Tutar (₺)</label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.01"
                          autoFocus
                          value={cashAmount}
                          onChange={(e) => setCashAmount(e.target.value)}
                          className="w-full p-4 bg-slate-950 border border-slate-700 rounded-xl text-2xl font-mono text-white outline-none focus:border-blue-500 pr-12"
                          placeholder="0.00"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-xl font-bold">
                          ₺
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-slate-400 text-sm mb-2 font-medium">Açıklama / Sebep</label>
                      <input
                        type="text"
                        value={cashReason}
                        onChange={(e) => setCashReason(e.target.value)}
                        className="w-full p-3.5 bg-slate-950 border border-slate-700 rounded-xl text-white outline-none focus:border-blue-500 text-sm"
                        placeholder="Örn: Günlük bozuk para alımı, Avans, Fatura..."
                      />
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button
                      onClick={() => {
                        setShowCashModal(null);
                        setCashAmount('');
                        setCashReason('');
                      }}
                      className="flex-1 py-3.5 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold transition-colors"
                    >
                      İptal
                    </button>
                    <button
                      onClick={handleCashMovementSubmit}
                      disabled={!cashAmount || parseFloat(cashAmount) <= 0 || !cashReason.trim()}
                      className={`flex-1 py-3.5 rounded-xl font-bold transition-colors text-white disabled:opacity-50 ${
                        showCashModal === 'IN'
                          ? 'bg-emerald-600 hover:bg-emerald-500'
                          : 'bg-amber-600 hover:bg-amber-500'
                      }`}
                    >
                      Kaydet & Fiş Kes
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* VOID MODAL */}
            {showVoidModal && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
                <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl max-w-md w-full animate-in zoom-in-95">
                  <div className="flex items-center gap-4 mb-6 text-red-500">
                    <XCircle size={32} />
                    <div>
                      <h2 className="text-2xl font-bold">Hesap İptal / İade (Void)</h2>
                      <p className="text-xs text-slate-400">
                        {selectedTable?.name || selectedTableId} masasındaki açık siparişi iptal eder.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 mb-8">
                    <div>
                      <label className="block text-slate-400 text-sm mb-2 font-medium">İptal Nedeni</label>
                      <input
                        type="text"
                        autoFocus
                        value={voidReason}
                        onChange={(e) => setVoidReason(e.target.value)}
                        className="w-full p-3.5 bg-slate-950 border border-slate-700 rounded-xl text-white outline-none focus:border-red-500 text-sm"
                        placeholder="Örn: Müşteri ayrıldı, Yanlış masa siparişi..."
                      />
                    </div>
                    {(cashierRole === 'CASHIER' || cashierRole === 'WAITER') && (
                      <div>
                        <label className="block text-slate-400 text-sm mb-2 font-medium">Yönetici PIN</label>
                        <input
                          type="password"
                          value={managerPin}
                          onChange={(e) => setManagerPin(e.target.value)}
                          className="w-full p-3.5 bg-slate-950 border border-slate-700 rounded-xl text-white outline-none focus:border-red-500 font-mono tracking-widest text-lg"
                          placeholder="••••"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex gap-4">
                    <button
                      onClick={() => {
                        setShowVoidModal(false);
                        setVoidReason('');
                        setManagerPin('');
                      }}
                      className="flex-1 py-3.5 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold transition-colors"
                    >
                      Vazgeç
                    </button>
                    <button
                      onClick={handleVoidSubmit}
                      disabled={!voidReason.trim() || ((cashierRole === 'CASHIER' || cashierRole === 'WAITER') && !managerPin.trim())}
                      className="flex-1 py-3.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-xl font-bold transition-colors text-white"
                    >
                      İptali Onayla
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* SOL PANEL: AÇIK MASALAR VE İŞLEMLER */}
            <div className="w-1/4 min-w-[300px] border-r border-slate-800 bg-slate-900/50 flex flex-col">
              <div className="p-4 border-b border-slate-800 flex justify-between items-center shrink-0">
                <div>
                  <h2 className="text-lg font-bold tracking-tight">Açık Hesaplar</h2>
                  <p className="text-xs text-slate-400 mt-0.5">{occupiedTables.length} Bekleyen Masa</p>
                </div>
                <button
                  onClick={() => fetchFloorPlan()}
                  className="p-2 bg-slate-800 rounded-lg hover:bg-slate-700 text-slate-300 transition-colors"
                  title="Masaları Yenile"
                >
                  <RefreshCcw size={16} />
                </button>
              </div>

              {/* ARAMA ÇUBUĞU */}
              <div className="px-4 py-3 shrink-0 border-b border-slate-800/60">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                  <input
                    type="text"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    placeholder="Masa ara..."
                    className="w-full pl-9 pr-3 py-2 bg-slate-800/80 border border-slate-700 rounded-lg text-sm text-white outline-none focus:border-blue-500 placeholder-slate-500 transition-all"
                  />
                </div>
              </div>

              {/* MASA LİSTESİ */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {filteredTables.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500 py-12">
                    <CheckCircle2 size={44} className="mb-3 opacity-20" />
                    <p className="text-sm">{tableSearch ? 'Aramayla eşleşen masa yok.' : 'Tüm hesaplar kapalı.'}</p>
                  </div>
                ) : (
                  filteredTables.map((t) => {
                    const isSelected = selectedTableId === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => handleSelectTable(t.id)}
                        className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                          isSelected
                            ? 'bg-blue-900/40 border-blue-500 shadow-lg shadow-blue-900/20 ring-1 ring-blue-500/50'
                            : 'bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/80 hover:border-slate-600'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <MapPin size={16} className={isSelected ? 'text-blue-400' : 'text-slate-400'} />
                            <span className="font-semibold text-base text-white">{t.name}</span>
                          </div>
                          <MoneyDisplay
                            amountInCents={t.currentTotal || 0}
                            className="text-emerald-400 font-mono font-bold text-base"
                          />
                        </div>
                        <div className="flex justify-between items-center text-xs text-slate-400">
                          <div className="flex items-center gap-1">
                            <Clock size={12} />
                            <span>
                              {t.openedAt
                                ? new Date(t.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : 'Açık'}
                            </span>
                          </div>
                          <span>{t.waiterId || 'Kasa'}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* ORTA PANEL: SİPARİŞ KALEMLERİ VE DETAY */}
            <div className="w-1/3 min-w-[340px] border-r border-slate-800 bg-slate-900 flex flex-col">
              <div className="p-5 border-b border-slate-800 flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">
                    {selectedTable ? selectedTable.name : 'Hesap Detayı'}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {selectedTableId ? `${tableItems.length} Kalem Sipariş` : 'Masa seçilmedi'}
                  </p>
                </div>
                <Receipt size={22} className="text-slate-400" />
              </div>

              {/* ÜRÜN LİSTESİ */}
              <div className="flex-1 overflow-y-auto p-4">
                {!selectedTableId ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500 py-12">
                    <Receipt size={56} className="mb-3 opacity-20" />
                    <p className="text-sm text-center">Ödeme almak için sol listeden bir masa seçin.</p>
                  </div>
                ) : isLoadingItems ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 py-12">
                    <RefreshCcw size={28} className="animate-spin mb-3 text-blue-500" />
                    <p className="text-sm">Sipariş yükleniyor...</p>
                  </div>
                ) : tableItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500 py-12">
                    <p className="text-sm">Masada kayıtlı ürün bulunmuyor.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {tableItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between items-center bg-slate-800/60 border border-slate-700/50 p-3.5 rounded-xl"
                      >
                        <div className="pr-3">
                          <div className="font-semibold text-sm text-slate-100">{item.product.name}</div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {item.quantity} adet × <MoneyDisplay amountInCents={item.unitPrice} />
                          </div>
                          {item.note && (
                            <div className="text-[11px] text-amber-400/80 italic mt-0.5 font-sans">
                              Not: {item.note}
                            </div>
                          )}
                        </div>
                        <MoneyDisplay
                          amountInCents={item.total}
                          className="font-mono font-bold text-base text-emerald-400 shrink-0"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ARA TOPLAM VE AKSİYONLAR */}
              {selectedTableId && tableItems.length > 0 && (
                <div className="p-5 bg-slate-800/40 border-t border-slate-800 space-y-2.5 shrink-0">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Ara Toplam (KDV Hariç)</span>
                    <MoneyDisplay amountInCents={tableTotals.subtotal} />
                  </div>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>KDV Tutarı</span>
                    <MoneyDisplay amountInCents={tableTotals.taxTotal} />
                  </div>
                  <div className="flex justify-between text-xl font-bold pt-2.5 border-t border-slate-700 text-white">
                    <span>Ödenecek Toplam</span>
                    <MoneyDisplay amountInCents={grandTotalCents} className="text-emerald-400 font-mono font-bold text-2xl" />
                  </div>

                  {/* FİŞ YAZDIR & VOID BUTONLARI */}
                  <div className="grid grid-cols-2 gap-2.5 pt-2">
                    <button
                      onClick={handlePrintBill}
                      className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                      title="Müşteriye adisyon/hesap fişi yazdır"
                    >
                      <Printer size={15} />
                      Adisyon Fişi
                    </button>
                    <button
                      onClick={() => setShowVoidModal(true)}
                      className="py-2.5 px-3 border border-red-500/40 text-red-400 hover:bg-red-500/10 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                      title="Siparişi iptal et"
                    >
                      <XCircle size={15} />
                      Hesabı İptal Et
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* SAĞ PANEL: TAHSİLAT & NUMPAD */}
            <div className="flex-1 bg-slate-950 flex flex-col p-6 overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">Hızlı Tahsilat</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Nakit veya Kredi Kartı ile ödeme alın</p>
                </div>
                <div className="px-4 py-2 bg-emerald-950/60 border border-emerald-800/60 rounded-xl flex items-center gap-2">
                  <span className="text-xs text-emerald-400 font-medium">Toplam Borç:</span>
                  <MoneyDisplay amountInCents={grandTotalCents} className="text-emerald-400 font-bold text-xl font-mono" />
                </div>
              </div>

              {/* BAŞARILI TAHSİLAT KARTI */}
              {paymentSuccess && (
                <div className="mb-6 p-4 bg-emerald-950/40 border border-emerald-800/70 rounded-2xl flex items-center justify-between animate-in fade-in">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                      <Check size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-emerald-200">
                        {paymentSuccess.tableName} Tahsilatı Tamamlandı!
                      </h4>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">
                        Tutar: <MoneyDisplay amountInCents={paymentSuccess.totalCents} /> • Para Üstü:{' '}
                        <MoneyDisplay amountInCents={paymentSuccess.changeCents} />
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleReprintReceipt}
                    className="px-3 py-2 bg-emerald-800/60 hover:bg-emerald-700/60 text-emerald-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Printer size={14} />
                    Fişi Tekrar Yazdır
                  </button>
                </div>
              )}

              {/* ALINAN VE PARA ÜSTÜ GÖSTERGELERİ */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-center">
                  <span className="text-slate-400 text-xs font-medium mb-1">Müşteriden Alınan Tutar</span>
                  <span className="text-4xl font-mono font-bold text-white tracking-tight">
                    {tenderedAmount ? `${tenderedAmount} ₺` : '0.00 ₺'}
                  </span>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-center">
                  <span className="text-slate-400 text-xs font-medium mb-1">Verilecek Para Üstü</span>
                  <MoneyDisplay
                    amountInCents={changeCents}
                    className="text-4xl font-mono font-bold text-amber-400 tracking-tight"
                  />
                </div>
              </div>

              {/* NUMPAD VE ÖDEME BUTONLARI */}
              <div className="flex-1 grid grid-cols-5 gap-5 min-h-[300px]">
                {/* 3x4 Numpad */}
                <div className="col-span-3 grid grid-cols-3 gap-3">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                    <button
                      key={num}
                      disabled={isSubmittingPayment || !selectedTableId || tableItems.length === 0}
                      onClick={() => handleNumpadPress(num)}
                      className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-2xl font-semibold rounded-xl text-slate-100 active:scale-95 transition-all shadow-sm flex items-center justify-center"
                    >
                      {num}
                    </button>
                  ))}
                  <button
                    onClick={() => handleNumpadPress('C')}
                    disabled={isSubmittingPayment || !selectedTableId || tableItems.length === 0}
                    className="bg-red-950/40 hover:bg-red-900/50 border border-red-900/50 text-red-400 disabled:opacity-40 text-2xl font-bold rounded-xl active:scale-95 transition-all flex items-center justify-center"
                  >
                    C
                  </button>
                  <button
                    onClick={() => handleNumpadPress('0')}
                    disabled={isSubmittingPayment || !selectedTableId || tableItems.length === 0}
                    className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-2xl font-semibold rounded-xl text-slate-100 active:scale-95 transition-all shadow-sm flex items-center justify-center"
                  >
                    0
                  </button>
                  <button
                    onClick={() => handleNumpadPress('.')}
                    disabled={isSubmittingPayment || !selectedTableId || tableItems.length === 0}
                    className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-2xl font-semibold rounded-xl text-slate-100 active:scale-95 transition-all shadow-sm flex items-center justify-center"
                  >
                    .
                  </button>
                </div>

                {/* Sağ Kolon: Hazır Tutarlar & Tam Tutar & Ödeme Tuşları */}
                <div className="col-span-2 flex flex-col gap-3">
                  {/* Preset banknot butonları */}
                  <div className="grid grid-cols-2 gap-2.5">
                    {PRESET_AMOUNTS.map((amount) => (
                      <button
                        key={amount}
                        onClick={() => handleNumpadPress(`PRESET_${amount}`)}
                        disabled={isSubmittingPayment || !selectedTableId || tableItems.length === 0}
                        className="bg-slate-800/80 border border-slate-700 hover:border-emerald-500/50 hover:bg-slate-700 disabled:opacity-40 text-lg font-bold text-emerald-400 rounded-xl py-3 active:scale-95 transition-all"
                      >
                        {amount} ₺
                      </button>
                    ))}
                  </div>

                  {/* Tam Tutar Butonu */}
                  <button
                    onClick={() => {
                      if (grandTotalCents > 0) {
                        setTenderedAmount((grandTotalCents / 100).toFixed(2));
                      }
                    }}
                    disabled={isSubmittingPayment || !selectedTableId || grandTotalCents <= 0}
                    className="bg-slate-800 border border-slate-700 hover:bg-slate-700 disabled:opacity-40 text-sm font-bold text-slate-200 rounded-xl py-3 active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    <span>Tam Tutar</span>
                    <span className="font-mono text-emerald-400">
                      ({(grandTotalCents / 100).toFixed(2)} ₺)
                    </span>
                  </button>

                  {/* NAKİT VE KREDİ KARTI ÖDEME BUTONLARI */}
                  <div className="mt-auto grid grid-cols-1 gap-3">
                    <button
                      onClick={() => handleSubmitPayment('CASH')}
                      disabled={
                        isSubmittingPayment ||
                        !selectedTableId ||
                        grandTotalCents <= 0 ||
                        (tenderedCents > 0 && tenderedCents < grandTotalCents)
                      }
                      className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-2xl py-5 flex items-center justify-center gap-3 text-xl font-bold active:scale-95 transition-all shadow-lg shadow-emerald-950/40"
                    >
                      <Banknote size={26} />
                      <span>Nakit Tahsilat</span>
                    </button>
                    <button
                      onClick={() => handleSubmitPayment('CREDIT_CARD')}
                      disabled={
                        isSubmittingPayment ||
                        !selectedTableId ||
                        grandTotalCents <= 0 ||
                        (tenderedCents > 0 && tenderedCents < grandTotalCents)
                      }
                      className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-2xl py-5 flex items-center justify-center gap-3 text-xl font-bold active:scale-95 transition-all shadow-lg shadow-blue-950/40"
                    >
                      <CreditCard size={26} />
                      <span>Kredi Kartı</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ==================== VARDİYA GEÇMİŞİ TAB ==================== */}
        {activeTab === 'GECMIS' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Z-REPORT MODAL */}
            {zReportShift && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
                <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl max-w-lg w-full animate-in zoom-in-95">
                  <div className="flex items-center gap-4 mb-6">
                    <FileText size={32} className="text-blue-400" />
                    <div>
                      <h2 className="text-2xl font-bold">Z-Raporu Mutabakatı</h2>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">Vardiya ID: {zReportShift.id}</p>
                    </div>
                  </div>

                  {zReportLoading ? (
                    <div className="py-12 flex justify-center text-slate-400">
                      <RefreshCcw size={24} className="animate-spin text-blue-500" />
                    </div>
                  ) : zReportSummary ? (
                    <div className="space-y-3 text-sm mb-6">
                      <div className="grid grid-cols-2 gap-2 bg-slate-800/80 p-4 rounded-xl border border-slate-700 text-xs">
                        <div className="text-slate-400">Açılış Zamanı:</div>
                        <div className="text-right font-mono text-slate-200">{fmtDate(zReportShift.openedAt)}</div>
                        <div className="text-slate-400">Kapanış Zamanı:</div>
                        <div className="text-right font-mono text-slate-200">{fmtDate(zReportShift.closedAt)}</div>
                        <div className="text-slate-400">Açılış Bakiyesi:</div>
                        <div className="text-right font-mono text-slate-200">
                          <MoneyDisplay amountInCents={zReportShift.expectedAmountCents} />
                        </div>
                      </div>

                      <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700 space-y-2">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Toplam Satış (Sistem):</span>
                          <MoneyDisplay amountInCents={zReportSummary.totalSales} className="text-emerald-400 font-bold" />
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Nakit Girişleri (+):</span>
                          <MoneyDisplay amountInCents={zReportSummary.totalCashIn} className="text-emerald-400" />
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Nakit Çıkışları (-):</span>
                          <MoneyDisplay amountInCents={zReportSummary.totalCashOut} className="text-red-400" />
                        </div>
                        <div className="flex justify-between border-t border-slate-700 pt-2 font-semibold">
                          <span className="text-slate-300">Beklenen Kapanış Kasası:</span>
                          <MoneyDisplay amountInCents={zReportSummary.expectedBalance} className="text-white" />
                        </div>
                        {zReportShift.actualAmountCents != null && (
                          <div className="flex justify-between font-semibold">
                            <span className="text-slate-300">Sayılan Fiili Kapanış:</span>
                            <MoneyDisplay amountInCents={zReportShift.actualAmountCents} className="text-white" />
                          </div>
                        )}
                        <div
                          className={`flex justify-between border-t border-slate-700 pt-2 font-bold text-base ${
                            zReportSummary.discrepancy < 0
                              ? 'text-red-400'
                              : zReportSummary.discrepancy > 0
                              ? 'text-emerald-400'
                              : 'text-slate-300'
                          }`}
                        >
                          <span>Kasa Mutabakat Farkı:</span>
                          <MoneyDisplay amountInCents={zReportSummary.discrepancy} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-red-400 text-center py-6 text-sm">Z-Raporu özeti yüklenemedi.</div>
                  )}

                  <div className="flex gap-4">
                    <button
                      onClick={() => {
                        setZReportShift(null);
                        setZReportSummary(null);
                      }}
                      className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold transition-colors text-sm"
                    >
                      Kapat
                    </button>
                    <button
                      onClick={handlePrintZReport}
                      disabled={!zReportSummary}
                      className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl font-bold text-white flex items-center justify-center gap-2 transition-colors text-sm"
                    >
                      <Printer size={16} />
                      Yazdır
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* VARDİYA GEÇMİŞİ BAŞLIĞI */}
            <div className="p-6 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Kasa Vardiya Geçmişi</h2>
                <p className="text-xs text-slate-400 mt-1">Son açılan ve kapatılan vardiya kayıtları</p>
              </div>
              <button
                onClick={loadShiftHistory}
                className="p-2.5 bg-slate-800 rounded-lg hover:bg-slate-700 text-slate-300 transition-colors"
                title="Yenile"
              >
                <RefreshCcw size={16} />
              </button>
            </div>

            {/* TABLO */}
            <div className="flex-1 overflow-y-auto p-6">
              {historyLoading ? (
                <div className="flex items-center justify-center h-40 text-slate-400 gap-2">
                  <RefreshCcw size={20} className="animate-spin text-blue-500" />
                  <span>Vardiya kayıtları yükleniyor...</span>
                </div>
              ) : shiftHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-slate-500">
                  <History size={44} className="mb-3 opacity-20" />
                  <p className="text-sm">Henüz vardiya geçmişi kaydı bulunmuyor.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-400 border-b border-slate-800 text-xs">
                        <th className="pb-3 pr-4 font-semibold">Açılış / Kapanış</th>
                        <th className="pb-3 pr-4 font-semibold">Durum</th>
                        <th className="pb-3 pr-4 font-semibold text-right">Açılış Kasası</th>
                        <th className="pb-3 pr-4 font-semibold text-right">Kapanış Sayımı</th>
                        <th className="pb-3 pr-4 font-semibold text-right">Fark</th>
                        <th className="pb-3 font-semibold text-right">Rapor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {shiftHistory.map((shift) => {
                        const diff = shift.differenceCents ?? 0;
                        const isClosed = shift.status === 'CLOSED';
                        return (
                          <tr key={shift.id} className="hover:bg-slate-800/30 transition-colors">
                            <td className="py-4 pr-4">
                              <div className="font-mono text-slate-200 text-xs">{fmtDate(shift.openedAt)}</div>
                              {shift.closedAt && (
                                <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                                  {fmtDate(shift.closedAt)}
                                </div>
                              )}
                            </td>
                            <td className="py-4 pr-4">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                  isClosed
                                    ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                    : 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                                }`}
                              >
                                {isClosed ? 'KAPALI' : 'AÇIK'}
                              </span>
                            </td>
                            <td className="py-4 pr-4 text-right font-mono text-slate-200">
                              <MoneyDisplay amountInCents={shift.expectedAmountCents} />
                            </td>
                            <td className="py-4 pr-4 text-right font-mono text-slate-200">
                              {shift.actualAmountCents != null ? (
                                <MoneyDisplay amountInCents={shift.actualAmountCents} />
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>
                            <td className="py-4 pr-4 text-right font-mono font-semibold">
                              {isClosed && shift.differenceCents != null ? (
                                <span
                                  className={
                                    diff < 0 ? 'text-red-400' : diff > 0 ? 'text-emerald-400' : 'text-slate-400'
                                  }
                                >
                                  {diff > 0 ? '+' : ''}
                                  <MoneyDisplay amountInCents={diff} />
                                </span>
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>
                            <td className="py-4 text-right">
                              {isClosed ? (
                                <button
                                  onClick={() => handleOpenZReport(shift)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-900/30 text-blue-400 border border-blue-900/50 rounded-lg hover:bg-blue-900/50 text-xs font-semibold transition-colors"
                                >
                                  <FileText size={13} />
                                  Z-Raporu
                                </button>
                              ) : (
                                <span className="text-slate-600 text-xs">—</span>
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
