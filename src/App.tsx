import { useEffect } from 'react';
import { POSLayout } from './presentation/components/pos/ui/POSLayout';
import { CartContainer } from './presentation/components/pos/CartContainer';
import { CatalogContainer } from './presentation/components/pos/CatalogContainer';
import { PaymentModalContainer } from './presentation/components/pos/PaymentModalContainer';
import { useCartStore } from './presentation/store/useCartStore';
import { FloorPlanContainer } from './presentation/components/floor/FloorPlanContainer';
import { ManagementContainer } from './presentation/components/management/ManagementContainer';
import { KdsContainer } from './presentation/components/kds/KdsContainer';
import { ReceiptsContainer } from './presentation/components/receipts/ReceiptsContainer';
import { EndOfDayContainer } from './presentation/components/endofday/EndOfDayContainer';
import { AppShell } from './presentation/components/layout/AppShell';
import { LoginPage } from './presentation/components/auth/LoginPage';
import { PinScreen } from './presentation/components/auth/PinScreen';
import { useAuthStore } from './presentation/store/useAuthStore';
import { OwnerDashboardContainer } from './presentation/components/owner/OwnerDashboardContainer';
import { CashierWorkstationContainer } from './presentation/components/cashier/CashierWorkstationContainer';
import { PlatformContainer } from './presentation/components/platform/PlatformContainer';

export default function App(): JSX.Element {
  const currentView = useCartStore((state) => state.currentView);
  const navigate = useCartStore((state) => state.navigate);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLocked = useAuthStore((state) => state.isLocked);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    if (isAuthenticated && user && !isLocked) {
      const role = user.role;
      let allowedViews: string[] = [];

      switch (role) {
        case 'MASTER':
          allowedViews = ['PLATFORM'];
          break;
        case 'OWNER':
          allowedViews = ['OWNER_DASHBOARD', 'RECEIPTS', 'MANAGEMENT'];
          break;
        case 'MANAGER':
          // MANAGER sees operational views only — NOT POS, FLOOR, KDS or CASHIER workstation
          allowedViews = ['MANAGEMENT', 'RECEIPTS', 'END_OF_DAY'];
          break;
        case 'CASHIER':
          // CASHIER sees cashier workstation and receipts only — NOT POS/FLOOR
          allowedViews = ['CASHIER', 'RECEIPTS'];
          break;
        case 'WAITER':
          allowedViews = ['POS', 'FLOOR'];
          break;
        case 'KITCHEN':
          allowedViews = ['KDS'];
          break;
        default:
          allowedViews = [];
      }

      if (!allowedViews.includes(currentView)) {
        if (role === 'MASTER') navigate('PLATFORM');
        else if (role === 'OWNER') navigate('OWNER_DASHBOARD');
        else if (role === 'MANAGER') navigate('MANAGEMENT');
        else if (role === 'CASHIER') navigate('CASHIER');
        else if (role === 'KITCHEN') navigate('KDS');
        else if (role === 'WAITER') navigate('FLOOR');
        else navigate('FLOOR');
      }
    }
  }, [currentView, isAuthenticated, isLocked, user, navigate]);

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Hızlı PIN Kilidi Modu (Terminal aktif oturumu kilitlendiğinde)
  if (isLocked) {
    return (
      <div className="relative min-h-screen w-full">
        <PinScreen isLockMode={true} />
      </div>
    );
  }

  if (currentView === 'PLATFORM') {
    return (
      <>
        <PlatformContainer />
        <PaymentModalContainer />
      </>
    );
  }

  return (
    <>
      <AppShell>
        {currentView === 'FLOOR' ? (
          <FloorPlanContainer />
        ) : currentView === 'MANAGEMENT' ? (
          <ManagementContainer />
        ) : currentView === 'KDS' ? (
          <KdsContainer />
        ) : currentView === 'RECEIPTS' ? (
          <ReceiptsContainer />
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
