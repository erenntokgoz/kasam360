import { useEffect, useState, useCallback } from 'react';
import { tauriInvoke as invoke } from '../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../store/useAuthStore';
import { usePermission } from '../../hooks/usePermission';
import type { Capability } from '../../../core/security/navigationMatrix';
import { MoneyDisplay } from '../common/MoneyDisplay';
import { 
  BarChart3, 
  TrendingUp, 
  Users, 
  Package, 
  Settings, 
  Receipt, 
  Wallet, 
  Layers, 
  Utensils, 
  Wrench,
  FileText,
  LayoutGrid,
  FileBarChart
} from 'lucide-react';
import { AnalyticsDashboardDataDto } from '../../types/analytics';
import { OwnerMenuTab } from './ui/OwnerMenuTab';
import { OwnerInventoryTab } from './ui/OwnerInventoryTab';
import { OwnerBranchesTab } from './ui/OwnerBranchesTab';
import { OwnerStaffTab } from './ui/OwnerStaffTab';
import { OwnerModifiersTab } from './ui/OwnerModifiersTab';
import { OwnerSalesTab } from './ui/OwnerSalesTab';
import { OwnerAuditLogsTab } from './ui/OwnerAuditLogsTab';
import { TablesOrdersPanel } from '../management/ui/TablesOrdersPanel';
import { ReportsPanel } from '../management/ui/ReportsPanel';

// İşletme Sahibi (Patron) Portalı: Onaylar, Personel, Sistem Logları, Stok & Reçete ve Operasyonel Masa/Rapor Panelleri

/** Patron portalının sekme kimlikleri. */
export type OwnerTabId =
  | 'dashboard'
  | 'sales'
  | 'tables'
  | 'reports'
  | 'menu'
  | 'inventory'
  | 'staff'
  | 'logs'
  | 'modifiers'
  | 'settings';

export interface OwnerNavItem {
  id: OwnerTabId;
  label: string;
  icon: React.ReactNode;
}

/**
 * Patron portalı sekmeleri, yetki satırına göre.
 *
 * Denetim kayıtları `auditRead` yetkisi olmadan listeye hiç girmez. Fonksiyon
 * bilerek saf ve dışa açıktır: kapıyı render'a bağımlı olmadan, oturum durumu
 * verilerek test edebilmek için (sunucu render'ı zustand'ın başlangıç durumunu
 * görür) liste kuralı doğrudan doğrulanabilir.
 */
export function buildOwnerNavItems(can: (capability: Capability) => boolean): OwnerNavItem[] {
  return [
    { id: 'dashboard', label: 'Genel Bakış', icon: <BarChart3 size={15} /> },
    { id: 'sales', label: 'Satışlar', icon: <TrendingUp size={15} /> },
    { id: 'tables', label: 'Masa Yönetimi', icon: <LayoutGrid size={15} /> },
    { id: 'reports', label: 'Operasyonel Raporlar', icon: <FileBarChart size={15} /> },
    { id: 'menu', label: 'Menü', icon: <Utensils size={15} /> },
    { id: 'inventory', label: 'Stok & Reçete', icon: <Package size={15} /> },
    { id: 'staff', label: 'Personel', icon: <Users size={15} /> },
    ...(can('auditRead')
      ? [{ id: 'logs' as OwnerTabId, label: 'Sistem Logları', icon: <FileText size={15} /> }]
      : []),
    { id: 'modifiers', label: 'Modifier', icon: <Wrench size={15} /> },
    { id: 'settings', label: 'Şubeler', icon: <Settings size={15} /> },
  ];
}

