import { useState, useEffect, useCallback } from 'react';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import {
  Building2,
  Search,
  Plus,
  CheckCircle2,
  AlertOctagon,
  RefreshCw,
  ExternalLink,
  Phone,
  Mail,
  User,
  Monitor,
  Users as UsersIcon,
  Copy,
  Check,
  Key,
  KeyRound,
} from 'lucide-react';
import { MasterVaultModal, VaultStaffUser } from './MasterVaultModal';
import {
  TenantDetailModal,
  TenantDto,
  PlanDto,
  DeviceDto,
  GlobalUserDto,
  SubscriptionDto,
} from './TenantDetailModal';

export function TenantManagement() {
  const [tenants, setTenants] = useState<TenantDto[]>([]);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [users, setUsers] = useState<GlobalUserDto[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    contactPerson: '',
    email: '',
    password: '',
    licenseKey: '',
    phone: '',
    planId: '',
    status: 'ACTIVE',
  });

  // Vault Modal State
  const [vaultUser, setVaultUser] = useState<VaultStaffUser | null>(null);

  // Otomatik Güçlü Şifre Üretici
  const generateStrongPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let pwd = '';
    for (let i = 0; i < 10; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `K360-${pwd}`;
  };

  // Otomatik Lisans Anahtarı Üretici (K360-XXXX-YYYY-ZZZZ)
  const generateLicenseKey = () => {
    const seg = () => Math.random().toString(36).substring(2, 6).toUpperCase();
    return `K360-${seg()}-${seg()}-${seg()}`;
  };

  // Yeni form açıldığında varsayılan otomatik şifre ve lisans anahtarı ata
  const openNewTenantForm = () => {
    setForm({
      name: '',
      contactPerson: '',
      email: '',
      password: generateStrongPassword(),
      licenseKey: generateLicenseKey(),
      phone: '',
      planId: plans[0]?.id || '',
      status: 'ACTIVE',
    });
    setShowForm(true);
  };

  // Arama & Detay Modal State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTenantForDetail, setSelectedTenantForDetail] = useState<TenantDto | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantsData, plansData, devicesData, usersData, subsData] = await Promise.all([
        tauriInvoke<TenantDto[]>('get_tenants', { callerRole: 'MASTER', callerTenantId: '' }),
        tauriInvoke<PlanDto[]>('get_plans', {}),
        tauriInvoke<DeviceDto[]>('get_devices', { callerRole: 'MASTER' }),
        tauriInvoke<GlobalUserDto[]>('get_global_users', { callerRole: 'MASTER' }),
        tauriInvoke<SubscriptionDto[]>('get_subscriptions', { callerRole: 'MASTER', callerTenantId: '' }),
      ]);
      setTenants(tenantsData);
      setPlans(plansData);
      setDevices(devicesData);
      setUsers(usersData);
      setSubscriptions(subsData);

      if (plansData.length > 0 && !form.planId) {
        setForm(f => ({ ...f, planId: plansData[0].id }));
      }

      // Eğer açık bir detay modalı varsa onu da güncelle
      if (selectedTenantForDetail) {
        const updated = tenantsData.find(t => t.id === selectedTenantForDetail.id);
        if (updated) setSelectedTenantForDetail(updated);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [form.planId, selectedTenantForDetail]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCopy = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await tauriInvoke('create_tenant', {
        name: form.name.trim(),
        contactPerson: form.contactPerson.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        planId: form.planId || null,
        status: form.status,
        ownerEmail: form.email.trim(),
        ownerPassword: form.password.trim(),
        password: form.password.trim(),
        licenseKey: form.licenseKey.trim(),
      });

      setForm({
        name: '',
        contactPerson: '',
        email: '',
        password: '',
        licenseKey: '',
        phone: '',
        planId: plans[0]?.id || '',
        status: 'ACTIVE',
      });
      setShowForm(false);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const getPlanName = (planId: string | null) => {
    if (!planId) return 'Paket Seçilmedi';
    const plan = plans.find(p => p.id === planId);
    if (!plan) return planId;
    const priceTL = (plan.monthly_price_cents / 100).toLocaleString('tr-TR');
    return `${plan.name} (${priceTL} ₺/ay)`;
  };

  const filteredTenants = tenants.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeCount = tenants.filter(t => t.status === 'ACTIVE').length;
  const suspendedCount = tenants.filter(t => t.status === 'SUSPENDED').length;

  return (
    <div className="space-y-5 w-full text-left">
      {/* Üst Başlık & Aksiyonlar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Building2 className="text-blue-400" size={22} />
            Müşteri (Tenant) Yönetimi
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Çoklu işletme altyapısı, detaylı kayıt formu, askıya alma ve abonelik uzatma kontrolü.
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
            onClick={() => {
              if (!showForm) {
                openNewTenantForm();
              } else {
                setShowForm(false);
              }
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors shadow-sm"
          >
            <Plus size={16} />
            {showForm ? 'Formu Kapat' : '+ Eksiksiz Müşteri Kaydı'}
          </button>
        </div>
      </div>

      {/* Mini İstatistik Barı */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-lg p-3">
          <p className="text-slate-400 text-xs">Toplam Kayıtlı Müşteri</p>
          <p className="text-2xl font-bold text-white">{tenants.length}</p>
        </div>
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-lg p-3">
          <p className="text-slate-400 text-xs">Aktif İşletmeler</p>
          <p className="text-2xl font-bold text-green-400">{activeCount}</p>
        </div>
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-lg p-3">
          <p className="text-slate-400 text-xs">Askıya Alınanlar (Beklemede)</p>
          <p className="text-2xl font-bold text-orange-400">{suspendedCount}</p>
        </div>
      </div>

      {/* EKSiKSiZ MÜŞTERİ KAYIT FORMU */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-slate-800 border border-blue-500/50 rounded-xl p-5 space-y-4 shadow-xl animate-in fade-in duration-200"
        >
          <div className="flex justify-between items-center border-b border-slate-700 pb-3">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Plus size={18} className="text-blue-400" />
              Eksiksiz Yeni Müşteri (Tenant) &amp; İşletme Kaydı
            </h3>
            <span className="text-xs text-slate-400">Tüm bilgiler zorunludur</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Building2 size={13} className="text-blue-400" />
                İşletme / Müşteri Adı *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Örn: Bebek Lounge &amp; Bistro"
                required
                className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <User size={13} className="text-purple-400" />
                Yetkili Kişi Adı Soyadı
              </label>
              <input
                type="text"
                value={form.contactPerson}
                onChange={e => setForm(f => ({ ...f, contactPerson: e.target.value }))}
                placeholder="Örn: Ahmet Yılmaz"
                className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Abonelik Paketi *
              </label>
              <select
                value={form.planId}
                onChange={e => setForm(f => ({ ...f, planId: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-blue-500"
              >
                {plans.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} - {(p.monthly_price_cents / 100).toLocaleString('tr-TR')} ₺/ay ({p.max_devices} Cihaz, {p.max_users} Kullanıcı)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Mail size={13} className="text-emerald-400" />
                İletişim E-posta
              </label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="info@bebeklounge.com"
                className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Phone size={13} className="text-yellow-400" />
                İletişim Telefon Numarası
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="0532 XXX XX XX"
                className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <User size={13} className="text-indigo-400" />
                  Patron Giriş Şifresi
                </label>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, password: generateStrongPassword() }))}
                  className="text-[10px] text-blue-400 hover:text-blue-300 underline"
                >
                  Şifre Üret
                </button>
              </div>
              <input
                type="text"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Otomatik oluşturulur"
                className="w-full bg-slate-900 border border-slate-600 text-amber-300 font-mono rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <KeyRound size={13} className="text-purple-400" />
                  Lisans Anahtarı
                </label>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, licenseKey: generateLicenseKey() }))}
                  className="text-[10px] text-purple-400 hover:text-purple-300 underline"
                >
                  Anahtar Üret
                </button>
              </div>
              <input
                type="text"
                value={form.licenseKey}
                onChange={e => setForm(f => ({ ...f, licenseKey: e.target.value }))}
                placeholder="K360-XXXX-YYYY-ZZZZ"
                className="w-full bg-slate-900 border border-slate-600 text-cyan-300 font-mono rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Başlangıç Durumu
              </label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="ACTIVE">Aktif (Kullanıma Hazır)</option>
                <option value="SUSPENDED">Askıda (Beklemede)</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-700/60">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-sm transition-colors"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={creating || !form.name.trim()}
              className="px-5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
            >
              {creating ? 'Müşteri Kaydediliyor...' : 'Müşteriyi & İşletmeyi Oluştur'}
            </button>
          </div>
        </form>
      )}

      {/* Arama Çubuğu */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Müşteri adı, benzersiz ID veya paket ile anında filtrele..."
          className="w-full bg-slate-800/80 border border-slate-700 pl-10 pr-4 py-2 rounded-lg text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500"
        />
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg px-4 py-2.5 text-sm flex items-center gap-2">
          <AlertOctagon size={18} className="text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Müşteri Listesi Tablosu */}
      {loading ? (
        <div className="p-8 text-center text-slate-400 flex items-center justify-center gap-2">
          <RefreshCw size={18} className="animate-spin text-blue-400" />
          <span>Müşteriler yükleniyor...</span>
        </div>
      ) : (
        <div className="border border-slate-700 rounded-xl overflow-hidden bg-slate-800/60 shadow-sm">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-700/80 text-slate-100 border-b border-slate-600">
              <tr>
                <th className="p-3.5">Benzersiz ID &amp; İşletme Adı</th>
                <th className="p-3.5">Durum</th>
                <th className="p-3.5">Abonelik Paketi</th>
                <th className="p-3.5">Terminaller &amp; Personel</th>
                <th className="p-3.5">Kayıt Tarihi</th>
                <th className="p-3.5 text-right">Yönetim</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/60">
              {filteredTenants.map(t => {
                const tenantDevCount = devices.filter(d => d.tenant_id === t.id).length;
                const tenantUsrCount = users.filter(u => u.tenant_id === t.id && u.id !== 'usr_master' && u.role !== 'MASTER').length;
                const isCopied = copiedId === t.id;

                return (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedTenantForDetail(t)}
                    className="hover:bg-slate-700/50 cursor-pointer transition-colors group"
                  >
                    <td className="p-3.5">
                      <div className="font-semibold text-white group-hover:text-blue-400 transition-colors flex items-center gap-2">
                        {t.name}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs font-mono text-slate-400">{t.id}</span>
                        <button
                          onClick={e => handleCopy(t.id, e)}
                          className="text-slate-500 hover:text-slate-300 p-0.5 rounded transition-colors"
                          title="ID Kopyala"
                        >
                          {isCopied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          t.status?.toUpperCase() === 'ACTIVE'
                            ? 'bg-green-950 text-green-300 border border-green-700/60'
                            : 'bg-red-950 text-red-300 border border-red-700/60'
                        }`}
                      >
                        {t.status?.toUpperCase() === 'ACTIVE' ? (
                          <>
                            <CheckCircle2 size={12} className="text-green-400" /> Aktif
                          </>
                        ) : (
                          <>
                            <AlertOctagon size={12} className="text-red-400" /> Askıda
                          </>
                        )}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <div className="text-sm font-medium text-slate-200">
                        {getPlanName(t.plan_id)}
                      </div>
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <Monitor size={13} className="text-cyan-400" />
                          <strong className="text-slate-200">{tenantDevCount}</strong> Cihaz
                        </span>
                        <span className="flex items-center gap-1">
                          <UsersIcon size={13} className="text-purple-400" />
                          <strong className="text-slate-200">{tenantUsrCount}</strong> Personel
                        </span>
                      </div>
                    </td>
                    <td className="p-3.5 text-slate-400 text-xs">
                      {t.created_at ? new Date(t.created_at).toLocaleDateString('tr-TR') : '—'}
                    </td>
                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            const ownerStaff = users.find(u => u.tenant_id === t.id && u.role === 'OWNER') || {
                              id: `usr_owner_${t.id}`,
                              name: `${t.name} Yetkilisi`,
                              role: 'OWNER',
                              tenant_id: t.id,
                            };
                            setVaultUser(ownerStaff);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-purple-950/70 hover:bg-purple-900 border border-purple-700/60 text-purple-300 rounded-lg text-xs font-medium transition-colors shadow-sm"
                          title="Giriş Şifresi & Mail (Güvenlik Kasası)"
                        >
                          <Key size={12} />
                          <span>Kasa</span>
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedTenantForDetail(t);
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600/80 hover:bg-blue-600 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
                        >
                          <span>Yönet &amp; Detay</span>
                          <ExternalLink size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredTenants.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    {searchQuery ? 'Aramanıza uygun müşteri bulunamadı.' : 'Henüz müşteri kaydı yok.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* MÜŞTERİ DETAY & TAM YÖNETİM MODALI */}
      {selectedTenantForDetail && (
        <TenantDetailModal
          tenant={selectedTenantForDetail}
          plans={plans}
          devices={devices}
          users={users}
          subscriptions={subscriptions}
          isOpen={!!selectedTenantForDetail}
          onClose={() => setSelectedTenantForDetail(null)}
          onRefresh={loadData}
        />
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
