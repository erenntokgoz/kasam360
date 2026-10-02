import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { tauriInvoke as invoke } from '../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../store/useAuthStore';
import { usePermission } from '../../hooks/usePermission';
import { QuickTransactionModal, QuickTransactionType } from './ui/QuickTransactionModal';
import { DirectoriesTab } from './ui/DirectoriesTab';
import { DebtsBalanceTab } from './ui/DebtsBalanceTab';
import { ExpensesTab } from './ui/ExpensesTab';
import { FinancialReportsTab } from './ui/FinancialReportsTab';
import { NetBalanceStrip } from './ui/NetBalanceStrip';
import { BudgetAlerts, BudgetStatus } from './ui/BudgetAlerts';
import { RecurringSchedule, RecurringDue } from './ui/RecurringSchedule';
import { ProfitAndLoss } from './ui/ProfitAndLoss';
import { CashReconciliation } from './ui/CashReconciliation';
import { LedgerReceiptMovements } from '../ledger/LedgerReceiptMovements';
import { HeaderActions } from './ui/HeaderActions';
import { TabBar } from './ui/TabBar';
import { ScoreCards } from './ui/ScoreCards';
import { PaymentDistribution } from './ui/PaymentDistribution';
import { ShiftBoard } from './ui/ShiftBoard';
import { DayClosePanel } from './ui/DayClosePanel';
import { ArchivePanel } from './ui/ArchivePanel';
import { CloseDayModal } from './ui/CloseDayModal';
import { ZReportModal } from './ui/ZReportModal';
import { useEndOfDayData, notifySafe } from './useEndOfDayData';
import type { TabType, CloseDayResultDto, ShiftHistoryDto } from './types';

export type {
  DailySummaryDto,
  OpenShiftDto,
  ShiftHistoryDto,
  CloseDayResultDto,
  TabType,
  EndOfDayContainerProps,
  ShiftRow,
} from './types';

/**
 * Hesap Defteri (Gün Sonu) & Kasa Vardiya Çizelgesi Ekranı.
 * AGENTS.md gereksinimlerine uygun olarak #060609 zemin üzerinde bağımsız,
 * yumuşak kenarlı (rounded-3xl) renksiz şeffaf cam (Frosted Glass) adalar mimarisiyle çalışır.
 */