export function OwnerDashboardContainer() {
  const user = useAuthStore(state => state.user);
  const { can } = usePermission();
  const [summary, setSummary] = useState<AnalyticsDashboardDataDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Patron Portalı Sekmeleri: İşletme analitiği ve yönetimsel operasyonel sekmeler
  const [activeTab, setActiveTab] = useState<OwnerTabId>('dashboard');

  // Dashboard özet istatistiklerini yükle
  const fetchSummary = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const actorRole = user.role === 'OWNER' ? 'Owner' : user.role === 'MASTER' ? 'Master Admin' : user.role === 'MANAGER' ? 'Manager' : user.role;
      const data = await invoke<AnalyticsDashboardDataDto>('get_analytics_dashboard_data', { actorRole });
      setSummary(data);
      setError(null);
    } catch (err) {
      console.error('Özet veri çekme hatası:', err);
      setSummary({
        total_sales_cents: 0,
        transaction_count: 0,
        average_order_value_cents: 0,
        popular_categories: {}
      });
      setError(null);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // Patrona özel menü navigasyon kalemleri (İşletme ve operasyonel yönetim yetenekleri dahil)
  const navItems = buildOwnerNavItems(can);

  return (
    // Renksiz şeffaf cam ve Apple HIG renk skalası
    <div className="flex h-full w-full flex-col dark:bg-[#060609] bg-[#f5f5f7] dark:text-zinc-100 text-zinc-900 overflow-hidden select-none p-4 sm:p-6 gap-4">
      {/* Apple HIG Segmented Bar — Bağımsız Yüzen Cam Ada */}
      <header className="px-6 py-4 rounded-3xl dark:bg-white/[0.04] bg-white/80 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-lg shrink-0">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
            <h1 className="text-lg font-bold tracking-tight dark:text-white text-zinc-900">Patron Portalı</h1>
          </div>

          {/* macOS Tarzı Segmented Kontrol Çubuğu */}
          <div className="flex items-center gap-1.5 p-1.5 dark:bg-white/[0.04] bg-black/[0.04] border dark:border-white/10 border-black/[0.08] rounded-3xl backdrop-blur-md overflow-x-auto no-scrollbar max-w-full shadow-inner">
            {navItems.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-semibold shrink-0 transition-all duration-200 cursor-pointer ${
                    isActive
                      ? 'dark:bg-white/15 bg-white dark:text-white text-[#007AFF] shadow-sm'
                      : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-zinc-200 hover:text-zinc-900 hover:dark:bg-white/[0.04] hover:bg-black/[0.04]'
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Ana İçerik Görünümü (Renksiz Frosted Glass) */}
      <main className="flex-1 overflow-y-auto no-scrollbar min-h-0">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-xs dark:text-zinc-400 text-zinc-500">
            Yükleniyor...
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-xs text-rose-400">
            {error}
          </div>
        ) : activeTab === 'dashboard' ? (
          <div className="space-y-6 max-w-7xl mx-auto">
            {/* Apple Borsa / Sağlık Metrik Kartları — Bağımsız Yüzen Cam Adalar */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Günlük Ciro */}
              <div className="dark:bg-white/[0.04] bg-white/80 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 transition-all duration-300 flex flex-col justify-between backdrop-blur-xl shadow-lg">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
                      Günün Cirosu
                    </span>
                    <div className="w-8 h-8 rounded-2xl dark:bg-white/[0.06] bg-black/[0.04] border dark:border-white/10 border-black/[0.08] flex items-center justify-center text-emerald-500 shadow-inner">
                      <Wallet size={15} />
                    </div>
                  </div>
                  <div className="text-3xl lg:text-4xl font-semibold tracking-tight dark:text-white text-zinc-900 mt-2 font-mono">
                    <MoneyDisplay amountInCents={summary?.total_sales_cents || 0} />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                  <TrendingUp size={13} />
                  <span>Aktif Günlük Hacim</span>
                </div>
              </div>

              {/* Sipariş Adedi */}
              <div className="dark:bg-white/[0.04] bg-white/80 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 transition-all duration-300 flex flex-col justify-between backdrop-blur-xl shadow-lg">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
                      Toplam Sipariş
                    </span>
                    <div className="w-8 h-8 rounded-2xl dark:bg-white/[0.06] bg-black/[0.04] border dark:border-white/10 border-black/[0.08] flex items-center justify-center text-[#007AFF] shadow-inner">
                      <Receipt size={15} />
                    </div>
                  </div>
                  <div className="text-3xl lg:text-4xl font-semibold tracking-tight dark:text-white text-zinc-900 mt-2 font-mono">
                    {summary?.transaction_count || 0}
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-xs font-medium text-[#007AFF]">
                  <Receipt size={13} />
                  <span>İşlenen Adisyonlar</span>
                </div>
              </div>

              {/* Ortalama Sepet */}
              <div className="dark:bg-white/[0.04] bg-white/80 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 transition-all duration-300 flex flex-col justify-between backdrop-blur-xl shadow-lg">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
                      Ortalama Sepet
                    </span>
                    <div className="w-8 h-8 rounded-2xl dark:bg-white/[0.06] bg-black/[0.04] border dark:border-white/10 border-black/[0.08] flex items-center justify-center text-amber-500 shadow-inner">
                      <Layers size={15} />
                    </div>
                  </div>
                  <div className="text-3xl lg:text-4xl font-semibold tracking-tight dark:text-white text-zinc-900 mt-2 font-mono">
                    <MoneyDisplay amountInCents={summary?.average_order_value_cents || 0} />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-xs font-medium text-amber-500">
                  <Layers size={13} />
                  <span>Sipariş Başı Ortalama</span>
                </div>
              </div>
            </div>

            {/* Popüler Kategoriler Dağılımı */}
            <div className="dark:bg-white/[0.03] bg-white/70 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 backdrop-blur-xl shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 size={16} className="text-[#007AFF]" />
                <h3 className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
                  Kategori Satış Hacmi
                </h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Object.entries(summary?.popular_categories || {}).length > 0 ? (
                  Object.entries(summary!.popular_categories).map(([name, count]) => (
                    <div
                      key={name}
                      className="dark:bg-white/[0.02] bg-black/[0.03] hover:dark:bg-white/[0.05] hover:bg-black/[0.06] p-4 rounded-2xl border dark:border-white/5 border-black/5 transition-colors"
                    >
                      <div className="text-[11px] font-semibold dark:text-zinc-400 text-zinc-500 truncate">{name}</div>
                      <div className="text-2xl font-bold tracking-tight dark:text-white text-zinc-900 mt-1 font-mono">
                        {count}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-zinc-400 text-xs py-4 col-span-full">Kayıtlı veri bulunmuyor.</div>
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'sales' ? (
          <OwnerSalesTab />
        ) : activeTab === 'tables' ? (
          // Masa & Siparişler: Anlık salon ve sipariş durumunu bağımsız yüzen renksiz cam ada içerisinde sunar
          <div className="rounded-3xl dark:bg-white/[0.04] bg-white/80 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] p-6 shadow-xl max-w-7xl mx-auto">
            <TablesOrdersPanel />
          </div>
        ) : activeTab === 'reports' ? (
          // Operasyonel Raporlar: Vardiya ve fiş dökümlerini bağımsız yüzen renksiz cam ada içerisinde sunar
          <div className="rounded-3xl dark:bg-white/[0.04] bg-white/80 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] p-6 shadow-xl max-w-7xl mx-auto">
            <ReportsPanel />
          </div>
        ) : activeTab === 'menu' ? (
          <OwnerMenuTab />
        ) : activeTab === 'inventory' ? (
          <OwnerInventoryTab />
        ) : activeTab === 'staff' ? (
          <OwnerStaffTab />
        ) : activeTab === 'logs' ? (
          <OwnerAuditLogsTab />
        ) : activeTab === 'modifiers' ? (
          <OwnerModifiersTab />
        ) : activeTab === 'settings' ? (
          <OwnerBranchesTab />
        ) : null}
      </main>
    </div>
  );
}
