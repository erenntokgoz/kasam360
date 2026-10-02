import { useEffect, useRef } from 'react';
import { DynamicIslandToaster } from './core/components/ui/DynamicIslandToaster';
import { POSLayout } from './presentation/components/pos/ui/POSLayout';
import { CartContainer } from './presentation/components/pos/CartContainer';
import { CatalogContainer } from './presentation/components/pos/CatalogContainer';
import { PaymentModalContainer } from './presentation/components/pos/PaymentModalContainer';
import { useCartStore } from './presentation/store/useCartStore';
import { FloorPlanContainer } from './presentation/components/floor/FloorPlanContainer';
import { ManagementContainer } from './presentation/components/management/ManagementContainer';
import { KdsContainer } from './presentation/components/kds/KdsContainer';
import { EndOfDayContainer } from './presentation/components/endofday/EndOfDayContainer';
import { AppShell } from './presentation/components/layout/AppShell';
import { LoginPage } from './presentation/components/auth/LoginPage';
import { LockPage } from './presentation/components/auth/PinScreen';
import { useAuthStore } from './presentation/store/useAuthStore';
import { OwnerDashboardContainer } from './presentation/components/owner/OwnerDashboardContainer';
import { CashierWorkstationContainer } from './presentation/components/cashier/CashierWorkstationContainer';
import { PlatformContainer } from './presentation/components/platform/PlatformContainer';
import { ImpersonationBanner } from './presentation/components/platform/ImpersonationBanner';
import { accessibleViews, defaultViewFor } from './core/security/navigationMatrix';
import { useAutoLock } from './presentation/hooks/useAutoLock';

export default function App(): JSX.Element {
  // 2 dakika boyunca işlem yapılmadığında ortak terminali otomatik kilitle
  useAutoLock();

  const currentView = useCartStore((state) => state.currentView);
  const navigate = useCartStore((state) => state.navigate);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLocked = useAuthStore((state) => state.isLocked);
  const user = useAuthStore((state) => state.user);

  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isAuthenticated && user && !isLocked) {
      // Ekran erişimi ve ana ekran seçimi tek kaynaktan gelir: SPEC §34 matrisi
      const allowedViews = accessibleViews(user.role);
      const defaultView = defaultViewFor(user.role) ?? 'FLOOR';

      // Yeni kullanıcı oturum açtığında rolüne atanmış ana çalışma ekranına yönlendir
      if (lastUserIdRef.current !== user.userId) {
        lastUserIdRef.current = user.userId;
        // Canlı gözlemci oturumunda hedef ekran belirlenmişse defaultView ile ezilmesini önle
        if (!user.userId.startsWith('impersonate_')) {
          navigate(defaultView);
        }
        return;
      }

      // İzin verilmeyen ekranlara erişim durumunda varsayılan ekrana yönlendir
      if (!allowedViews.includes(currentView)) {
        navigate(defaultView);
        return;
      }

      // Bağımsız POS sekmesi kaldırıldığı için, aktif masa seçilmeden doğrudan POS'a erişilirse Masalar'a veya ana ekrana yönlendir
      if (currentView === 'POS' && !useCartStore.getState().activeTableId && !user.userId.startsWith('impersonate_')) {
        navigate(allowedViews.includes('FLOOR') ? 'FLOOR' : defaultView);
        return;
      }
    } else if (!isAuthenticated) {
      lastUserIdRef.current = null;
    }
  }, [currentView, isAuthenticated, isLocked, user, navigate]);

  // 1. Cihaz ilk kurulumu veya Hard Logout sonrası: Kurumsal Yönetici Girişi (LoginPage)
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // 2. Ortak terminal kilit ekranı: 2 dk hareketsizlik (auto-lock) veya "Kilitle" butonu sonrası (LockPage / PinScreen)
  if (isLocked) {
    return (
      <div className="relative min-h-screen w-full">
        <LockPage isLockMode={true} />
      </div>
    );
  }

  if (currentView === 'PLATFORM') {
    return (
      <>
        <ImpersonationBanner />
        <DynamicIslandToaster />
        <PlatformContainer />
        <PaymentModalContainer />
      </>
    );
  }

  return (
    <>
      <ImpersonationBanner />
      <DynamicIslandToaster />
      <AppShell>
        {currentView === 'FLOOR' ? (
          <FloorPlanContainer />
        ) : currentView === 'MANAGEMENT' ? (
          user?.role === 'OWNER' ? <OwnerDashboardContainer /> : <ManagementContainer />
        ) : currentView === 'KDS' ? (
          <KdsContainer />
        ) : currentView === 'END_OF_DAY' ? (
          <EndOfDayContainer />
        ) : currentView === 'OWNER_DASHBOARD' ? (
          <OwnerDashboardContainer />
        ) : currentView === 'CASHIER' ? (
          <CashierWorkstationContainer />
        ) : (
          <POSLayout
            mainContent={<CatalogContainer />}
            sidebar={<CartContainer />}
          />
        )}
      </AppShell>
      <PaymentModalContainer />
    </>
  );
}