export const EndOfDayContainer: React.FC<{
  initialLoading?: boolean;
  initialSummary?: import('./types').DailySummaryDto;
  initialOpenShifts?: import('./types').OpenShiftDto[];
  initialShiftHistory?: import('./types').ShiftHistoryDto[];
}> = ({ initialLoading = false, initialSummary, initialOpenShifts, initialShiftHistory } = {}) => {
  const user = useAuthStore((state) => state.user);
  const actorRole = user?.role ?? 'Cashier';
  const actorName = user?.name ?? 'Yetkili';
  const tenantId = user?.tenantId ?? 'DEFAULT_TENANT';
  // P&L sekmesi ayrı bir yetki satırına bağlıdır; defterin kendisi kısmi erişime açık
  const canSeeFinancialReports = usePermission().can('reportsAccess');

  const [activeTab, setActiveTab] = useState<TabType>('GUNUN_DEFTERI');
  const [showConfirmCloseModal, setShowConfirmCloseModal] = useState(false);
  const [showZReportModal, setShowZReportModal] = useState(false);
  const [selectedZReportShift, setSelectedZReportShift] = useState<ShiftHistoryDto | null>(null);
  const [isClosingDay, setIsClosingDay] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [lastClosedResult, setLastClosedResult] = useState<CloseDayResultDto | null>(null);
  const [quickModalType, setQuickModalType] = useState<QuickTransactionType | null>(null);
  const [budgetItems, setBudgetItems] = useState<BudgetStatus[]>([]);
  const [recurringItems, setRecurringItems] = useState<RecurringDue[]>([]);

  const addToast = useCallback(
    (msg: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => notifySafe(msg, type),
    []
  );

  const {
    openShifts,
    shiftHistory,
    loading,
    refreshing,
    historyLoading,
    error,
    historySearch,
    setHistorySearch,
    openTables,
    totals,
    paymentPercentages,
    shiftRows,
    filteredHistory,
    reload,
    reloadHistory,
  } = useEndOfDayData({
    actorRole,
    initialLoading,
    initialSummary,
    initialOpenShifts,
    initialShiftHistory,
    onNotify: addToast,
  });

  // Bütçe ve tekrarlayan gider verisi yalnız Gider Defteri sekmesinde gerekir.
  useEffect(() => {
    if (activeTab !== 'GIDER_DEFTERI') return;
    let cancelled = false;

    const loadSideData = async () => {
      try {
        const [budgetData, recurringData] = await Promise.all([
          invoke<BudgetStatus[]>('get_budget_status', {}),
          invoke<RecurringDue[]>('get_recurring_expenses', {}),
        ]);
        if (cancelled) return;
        setBudgetItems(Array.isArray(budgetData) ? budgetData : []);
        setRecurringItems(Array.isArray(recurringData) ? recurringData : []);
      } catch (e) {
        if (!cancelled) addToast(`Butce verisi alinamadi: ${String(e)}`, 'error');
      }
    };

    loadSideData();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Arşiv sekmesine geçildiğinde verileri güncelle
  useEffect(() => {
    if (activeTab === 'GECMIS_ARSIV') {
      reloadHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const openDayZReport = useCallback(() => {
    setSelectedZReportShift(null);
    setShowZReportModal(true);
  }, []);

  // Günün Defter Kapanışı & Mühürleme İşlemi (close_day)
  const handleCloseDay = async () => {
    setIsClosingDay(true);
    try {
      const result = await invoke<CloseDayResultDto>('close_day', {
        actorRole,
        actorId: user?.userId,
      });

      setLastClosedResult(result);
      setShowConfirmCloseModal(false);
      addToast(result?.message || 'Hesap defteri başarıyla kapatıldı ve mühürlendi.', 'success');

      await reload(true);
      await reloadHistory();

      openDayZReport();
    } catch (e) {
      console.error('Hesap defteri mühürlenemedi:', e);
      addToast(`Hesap defteri mühürlenemedi: ${String(e)}`, 'error');
    } finally {
      setIsClosingDay(false);
    }
  };

  // ESC/POS termal basım. Faz 7: içerik istemciden gönderilmez; vardiya veya gün
  // belgesi veritabanındaki kayıtlardan basılır.
  const handlePrintZReport = async (shiftOverride?: ShiftHistoryDto | null) => {
    setIsPrinting(true);

    try {
      if (shiftOverride) {
        await invoke('print_z_report', { shiftId: shiftOverride.id, actorRole, tenantId });
      } else {
        await invoke('print_day_z_report', { actorRole, tenantId });
      }
      addToast('Mali Z-Raporu başarıyla termal yazıcıya gönderildi.', 'success');
    } catch (e) {
      console.error('Yazıcı hatası:', e);
      addToast('Yazıcıya gönderme başarısız oldu.', 'error');
    } finally {
      setIsPrinting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center dark:bg-[#060609] bg-[#f5f5f7] dark:text-white text-zinc-900">
        <div className="flex flex-col items-center space-y-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#007AFF]/30 border-t-[#007AFF] shadow-xl" />
          <p className="dark:text-zinc-400 text-zinc-600 font-medium tracking-wide">Hesap Defteri yükleniyor...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center dark:bg-[#060609] bg-[#f5f5f7] dark:text-white text-zinc-900 p-6">
        <div className="max-w-md w-full backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 text-center shadow-xl">
          <AlertCircle size={44} className="text-[#FF3B30] mx-auto mb-3" />
          <h2 className="text-lg font-semibold dark:text-white text-zinc-900 mb-2">Defter Verileri Alınamadı</h2>
          <p className="dark:text-zinc-400 text-zinc-600 text-sm mb-6">{error}</p>
          <button
            type="button"
            onClick={() => reload()}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl text-sm font-semibold bg-[#007AFF] hover:bg-[#0071E3] text-white shadow-lg shadow-[#007AFF]/20 active:scale-[0.98] transition-all cursor-pointer"
          >
            <RefreshCw size={16} />
            <span>Tekrar Dene</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col dark:bg-[#060609] bg-[#f5f5f7] dark:text-white text-zinc-900 p-4 md:p-8 overflow-y-auto selection:bg-[#007AFF]/20">
      <HeaderActions
        tenantId={tenantId}
        actorName={actorName}
        actorRole={actorRole}
        refreshing={refreshing}
        onQuickAction={setQuickModalType}
        onRefresh={() => reload(true)}
        onOpenZReport={openDayZReport}
      />

      <TabBar
        activeTab={activeTab}
        onChange={setActiveTab}
        openShiftCount={openShifts.length}
        shiftHistoryCount={shiftHistory.length}
        canSeeFinancialReports={canSeeFinancialReports}
      />

      {/* SEKME 1: GÜNÜN DEFTERİ (KASA & VARDİYALAR) */}
      {activeTab === 'GUNUN_DEFTERI' && (
        <div className="space-y-6">
          <ScoreCards
            totalRevenue={totals.totalRevenue}
            totalOrders={totals.totalOrders}
            cashTotal={totals.cashTotal}
            cardTotal={totals.cardTotal}
            averageOrderCents={totals.averageOrderCents}
          />

          {/* Finansal Hareketler & Fiş Görüntüleyici — Faz 7: fiş ayrı ekran değil,
              tahsilat satırından açılan bir penceredir. */}
          <div className="mb-6">
            <LedgerReceiptMovements
              onNotify={(message, tone) => addToast(message, tone === 'success' ? 'success' : 'error')}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <PaymentDistribution
                totalRevenue={totals.totalRevenue}
                cashTotal={totals.cashTotal}
                cardTotal={totals.cardTotal}
                otherTotal={totals.otherTotal}
                percentages={paymentPercentages}
              />

              <ShiftBoard rows={shiftRows} openShiftCount={openShifts.length} />
            </div>

            <DayClosePanel
              openTables={openTables}
              openShiftCount={openShifts.length}
              cashTotal={totals.cashTotal}
              lastClosedResult={lastClosedResult}
              isClosingDay={isClosingDay}
              onOpenConfirm={() => setShowConfirmCloseModal(true)}
              onOpenZReport={openDayZReport}
            />
          </div>
        </div>
      )}

      {/* SEKME 2: GEÇMİŞ DEFTER KAYITLARI (ARŞİV) */}
      {activeTab === 'GECMIS_ARSIV' && (
        <ArchivePanel
          search={historySearch}
          onSearchChange={setHistorySearch}
          loading={historyLoading}
          onRefresh={() => reloadHistory()}
          rows={filteredHistory}
          onInspect={(shift) => {
            setSelectedZReportShift(shift);
            setShowZReportModal(true);
          }}
          onPrint={(shift) => handlePrintZReport(shift)}
        />
      )}

      {activeTab === 'CARI_REHBERLER' && <DirectoriesTab />}
      {activeTab === 'BORC_ALACAK' && (
        <div className="space-y-4">
          <NetBalanceStrip />
          <DebtsBalanceTab />
        </div>
      )}
      {activeTab === 'GIDER_DEFTERI' && (
        <div className="space-y-4">
          <ExpensesTab onOpenNewExpense={() => setQuickModalType('GIDER')} />
          <BudgetAlerts items={budgetItems} />
          <RecurringSchedule
            items={recurringItems}
            onPrint={(item) => addToast(`${item.title} yazdirma kuyruguna alindi.`, 'info')}
          />
        </div>
      )}
      {canSeeFinancialReports && activeTab === 'FINANSAL_RAPORLAR' && (
        <div className="space-y-4">
          <ProfitAndLoss
            onNotify={(message, tone) => addToast(message, tone === 'success' ? 'success' : 'error')}
          />
          <CashReconciliation rows={shiftRows} />
          <FinancialReportsTab />
        </div>
      )}

      {showConfirmCloseModal && (
        <CloseDayModal
          openTables={openTables}
          openShiftCount={openShifts.length}
          cashTotal={totals.cashTotal}
          cardTotal={totals.cardTotal}
          totalRevenue={totals.totalRevenue}
          isClosingDay={isClosingDay}
          onClose={() => setShowConfirmCloseModal(false)}
          onConfirm={handleCloseDay}
        />
      )}

      {showZReportModal && (
        <ZReportModal
          shift={selectedZReportShift}
          tenantId={tenantId}
          actorName={actorName}
          actorRole={actorRole}
          totalOrders={totals.totalOrders}
          totalRevenue={totals.totalRevenue}
          cashTotal={totals.cashTotal}
          cardTotal={totals.cardTotal}
          otherTotal={totals.otherTotal}
          isPrinting={isPrinting}
          onClose={() => setShowZReportModal(false)}
          onPrint={handlePrintZReport}
        />
      )}

      {quickModalType && (
        <QuickTransactionModal
          type={quickModalType}
          isOpen={true}
          onClose={() => setQuickModalType(null)}
          onSuccess={() => {
            reload(true);
            addToast('İşlem başarıyla kaydedildi.', 'success');
          }}
        />
      )}
    </div>
  );
};

export default EndOfDayContainer;
