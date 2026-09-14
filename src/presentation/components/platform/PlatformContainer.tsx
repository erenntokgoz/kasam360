import { useState } from 'react';
import { PlatformDashboard } from './PlatformDashboard';
import { TenantManagement } from './TenantManagement';
import { GlobalUsersPanel } from './GlobalUsersPanel';
import { SubscriptionManagement } from './SubscriptionManagement';
import { DevicesPanel } from './DevicesPanel';
import { GlobalAuditPanel } from './GlobalAuditPanel';
import {
  LayoutDashboard,
  Building2,
  Users,
  CreditCard,
  Monitor,
  ShieldCheck,
  Crown,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';

export function PlatformContainer() {
  const [activeTab, setActiveTab] = useState('DASHBOARD');
  const user = useAuthStore(s => s.user);

  const navItems = [
    { id: 'DASHBOARD', label: 'Platform Özeti', icon: LayoutDashboard },
    { id: 'TENANTS', label: 'Müşteri (Tenant) Yönetimi', icon: Building2 },
    { id: 'USERS', label: 'Genel Kullanıcılar & Roller', icon: Users },
    { id: 'SUBSCRIPTIONS', label: 'Abonelikler & Planlar', icon: CreditCard },
    { id: 'HEALTH', label: 'Cihazlar & Sağlık', icon: Monitor },
    { id: 'AUDIT', label: 'Genel Denetim Defteri', icon: ShieldCheck },
  ];

  return (
    <div className="flex h-screen w-full bg-slate-900 text-slate-100 overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-slate-700/80 bg-slate-800/95 p-4 flex flex-col justify-between flex-shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-6 px-2">
            <div className="p-1.5 bg-blue-600 rounded-lg text-white">
              <Crown size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wider">PLATFORM ADMIN</h2>
              <p className="text-[11px] text-slate-400">KASAM360 Master Panel</p>
            </div>
          </div>

          <nav className="space-y-1">
            {navItems.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
                  }`}
                >
                  <Icon size={16} className={isActive ? 'text-white' : 'text-slate-400'} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Alt Kullanıcı Bilgisi */}
        <div className="pt-4 border-t border-slate-700/60 text-xs">
          <div className="flex items-center gap-2 px-2">
            <div className="w-8 h-8 rounded-full bg-purple-900/60 border border-purple-600/40 text-purple-300 flex items-center justify-center font-bold">
              {user?.name ? user.name.slice(0, 2).toUpperCase() : 'MA'}
            </div>
            <div className="overflow-hidden">
              <div className="text-white font-medium truncate">{user?.name || user?.userId || 'Master Admin'}</div>
              <div className="text-[10px] text-purple-400 font-mono">SÜPER ADMIN (MASTER)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-8 overflow-y-auto">
        <header className="mb-6 border-b border-slate-700/80 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">
                {activeTab === 'DASHBOARD' && 'Platform Özeti & Sistem KPI Metrikleri'}
                {activeTab === 'TENANTS' && 'Müşteri (Tenant) Yönetimi'}
                {activeTab === 'USERS' && 'Genel Kullanıcılar & Rol Yönetimi'}
                {activeTab === 'SUBSCRIPTIONS' && 'Lisans, Paket & Abonelik Yönetimi'}
                {activeTab === 'HEALTH' && 'Terminal Cihazları & Sistem Sağlığı'}
                {activeTab === 'AUDIT' && 'Platform Güvenlik & Denetim Defteri (Audit Ledger)'}
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                KASAM360 çoklu müşteri (multi-tenant) mimarisi platform yönetim ve gözetim merkezi.
              </p>
            </div>
          </div>
        </header>

        <div className="min-h-[400px]">
          {activeTab === 'DASHBOARD' && <PlatformDashboard />}
          {activeTab === 'TENANTS' && <TenantManagement />}
          {activeTab === 'USERS' && <GlobalUsersPanel />}
          {activeTab === 'SUBSCRIPTIONS' && <SubscriptionManagement />}
          {activeTab === 'HEALTH' && <DevicesPanel />}
          {activeTab === 'AUDIT' && <GlobalAuditPanel />}
        </div>
      </div>
    </div>
  );
}
