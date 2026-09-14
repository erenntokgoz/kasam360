import { useEffect, useState } from 'react';
 
import { tauriInvoke as invoke } from '../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../store/useAuthStore';
import { MoneyDisplay } from '../common/MoneyDisplay';
import { BarChart3, TrendingUp, Users, Package, Settings, Receipt, Wallet, Layers, Utensils, Wrench } from 'lucide-react';
import { AnalyticsDashboardDataDto } from '../../types/analytics';
import { OwnerMenuTab } from './ui/OwnerMenuTab';
import { OwnerInventoryTab } from './ui/OwnerInventoryTab';
import { OwnerBranchesTab } from './ui/OwnerBranchesTab';
import { OwnerStaffTab } from './ui/OwnerStaffTab';
import { OwnerModifiersTab } from './ui/OwnerModifiersTab';
import { OwnerSalesTab } from './ui/OwnerSalesTab';

export function OwnerDashboardContainer() {
    const user = useAuthStore(state => state.user);
    const [summary, setSummary] = useState<AnalyticsDashboardDataDto | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'dashboard' | 'sales' | 'menu' | 'inventory' | 'staff' | 'settings' | 'modifiers'>('dashboard');

    const fetchSummary = async () => {
        if (!user) return;
        setIsLoading(true);
        try {
            const actorRole = user.role === 'OWNER' ? 'Owner' : user.role === 'MASTER' ? 'Master Admin' : user.role === 'MANAGER' ? 'Manager' : user.role;
            const data = await invoke<AnalyticsDashboardDataDto>('get_analytics_dashboard_data', { actorRole });
            setSummary(data);
            setError(null);
        } catch (err) {
            console.error('Failed to fetch daily summary:', err);
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
    };

    useEffect(() => {
        fetchSummary();
    }, [user]);

    return (
        <div className="flex h-full w-full flex-col bg-slate-950 text-slate-200 overflow-hidden relative">
            <div className="flex border-b border-slate-800 bg-slate-950 px-6 pt-4 space-x-2">
                {[
                    { id: 'dashboard', label: 'Genel Bakış', icon: <BarChart3 size={16} /> },
                    { id: 'sales', label: 'Satışlar', icon: <TrendingUp size={16} /> },
                    { id: 'menu', label: 'Menü Yönetimi', icon: <Utensils size={16} /> },
                    { id: 'inventory', label: 'Stok', icon: <Package size={16} /> },
                    { id: 'staff', label: 'Personel', icon: <Users size={16} /> },
                    { id: 'modifiers', label: 'Modifierlar', icon: <Wrench size={16} /> },
                    { id: 'settings', label: 'Şube Ayarları', icon: <Settings size={16} /> },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as 'dashboard' | 'sales' | 'menu' | 'inventory' | 'staff' | 'settings' | 'modifiers')}
                        className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors ${
                            activeTab === tab.id
                                ? 'border-b-2 border-indigo-500 text-white'
                                : 'text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        {tab.icon}
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            <div className="flex-1 p-6 overflow-y-auto">
                {isLoading ? (
                    <div className="flex h-full items-center justify-center text-slate-400">Yükleniyor...</div>
                ) : error ? (
                    <div className="flex h-full items-center justify-center text-red-400">{error}</div>
                ) : activeTab === 'dashboard' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {/* KPI Cards */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col gap-4">
                            <div className="flex items-center gap-3 text-slate-400">
                                <Wallet size={20} className="text-indigo-400" />
                                <h3 className="font-semibold uppercase tracking-wider text-sm">Günün Ciro Özeti</h3>
                            </div>
                            <div className="text-4xl font-bold text-white">
                                <MoneyDisplay amountInCents={summary?.total_sales_cents || 0} />
                            </div>
                        </div>

                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col gap-4">
                            <div className="flex items-center gap-3 text-slate-400">
                                <Receipt size={20} className="text-emerald-400" />
                                <h3 className="font-semibold uppercase tracking-wider text-sm">Toplam Sipariş</h3>
                            </div>
                            <div className="text-4xl font-bold text-white">
                                {summary?.transaction_count || 0}
                            </div>
                        </div>

                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col gap-4">
                            <div className="flex items-center gap-3 text-slate-400">
                                <Layers size={20} className="text-amber-400" />
                                <h3 className="font-semibold uppercase tracking-wider text-sm">Ortalama Sepet Tutarı</h3>
                            </div>
                            <div className="text-4xl font-bold text-white">
                                <MoneyDisplay amountInCents={summary?.average_order_value_cents || 0} />
                            </div>
                        </div>

                        {/* Popular Categories Breakdowns */}
                        <div className="col-span-1 md:col-span-2 lg:col-span-3 bg-slate-900 border border-slate-800 rounded-xl p-6 mt-4">
                            <h3 className="font-semibold uppercase tracking-wider text-sm text-slate-400 mb-4">Popüler Kategoriler</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {Object.entries(summary?.popular_categories || {}).length > 0 ? (
                                    Object.entries(summary!.popular_categories).map(([method, amount]) => (
                                        <div key={method} className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                                            <div className="text-xs text-slate-500 mb-1">{method}</div>
                                            <div className="text-lg font-bold text-slate-200">
                                                {amount}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-slate-500 text-sm">Henüz veri yok.</div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : activeTab === 'sales' ? (
                    <OwnerSalesTab />
                ) : activeTab === 'menu' ? (
                    <OwnerMenuTab />
                ) : activeTab === 'inventory' ? (
                    <OwnerInventoryTab />
                ) : activeTab === 'settings' ? (
                    <OwnerBranchesTab />
                ) : activeTab === 'staff' ? (
                    <OwnerStaffTab />
                ) : activeTab === 'modifiers' ? (
                    <OwnerModifiersTab />
                ) : (
                    <div className="flex h-full flex-col items-center justify-center text-slate-500 gap-4">
                        <Package size={48} className="opacity-20" />
                        <h2 className="text-xl font-medium">Bu özellik yakında eklenecek</h2>
                        <p className="text-sm">Owner detay raporları şu an geliştirme aşamasındadır.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
