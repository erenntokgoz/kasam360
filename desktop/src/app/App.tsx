import React, { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useUIStore } from '../stores/uiStore';
import { TopStatusBar } from '../features/shell/TopStatusBar';
import { SidebarNav } from '../features/shell/SidebarNav';
import { FloorModule } from '../features/floor/FloorModule';
import { PosModule } from '../features/pos/PosModule';
import { KdsModule } from '../features/kds/KdsModule';
import { CashierModule } from '../features/cashier/CashierModule';
import { ErpModule } from '../features/patron/ErpModule';
import { LoginOverlay } from '../features/auth/LoginOverlay';
import { MustChangePinModal } from '../features/auth/MustChangePinModal';
import { ShiftGateModal } from '../features/shift/ShiftGateModal';
import { PaymentModal } from '../features/payment/PaymentModal';
import { ReceiptPreviewModal } from '../features/receipt/ReceiptPreviewModal';

export const App: React.FC = () => {
  const { isAuthenticated, isLocked, mustChangePin, lock, user } = useAuthStore();
  const {
    activeModule,
    setActiveModule,
    idleSecondsLeft,
    decrementIdleTimer,
    resetIdleTimer,
  } = useUIStore();

  // 120 saniye hareketsizlik sayacı ve otomatik kilit
  useEffect(() => {
    if (!isAuthenticated || isLocked) return;

    const interval = setInterval(() => {
      decrementIdleTimer();
    }, 1000);

    return () => clearInterval(interval);
  }, [isAuthenticated, isLocked, decrementIdleTimer]);

  useEffect(() => {
    if (idleSecondsLeft === 0 && isAuthenticated && !isLocked) {
      lock();
    }
  }, [idleSecondsLeft, isAuthenticated, isLocked, lock]);

  // Kullanıcı etkileşimi dinleyicisi: Fare ve klavye hareketinde sayaç sıfırlanır
  useEffect(() => {
    const handleActivity = () => {
      resetIdleTimer();
    };

    window.addEventListener('pointerdown', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('touchstart', handleActivity);

    return () => {
      window.removeEventListener('pointerdown', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
    };
  }, [resetIdleTimer]);

  // Donanım Kısayolları (F1 - F5)
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if (!isAuthenticated || isLocked || mustChangePin) return;
      if (e.key === 'F1') {
        e.preventDefault();
        setActiveModule('FLOOR');
      } else if (e.key === 'F2') {
        e.preventDefault();
        setActiveModule('POS');
      } else if (e.key === 'F3') {
        e.preventDefault();
        setActiveModule('KDS');
      } else if (e.key === 'F4') {
        e.preventDefault();
        setActiveModule('CASHIER');
      } else if (e.key === 'F5' && (user?.role === 'OWNER' || user?.role === 'MASTER')) {
        e.preventDefault();
        setActiveModule('ERP');
      }
    };

    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [setActiveModule, user?.role, isAuthenticated, isLocked, mustChangePin]);

  if (!isAuthenticated || isLocked || mustChangePin) {
    return (
      <div className="h-screen w-screen bg-[var(--bg-canvas)]">
        <LoginOverlay />
        <MustChangePinModal />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)] select-none">
      {/* 1. Üst Durum Çubuğu */}
      <TopStatusBar />

      {/* 2. Ana Çalışma Alanı: Sol 72px Donanım Menüsü + Merkez Modül */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        <SidebarNav />

        <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
          {/* Zero-latency modül geçişi: açık sepeti, filtreleri ve krokiyi korumak için sekmeler canlı kalır */}
          <div className={`flex-1 flex flex-col h-full overflow-hidden ${activeModule === 'FLOOR' ? '' : 'hidden'}`}>
            <FloorModule />
          </div>

          <div className={`flex-1 flex flex-col h-full overflow-hidden ${activeModule === 'POS' ? '' : 'hidden'}`}>
            <PosModule />
          </div>

          <div className={`flex-1 flex flex-col h-full overflow-hidden ${activeModule === 'KDS' ? '' : 'hidden'}`}>
            <KdsModule />
          </div>

          <div className={`flex-1 flex flex-col h-full overflow-hidden ${activeModule === 'CASHIER' ? '' : 'hidden'}`}>
            <CashierModule />
          </div>

          <div className={`flex-1 flex flex-col h-full overflow-hidden ${activeModule === 'ERP' ? '' : 'hidden'}`}>
            <ErpModule />
          </div>
        </main>
      </div>

      {/* 3. Global Modal ve Katmanlar */}
      <LoginOverlay />
      <MustChangePinModal />
      <ShiftGateModal />
      <PaymentModal />
      <ReceiptPreviewModal />
    </div>
  );
};
