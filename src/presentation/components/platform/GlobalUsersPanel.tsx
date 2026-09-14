import { useState, useEffect, useCallback } from 'react';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import { Users, Search, RefreshCw, Building2, Shield, UserCheck, Plus, Trash2, X, Lock, Key } from 'lucide-react';
import { MasterVaultModal } from './MasterVaultModal';

interface GlobalUserDto {
  id: string;
  name: string;
  role: string;
  tenant_id: string;
}

interface TenantDto {
  id: string;
  name: string;
  status: string;
}

const ROLE_LABELS: Record<string, string> = {
  MASTER: 'Süper Admin',
  OWNER: 'İşletme Sahibi',
  MANAGER: 'Yönetici',
  CASHIER: 'Kasiyer',
  WAITER: 'Garson',
  KITCHEN: 'Mutfak',
};

const ROLE_COLORS: Record<string, string> = {
  MASTER: 'bg-purple-950 text-purple-300 border border-purple-700/60',
  OWNER: 'bg-indigo-950 text-indigo-300 border border-indigo-700/60',
  MANAGER: 'bg-blue-950 text-blue-300 border border-blue-700/60',
  CASHIER: 'bg-green-950 text-green-300 border border-green-700/60',
  WAITER: 'bg-amber-950 text-amber-300 border border-amber-700/60',
  KITCHEN: 'bg-orange-950 text-orange-300 border border-orange-700/60',
};

