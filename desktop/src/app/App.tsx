import { canOpenModule, homeModule } from '../lib/roleAccess';
import React, { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useUIStore } from '../stores/uiStore';
import { SidebarNav } from '../features/shell/SidebarNav';
import { FloorModule } from '../features/floor/FloorModule';
import { PosModule } from '../features/pos/PosModule';
import { KdsModule } from '../features/kds/KdsModule';
import { CashierModule } from '../features/cashier/CashierModule';
import { CatalogModule } from '../features/patron/CatalogModule';
import { ErpModule } from '../features/patron/ErpModule';
import { SettingsTab } from '../features/patron/settings/SettingsTab';
import { LoginOverlay } from '../features/auth/LoginOverlay';
import { LockScreen } from '../features/auth/LockScreen';
import { AccountGate } from '../features/auth/AccountGate';
import { useDeviceSessionStore } from '../stores/deviceSessionStore';
import { LicenseGate } from '../features/license/LicenseGate';
import { isUsable, licensedModules, useLicenseStore } from '../stores/licenseStore';
import { useFeatureStore } from '../stores/featureStore';
import { SetupGate } from '../features/setup/SetupGate';
import { useSetupStore } from '../stores/setupStore';
import { MustChangePinModal } from '../features/auth/MustChangePinModal';
import { ShiftGateModal } from '../features/shift/ShiftGateModal';
import { PaymentModal } from '../features/payment/PaymentModal';
import { ReceiptPreviewModal } from '../features/receipt/ReceiptPreviewModal';
import { canUseOperations } from './access';