export function GlobalUsersPanel() {
  const [users, setUsers] = useState<GlobalUserDto[]>([]);
  const [tenants, setTenants] = useState<TenantDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('ALL');

  // Vault Modal State
  const [vaultUser, setVaultUser] = useState<GlobalUserDto | null>(null);

  // Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState({
    name: '',
    role: 'MANAGER',
    tenant_id: 'DEFAULT_TENANT',
    pin: '',
  });
  const [creating, setCreating] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersData, tenantsData] = await Promise.all([
        tauriInvoke<GlobalUserDto[]>('get_global_users', { callerRole: 'MASTER' }),
        tauriInvoke<TenantDto[]>('get_tenants', { callerRole: 'MASTER', callerTenantId: '' }),
      ]);
      setUsers(usersData);
      setTenants(tenantsData);
      if (tenantsData.length > 0 && !form.tenant_id) {
        setForm(f => ({ ...f, tenant_id: tenantsData[0].id }));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [form.tenant_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (!/^\d{4}$/.test(form.pin)) {
      setError('PIN kodu tam 4 haneli rakam olmalıdır.');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      await tauriInvoke('create_staff_member', {
        actorRole: 'MASTER',
        tenantId: form.tenant_id,
        name: form.name.trim(),
        role: form.role,
        pin: form.pin,
      });

      setForm({
        name: '',
        role: 'MANAGER',
        tenant_id: tenants[0]?.id || 'DEFAULT_TENANT',
        pin: '',
      });
      setShowAddModal(false);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await tauriInvoke('delete_staff_member', {
        actorRole: 'MASTER',
        staffId: userId,
      });
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const getTenantName = (tId: string) => {
    if (!tId) return 'Sistem Geneli (Master)';
    const t = tenants.find(item => item.id === tId);
    return t ? t.name : tId;
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (ROLE_LABELS[u.role] ?? u.role).toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = selectedRole === 'ALL' || u.role === selectedRole;
    return matchesSearch && matchesRole;
  });

  const uniqueTenantsCount = new Set(users.map(u => u.tenant_id)).size;

  return (
    <div className="space-y-5 w-full text-left">
      {/* Üst Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="text-purple-400" size={22} />
            Genel Kullanıcılar &amp; Roller
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Sistemdeki tüm işletmelerin personelleri, yöneticileri ve erişim seviyeleri.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-sm transition-colors"
            title="Yenile"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Yenile
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm font-semibold transition-colors shadow-sm"
          >
            <Plus size={16} />
            + Yeni Kullanıcı Ekle
          </button>
        </div>
      </div>

      {/* Mini KPI Barı */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-lg p-3">
          <p className="text-slate-400 text-xs">Toplam Kullanıcı</p>
          <p className="text-2xl font-bold text-white flex items-center gap-1.5">
            <UserCheck size={18} className="text-blue-400" />
            {users.length}
          </p>
        </div>
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-lg p-3">
          <p className="text-slate-400 text-xs">Aktif İşletme (Tenant)</p>
          <p className="text-2xl font-bold text-indigo-400 flex items-center gap-1.5">
            <Building2 size={18} className="text-indigo-400" />
            {uniqueTenantsCount}
          </p>
        </div>
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-lg p-3">
          <p className="text-slate-400 text-xs">Yönetici &amp; Admin</p>
          <p className="text-2xl font-bold text-purple-400 flex items-center gap-1.5">
            <Shield size={18} className="text-purple-400" />
            {users.filter(u => u.role === 'MASTER' || u.role === 'OWNER' || u.role === 'MANAGER').length}
          </p>
        </div>
      </div>

      {/* Arama & Rol Filtresi */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Kullanıcı adı, rol veya ID ile ara..."
            className="w-full bg-slate-800/80 border border-slate-700 pl-10 pr-4 py-2 rounded text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['ALL', 'MASTER', 'OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'].map(roleKey => (
            <button
              key={roleKey}
              onClick={() => setSelectedRole(roleKey)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                selectedRole === roleKey
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >
              {roleKey === 'ALL' ? 'Tümü' : ROLE_LABELS[roleKey] ?? roleKey}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 rounded px-4 py-2.5 text-sm">
          {error}
        </div>
      )}

      {/* Kullanıcı Tablosu */}
      {loading ? (
        <div className="p-8 text-center text-slate-400 flex items-center justify-center gap-2">
          <RefreshCw size={18} className="animate-spin text-purple-400" />
          <span>Kullanıcılar yükleniyor...</span>
        </div>
      ) : (
        <div className="border border-slate-700 rounded-lg overflow-hidden bg-slate-800/60 shadow-sm">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-700/80 text-slate-100 border-b border-slate-600">
              <tr>
                <th className="p-3.5">Ad Soyad</th>
                <th className="p-3.5">Kullanıcı ID</th>
                <th className="p-3.5">Rol &amp; Yetki Seviyesi</th>
                <th className="p-3.5">Bağlı Müşteri (Tenant)</th>
                <th className="p-3.5 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/60">
              {filteredUsers.map(u => (
                <tr key={u.id} className="hover:bg-slate-700/40 transition-colors">
                  <td className="p-3.5">
                    <div className="font-semibold text-white">{u.name}</div>
                  </td>
                  <td className="p-3.5 font-mono text-xs text-slate-400">{u.id}</td>
                  <td className="p-3.5">
                    <span
                      className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${
                        ROLE_COLORS[u.role] ?? 'bg-slate-700 text-slate-200'
                      }`}
                    >
                      {ROLE_LABELS[u.role] ?? u.role}
                    </span>
                  </td>
                  <td className="p-3.5">
                    <div className="text-sm font-medium text-slate-200 flex items-center gap-1.5">
                      <Building2 size={13} className="text-slate-400" />
                      {getTenantName(u.tenant_id)}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">{u.tenant_id || 'Global'}</div>
                  </td>
                  <td className="p-3.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => setVaultUser(u)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-purple-950/70 hover:bg-purple-900 border border-purple-700/60 text-purple-300 rounded text-xs font-medium transition-colors"
                        title="Şifre & Mail Göster (Güvenlik Kasası)"
                      >
                        <Key size={13} />
                        <span>Kasa</span>
                      </button>
                      {u.role !== 'MASTER' && (
                        <button
                          onClick={() => handleDeleteUser(u.id)}
                          className="p-1.5 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-700/50 rounded text-xs font-medium transition-colors"
                          title="Kullanıcıyı Sil"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    {searchQuery || selectedRole !== 'ALL'
                      ? 'Arama kriterlerine uygun kullanıcı bulunamadı.'
                      : 'Henüz kullanıcı kaydı yok.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* YENİ KULLANICI EKLEME MODALI */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/60">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Users size={18} className="text-purple-400" />
                Yeni Genel Kullanıcı Kaydı
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 text-slate-400 hover:text-white rounded transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Ad Soyad *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Örn: Selim Erdem"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded px-3 py-2 text-xs focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Rol / Erişim Seviyesi *</label>
                <select
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded px-3 py-2 text-xs focus:outline-none focus:border-purple-500"
                >
                  <option value="OWNER">İşletme Sahibi (OWNER)</option>
                  <option value="MANAGER">Yönetici (MANAGER)</option>
                  <option value="CASHIER">Kasiyer (CASHIER)</option>
                  <option value="WAITER">Garson (WAITER)</option>
                  <option value="KITCHEN">Mutfak (KITCHEN)</option>
                  <option value="MASTER">Süper Admin (MASTER)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Bağlı Müşteri (Tenant) *</label>
                <select
                  value={form.tenant_id}
                  onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded px-3 py-2 text-xs focus:outline-none focus:border-purple-500"
                >
                  {tenants.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.id})
                    </option>
                  ))}
                  <option value="">Global / Master (Kiracı Bağımsız)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1 flex items-center gap-1">
                  <Lock size={12} className="text-purple-400" />
                  4 Haneli Giriş PIN Kodu *
                </label>
                <input
                  type="password"
                  maxLength={4}
                  required
                  value={form.pin}
                  onChange={e => setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '') }))}
                  placeholder="****"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded px-3 py-2 text-xs font-mono tracking-widest text-center text-sm focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={creating || !form.name.trim()}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded disabled:opacity-50 transition-colors shadow-sm"
                >
                  {creating ? 'Kaydediliyor...' : 'Kullanıcıyı Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GÜVENLİK KASASI (VAULT) MODALI */}
      {vaultUser && (
        <MasterVaultModal
          isOpen={!!vaultUser}
          user={vaultUser}
          onClose={() => setVaultUser(null)}
        />
      )}
    </div>
  );
}