export const App: React.FC = () => {
  const { isAuthenticated, isLocked, mustChangePin, lock, logout, user } = useAuthStore();
  const activeModule = useUIStore((state) => state.activeModule);
  const setActiveModule = useUIStore((state) => state.setActiveModule);
  const idleSecondsLeft = useUIStore((state) => state.idleSecondsLeft);
  const idleLimitSeconds = useUIStore((state) => state.idleLimitSeconds);
  const decrementIdleTimer = useUIStore((state) => state.decrementIdleTimer);
  const resetIdleTimer = useUIStore((state) => state.resetIdleTimer);
  const { phase: setupPhase, error: setupError, load: loadSetup } = useSetupStore();
  const { session: deviceSession, error: deviceError, load: loadDeviceSession } = useDeviceSessionStore();

  // Kurulum durumu bilinmeden hiçbir kimlik ekranı açılmaz.
  useEffect(() => {
    void loadSetup();
  }, [loadSetup]);

  useEffect(() => {
    if (setupPhase === 'COMPLETE') void loadDeviceSession();
  }, [setupPhase, loadDeviceSession]);

  // Lisans önce cihazdaki belgeden okunur, sonra sunucudan yenilenir; kasa internetsizse
  // eldeki belgeyle açılır. Açık kaldıkça altı saatte bir yenilenir.
  const { status: license, error: licenseError, load: loadLicense, refresh: refreshLicense } = useLicenseStore();
  const deviceSignedIn = !!deviceSession?.signedIn;
  useEffect(() => {
    if (!deviceSignedIn) return;
    void loadLicense().then(() => refreshLicense());
    const timer = window.setInterval(() => void refreshLicense(), 6 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [deviceSignedIn, loadLicense, refreshLicense]);

  // Paket değişirse açık oturumun özellikleri de hemen güncellenir.
  useEffect(() => {
    if (user) useFeatureStore.getState().setModules(licensedModules(user.activeModules ?? [], user.role, license));
  }, [user, license]);

  // Hareketsizlik sayacı ve otomatik kilit. Süre sıfırsa personel oturumu kalıcıdır.
  useEffect(() => {
    if (!isAuthenticated || isLocked || idleLimitSeconds === 0) return;

    const interval = setInterval(() => {
      decrementIdleTimer();
    }, 1000);

    return () => clearInterval(interval);
  }, [isAuthenticated, isLocked, idleLimitSeconds, decrementIdleTimer]);

  useEffect(() => {
    if (idleLimitSeconds > 0 && idleSecondsLeft === 0 && isAuthenticated && !isLocked) {
      lock();
    }
  }, [idleSecondsLeft, idleLimitSeconds, isAuthenticated, isLocked, lock]);

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

  // Rolün göremediği ekran açık kalmaz: önceki kullanıcıdan kalan seçim veya kısayol
  // mutfak ya da garsonu kasaya götürmemelidir.
  useEffect(() => {
    if (user && !canOpenModule(user.role, activeModule)) setActiveModule(homeModule(user.role));
  }, [user, activeModule, setActiveModule]);

  // Donanım Kısayolları (F1 - F6)
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if (!isAuthenticated || isLocked || mustChangePin || !canUseOperations(user?.role)) return;
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
      } else if (e.key === 'F5' && (user?.role === 'OWNER' || user?.role === 'MANAGER' || user?.role === 'MASTER')) {
        e.preventDefault();
        setActiveModule('ERP');
      } else if (e.key === 'F6' && user && canOpenModule(user.role, 'SETTINGS')) {
        e.preventDefault();
        setActiveModule('SETTINGS');
      }
    };

    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [setActiveModule, user?.role, isAuthenticated, isLocked, mustChangePin]);

  if (setupPhase !== 'COMPLETE') {
    return <SetupGate phase={setupPhase} error={setupError} onRetry={() => void loadSetup()} />;
  }

  // Durum bilinmeden PIN ekranı açılmaz: kapalı cihaz açık sayılamaz.
  if (!deviceSession?.signedIn) {
    if (!deviceSession && !deviceError) return <div className="h-full w-full bg-[var(--bg-canvas)]" aria-busy="true" />;
    return <AccountGate />;
  }

  // Geçerli lisans yoksa personel ekranı açılmaz; durum okunmadan da açık sayılmaz.
  if (!isUsable(license) && user?.role !== 'MASTER') {
    if (!license && !licenseError) return <div className="h-full w-full bg-[var(--bg-canvas)]" aria-busy="true" />;
    return <LicenseGate />;
  }

  if (!isAuthenticated || mustChangePin) {
    return (
      <div className="h-full w-full bg-[var(--bg-canvas)]">
        <LoginOverlay />
        <MustChangePinModal />
        <LockScreen />
      </div>
    );
  }

  if (!canUseOperations(user?.role)) {
    return (
      <div className="h-full w-full bg-[var(--bg-canvas)] text-[var(--text-primary)] flex items-center justify-center p-6">
        <div className="bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg p-6 max-w-sm space-y-4">
          <h1 className="text-base font-bold">Platform hesabı</h1>
          <p className="text-sm text-[var(--text-secondary)]">Bu hesapla satış ve işletme ekranları açılamaz.</p>
          <button type="button" onClick={logout} className="tactile-btn min-h-12 px-4 rounded-lg bg-[var(--brand)] text-white">
            Çıkış Yap
          </button>
        </div>
      </div>
    );
  }

  // React 18 tiplerinde `inert` yok; öznitelik DOM'a olduğu gibi geçer.
  const lockedProps = (isLocked ? { inert: '' } : {}) as React.HTMLAttributes<HTMLDivElement>;

  return (
    <div className="h-full w-full overflow-hidden bg-[var(--bg-canvas)]">
    {/* Kilit oturumu kapatmaz: açık ekranlar ve sepet korunur, ama erişilemez olur. */}
    <div {...lockedProps} className="flex flex-col h-full w-full overflow-hidden text-[var(--text-primary)] select-none">
      {/* Ana Çalışma Alanı: Sol Menü + Merkez Modül */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        <SidebarNav />

        <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
          {/* Zero-latency modül geçişi: açık sepeti, filtreleri ve krokiyi korumak için sekmeler canlı kalır */}
          <div className={`flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden ${activeModule === 'FLOOR' ? 'motion-panel' : 'hidden'}`}>
            <FloorModule />
          </div>

          <div className={`flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden ${activeModule === 'POS' ? 'motion-panel' : 'hidden'}`}>
            <PosModule />
          </div>

          <div className={`flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden ${activeModule === 'KDS' ? 'motion-panel' : 'hidden'}`}>
            <KdsModule />
          </div>

          <div className={`flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden ${activeModule === 'CASHIER' ? 'motion-panel' : 'hidden'}`}>
            <CashierModule />
          </div>

          <div className={`flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden ${activeModule === 'ERP' ? 'motion-panel' : 'hidden'}`}>
            <ErpModule />
          </div>

          <div className={`flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden ${activeModule === 'CATALOG' ? 'motion-panel' : 'hidden'}`}>
            {canOpenModule(user?.role, 'CATALOG') ? <CatalogModule /> : null}
          </div>

          <div className={`flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden ${activeModule === 'SETTINGS' ? 'motion-panel' : 'hidden'}`}>
            {canOpenModule(user?.role, 'SETTINGS') ? <SettingsTab /> : null}
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
    <LockScreen />
    </div>
  );
};
