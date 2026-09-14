import { useState, useEffect, useCallback } from 'react';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../store/useAuthStore';
import {
  CreditCard,
  PackageCheck,
  Smartphone,
  Users,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Calendar,
  Edit3,
  X,
  CheckCircle2,
  AlertOctagon,
  Plus,
  Trash2,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  Check,
  Building,
  Zap,
} from 'lucide-react';

interface SubscriptionDto {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  renews_at: string | null;
}

interface PlanDto {
  id: string;
  name: string;
  monthly_price_cents: number;
  max_devices: number;
  max_users: number;
  max_branches?: number;
  features?: string[];
  badge?: string;
}

interface TenantDto {
  id: string;
  name: string;
  status: string;
}

const PRESET_FEATURES = [
  'Hızlı POS & Kasa Satış',
  'Mutfak KDS Ekranı',
  'Çoklu Şube & Merkezi Rapor',
  'Gelişmiş Stok & Reçete',
  'Garson Mobil El Terminali',
  'Sınırsız Raporlama & Analitik',
  '7/24 Öncelikli Teknik Destek',
  'Değiştirilemez Denetim Defteri (SHA-256)',
];

export function SubscriptionManagement() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionDto[]>([]);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [tenants, setTenants] = useState<TenantDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Abonelik Düzenleme Modal state
  const [selectedSub, setSelectedSub] = useState<SubscriptionDto | null>(null);
  const [editPlanId, setEditPlanId] = useState<string>('');
  const [editDays, setEditDays] = useState<number>(30);
  const [updatingSub, setUpdatingSub] = useState(false);
  const [modalMsg, setModalMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Paket Ekleme / Düzenleme Modal state
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanDto | null>(null); // null => yeni paket
  const [planForm, setPlanForm] = useState({
    id: '',
    name: '',
    monthlyPriceTL: 499,
    maxDevices: 2,
    maxUsers: 3,
    maxBranches: 1,
    badge: '',
    features: [] as string[],
    newFeatureText: '',
  });
  const [savingPlan, setSavingPlan] = useState(false);
  const [planModalMsg, setPlanModalMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Paket Silme Onay Modal state
  const [deletingPlan, setDeletingPlan] = useState<PlanDto | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const user = useAuthStore.getState().user;
      const role = user?.role || 'MASTER';
      const tenantId = user?.tenantId || 'DEFAULT_TENANT';

      const [subsData, plansData, tenantsData] = await Promise.all([
        tauriInvoke<SubscriptionDto[]>('get_subscriptions', { callerRole: role, callerTenantId: tenantId }),
        tauriInvoke<PlanDto[]>('get_plans', {}),
        tauriInvoke<TenantDto[]>('get_tenants', { callerRole: 'MASTER', callerTenantId: '' }),
      ]);

      setSubscriptions(subsData);
      setPlans(plansData);
      setTenants(tenantsData);
    } catch (e: unknown) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // --- Paket Ekle / Düzenle Tetikleyicileri ---
  const handleOpenAddPlan = () => {
    setEditingPlan(null);
    setPlanForm({
      id: '',
      name: '',
      monthlyPriceTL: 599,
      maxDevices: 3,
      maxUsers: 5,
      maxBranches: 1,
      badge: 'Yeni',
      features: ['Hızlı POS & Kasa Satış', 'Mutfak KDS Ekranı', 'Günlük Kasa Kapanışı'],
      newFeatureText: '',
    });
    setPlanModalMsg(null);
    setIsPlanModalOpen(true);
  };

  const handleOpenEditPlan = (plan: PlanDto) => {
    setEditingPlan(plan);
    setPlanForm({
      id: plan.id,
      name: plan.name,
      monthlyPriceTL: Math.round(plan.monthly_price_cents / 100),
      maxDevices: plan.max_devices,
      maxUsers: plan.max_users,
      maxBranches: plan.max_branches ?? 1,
      badge: plan.badge || '',
      features: plan.features ? [...plan.features] : [],
      newFeatureText: '',
    });
    setPlanModalMsg(null);
    setIsPlanModalOpen(true);
  };

  const handleToggleFeature = (feat: string) => {
    setPlanForm(prev => {
      const exists = prev.features.includes(feat);
      return {
        ...prev,
        features: exists ? prev.features.filter(f => f !== feat) : [...prev.features, feat],
      };
    });
  };

  const handleAddCustomFeature = () => {
    const trimmed = planForm.newFeatureText.trim();
    if (!trimmed) return;
    if (!planForm.features.includes(trimmed)) {
      setPlanForm(prev => ({
        ...prev,
        features: [...prev.features, trimmed],
        newFeatureText: '',
      }));
    } else {
      setPlanForm(prev => ({ ...prev, newFeatureText: '' }));
    }
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planForm.name.trim()) {
      setPlanModalMsg({ type: 'error', text: 'Paket adı zorunludur.' });
      return;
    }

    setSavingPlan(true);
    setPlanModalMsg(null);

    const monthlyPriceCents = Math.round(planForm.monthlyPriceTL * 100);

    try {
      if (editingPlan) {
        // Düzenleme
        await tauriInvoke('update_plan', {
          id: editingPlan.id,
          name: planForm.name.trim(),
          monthlyPriceCents,
          maxDevices: Number(planForm.maxDevices),
          maxUsers: Number(planForm.maxUsers),
          maxBranches: Number(planForm.maxBranches),
          badge: planForm.badge.trim() || null,
          features: planForm.features,
        });
        setPlanModalMsg({ type: 'success', text: `Paket (${planForm.name}) başarıyla güncellendi! Mevcut tüm kullanıcılar güncel paket özelliklerine bağlandı.` });
      } else {
        // Yeni Ekleme
        const generatedId = planForm.id.trim()
          ? planForm.id.trim().toLowerCase().replace(/\s+/g, '_')
          : `plan_${Date.now().toString().slice(-6)}`;

        await tauriInvoke('create_plan', {
          id: generatedId,
          name: planForm.name.trim(),
          monthlyPriceCents,
          maxDevices: Number(planForm.maxDevices),
          maxUsers: Number(planForm.maxUsers),
          maxBranches: Number(planForm.maxBranches),
          badge: planForm.badge.trim() || null,
          features: planForm.features,
        });
        setPlanModalMsg({ type: 'success', text: `Yeni paket (${planForm.name}) başarıyla eklendi!` });
      }

      await loadAll();
      setTimeout(() => {
        setIsPlanModalOpen(false);
      }, 1200);
    } catch (err: unknown) {
      setPlanModalMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSavingPlan(false);
    }
  };

  // --- Paket Silme Tetikleyicileri ---
  const handleOpenDeletePlan = (plan: PlanDto) => {
    setDeletingPlan(plan);
    setDeleteError(null);
  };

  const handleConfirmDeletePlan = async () => {
    if (!deletingPlan) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await tauriInvoke('delete_plan', { id: deletingPlan.id });
      await loadAll();
      setDeletingPlan(null);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  };

  // --- Abonelik Düzenleme ---
  const handleOpenEditSub = (sub: SubscriptionDto) => {
    setSelectedSub(sub);
    setEditPlanId(sub.plan_id);
    setEditDays(30);
    setModalMsg(null);
  };

  const handleSaveSub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSub || !editPlanId) return;
    setUpdatingSub(true);
    setModalMsg(null);
    try {
      await tauriInvoke('update_tenant_subscription', {
        callerRole: 'MASTER',
        tenantId: selectedSub.tenant_id,
        planId: editPlanId,
        addDays: Number(editDays),
      });
      setModalMsg({ type: 'success', text: `Abonelik başarıyla güncellendi (+${editDays} gün eklendi).` });
      await loadAll();
      setTimeout(() => {
        setSelectedSub(null);
      }, 1200);
    } catch (err: unknown) {
      setModalMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setUpdatingSub(false);
    }
  };

  const getPlanDetails = (planId: string) => {
    return plans.find(p => p.id === planId);
  };

  const getTenantName = (tenantId: string) => {
    const t = tenants.find(item => item.id === tenantId);
    return t ? t.name : tenantId;
  };

  const formatPrice = (cents: number) => {
    return (cents / 100).toLocaleString('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 0,
    });
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-950 text-green-300 border border-green-700/60">
            <CheckCircle size={12} className="text-green-400" /> Aktif
          </span>
        );
      case 'SUSPENDED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-950 text-orange-300 border border-orange-700/60">
            <AlertCircle size={12} className="text-orange-400" /> Askıda
          </span>
        );
      case 'EXPIRED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-950 text-red-300 border border-red-700/60">
            <AlertCircle size={12} className="text-red-400" /> Süresi Doldu
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300">
            {status}
          </span>
        );
    }
  };

  // Toplam MRR ve ARR
  const activeSubs = subscriptions.filter(s => s.status === 'ACTIVE');
  const totalMRRCents = activeSubs.reduce((sum, s) => {
    const p = getPlanDetails(s.plan_id);
    return sum + (p ? p.monthly_price_cents : 0);
  }, 0);
  const totalARRCents = totalMRRCents * 12;

  return (
    <div className="space-y-6 w-full text-left">
      {/* Üst Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <CreditCard className="text-indigo-400" size={22} />
            Lisans, Paket &amp; Abonelik Yönetimi
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Sistem paketlerini özelleştirin, limitleri düzenleyin, yeni planlar ekleyin ve kiracı aboneliklerini yönetin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadAll}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition-colors"
            title="Yenile"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Yenile
          </button>
          <button
            onClick={handleOpenAddPlan}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-lg shadow-indigo-600/20"
          >
            <Plus size={16} />
            + Yeni Paket Ekle
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg px-4 py-2 text-sm flex items-center gap-2">
          <AlertOctagon size={16} />
          {error}
        </div>
      )}

      {/* KPI KARTLARI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-800/90 border border-slate-700/80 rounded-xl p-4 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Aylık Gelir (MRR)</span>
            <div className="p-2 bg-emerald-950/80 border border-emerald-800/50 rounded-lg text-emerald-400">
              <TrendingUp size={18} />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-400">{formatPrice(totalMRRCents)}</div>
          <p className="text-[11px] text-slate-400 mt-1">Aktif abonelerin aylık getirisi</p>
        </div>

        <div className="bg-slate-800/90 border border-slate-700/80 rounded-xl p-4 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tahmini Yıllık (ARR)</span>
            <div className="p-2 bg-blue-950/80 border border-blue-800/50 rounded-lg text-blue-400">
              <Sparkles size={18} />
            </div>
          </div>
          <div className="text-2xl font-bold text-blue-400">{formatPrice(totalARRCents)}</div>
          <p className="text-[11px] text-slate-400 mt-1">12 aylık projeksiyon</p>
        </div>

        <div className="bg-slate-800/90 border border-slate-700/80 rounded-xl p-4 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tanımlı Paketler</span>
            <div className="p-2 bg-indigo-950/80 border border-indigo-800/50 rounded-lg text-indigo-400">
              <PackageCheck size={18} />
            </div>
          </div>
          <div className="text-2xl font-bold text-white">{plans.length} Paket</div>
          <p className="text-[11px] text-slate-400 mt-1">Tüm paketler dinamik yapılandırılabilir</p>
        </div>

        <div className="bg-slate-800/90 border border-slate-700/80 rounded-xl p-4 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Aktif Müşteri Lisansı</span>
            <div className="p-2 bg-purple-950/80 border border-purple-800/50 rounded-lg text-purple-400">
              <ShieldCheck size={18} />
            </div>
          </div>
          <div className="text-2xl font-bold text-purple-400">{activeSubs.length} İşletme</div>
          <p className="text-[11px] text-slate-400 mt-1">Toplam {subscriptions.length} kayıtlı abonelik</p>
        </div>
      </div>

      {/* 1. KISIM: Plan Kartları (Gelişmiş Kartlar, Badge'ler, Düzenle & Sil) */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <PackageCheck size={16} className="text-blue-400" />
            Sistem Paketleri &amp; Yetki Yönetimi ({plans.length})
          </h3>
          <span className="text-xs text-slate-400">
            * Paket sınırları güncellendiğinde mevcut bağlı kullanıcılar anında etkilenir.
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {plans.map(p => {
            const attachedSubs = subscriptions.filter(s => s.plan_id === p.id && s.status === 'ACTIVE').length;
            return (
              <div
                key={p.id}
                className="relative bg-gradient-to-b from-slate-800/90 to-slate-900/90 border border-slate-700/80 hover:border-indigo-500/60 rounded-xl p-5 transition-all duration-200 flex flex-col justify-between shadow-md hover:shadow-indigo-500/10 group"
              >
                {/* Badge (Varsa) */}
                {p.badge && (
                  <div className="absolute -top-2.5 right-4 bg-indigo-600 text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full shadow border border-indigo-400/50 flex items-center gap-1">
                    <Sparkles size={11} />
                    {p.badge}
                  </div>
                )}

                <div>
                  <div className="flex justify-between items-start mb-2 pr-12">
                    <div>
                      <h4 className="font-bold text-white text-lg group-hover:text-indigo-300 transition-colors">
                        {p.name}
                      </h4>
                      <span className="text-[11px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                        {p.id}
                      </span>
                    </div>
                  </div>

                  <div className="my-3">
                    <div className="text-3xl font-extrabold text-green-400">
                      {formatPrice(p.monthly_price_cents)}
                      <span className="text-xs font-normal text-slate-400 ml-1.5">/ ay</span>
                    </div>
                  </div>

                  {/* Limitler */}
                  <div className="grid grid-cols-3 gap-2 py-3 border-y border-slate-700/60 text-xs">
                    <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">Cihaz Limiti</span>
                      <strong className="text-white text-sm flex items-center gap-1 mt-0.5">
                        <Smartphone size={13} className="text-blue-400" />
                        {p.max_devices}
                      </strong>
                    </div>
                    <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">Personel</span>
                      <strong className="text-white text-sm flex items-center gap-1 mt-0.5">
                        <Users size={13} className="text-purple-400" />
                        {p.max_users}
                      </strong>
                    </div>
                    <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">Şube Limiti</span>
                      <strong className="text-white text-sm flex items-center gap-1 mt-0.5">
                        <Building size={13} className="text-yellow-400" />
                        {p.max_branches ?? 1}
                      </strong>
                    </div>
                  </div>

                  {/* Özellik Listesi (Features) */}
                  <div className="mt-3 space-y-1.5 min-h-[90px]">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                      Özellikler &amp; Yetkiler:
                    </span>
                    {(p.features && p.features.length > 0) ? (
                      p.features.map((feat, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-slate-300">
                          <Check size={13} className="text-green-400 shrink-0" />
                          <span>{feat}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-500 italic">Standart POS &amp; Rapor özellikleri</div>
                    )}
                  </div>
                </div>

                {/* Alt Kısım: Abone Durumu & Eylemler */}
                <div className="mt-4 pt-3 border-t border-slate-700/60">
                  <div className="flex justify-between items-center text-xs text-slate-400 mb-3">
                    <span>Mevcut Aktif Abone:</span>
                    <strong className="text-white bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                      {attachedSubs} İşletme
                    </strong>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleOpenEditPlan(p)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-lg text-xs font-semibold transition-colors"
                    >
                      <Edit3 size={13} className="text-blue-400" />
                      Düzenle
                    </button>
                    <button
                      onClick={() => handleOpenDeletePlan(p)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-950/50 hover:bg-red-900 text-red-300 hover:text-white rounded-lg text-xs font-semibold border border-red-800/40 transition-colors"
                      title="Paketi Sil"
                    >
                      <Trash2 size={13} className="text-red-400" />
                      Paketi Sil
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {plans.length === 0 && !loading && (
            <div className="col-span-3 text-center py-12 bg-slate-800/40 border border-slate-700 rounded-xl">
              <PackageCheck size={36} className="text-slate-500 mx-auto mb-2" />
              <p className="text-slate-400 text-sm font-semibold">Henüz paket tanımlanmamış.</p>
              <button
                onClick={handleOpenAddPlan}
                className="mt-3 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg"
              >
                + İlk Paketi Oluştur
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 2. KISIM: Kiracı Abonelikleri Tablosu (get_subscriptions) */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <CreditCard size={16} className="text-indigo-400" />
            Müşteri Abonelik Listesi ({subscriptions.length})
          </h3>
          <div className="text-xs text-slate-400 bg-slate-800 px-3 py-1 rounded border border-slate-700">
            Aylık Tekrarlayan Gelir (MRR): <strong className="text-green-400 font-semibold">{formatPrice(totalMRRCents)}</strong>
          </div>
        </div>

        {loading ? (
          <p className="text-slate-400 text-sm">Abonelikler yükleniyor...</p>
        ) : (
          <div className="border border-slate-700 rounded-lg overflow-hidden bg-slate-800/60 shadow-sm">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-700/80 text-slate-100 border-b border-slate-600">
                <tr>
                  <th className="p-3.5">Müşteri (İşletme)</th>
                  <th className="p-3.5">Tanımlı Paket</th>
                  <th className="p-3.5">Aylık Tutar</th>
                  <th className="p-3.5">Durum</th>
                  <th className="p-3.5">Yenileme Tarihi</th>
                  <th className="p-3.5 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {subscriptions.map(s => {
                  const plan = getPlanDetails(s.plan_id);
                  const isExpiringSoon = s.renews_at &&
                    new Date(s.renews_at).getTime() - Date.now() < 7 * 86400000 &&
                    new Date(s.renews_at).getTime() > Date.now();

                  return (
                    <tr key={s.id} className="hover:bg-slate-700/40 transition-colors">
                      <td className="p-3.5">
                        <div className="font-semibold text-white">{getTenantName(s.tenant_id)}</div>
                        <div className="text-xs font-mono text-slate-400">{s.tenant_id}</div>
                      </td>
                      <td className="p-3.5">
                        <div className="font-medium text-slate-200">
                          {plan ? plan.name : s.plan_id}
                        </div>
                        {plan && (
                          <div className="text-xs text-slate-400">
                            {plan.max_devices} Cihaz / {plan.max_users} Kullanıcı
                          </div>
                        )}
                      </td>
                      <td className="p-3.5 font-semibold text-white">
                        {plan ? formatPrice(plan.monthly_price_cents) : '—'}
                      </td>
                      <td className="p-3.5">{statusBadge(s.status)}</td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-1.5 text-xs">
                          <Calendar size={13} className="text-slate-400" />
                          <span className={isExpiringSoon ? 'text-orange-400 font-medium' : 'text-slate-300'}>
                            {s.renews_at ? new Date(s.renews_at).toLocaleDateString('tr-TR') : 'Belirtilmedi'}
                          </span>
                        </div>
                        {isExpiringSoon && (
                          <span className="text-[10px] text-orange-400 block mt-0.5 font-medium">
                            Yakında yenilenecek
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-right">
                        <button
                          onClick={() => handleOpenEditSub(s)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded text-xs font-medium transition-colors"
                        >
                          <Edit3 size={13} />
                          <span>Plan / Süre Uzat</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {subscriptions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      Henüz kayıtlı bir abonelik bulunamadı.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ABONELİK DÜZENLEME & SÜRE UZATMA MODALI */}
      {selectedSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/60">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <CreditCard size={18} className="text-indigo-400" />
                Abonelik Düzenle: {getTenantName(selectedSub.tenant_id)}
              </h3>
              <button
                onClick={() => setSelectedSub(null)}
                className="p-1 text-slate-400 hover:text-white rounded transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveSub} className="p-5 space-y-4 text-xs">
              {modalMsg && (
                <div
                  className={`p-3 rounded text-xs flex items-center gap-2 ${
                    modalMsg.type === 'success'
                      ? 'bg-green-950/80 border border-green-800 text-green-300'
                      : 'bg-red-950/80 border border-red-800 text-red-300'
                  }`}
                >
                  {modalMsg.type === 'success' ? (
                    <CheckCircle2 size={16} className="text-green-400 shrink-0" />
                  ) : (
                    <AlertOctagon size={16} className="text-red-400 shrink-0" />
                  )}
                  <span>{modalMsg.text}</span>
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-medium mb-1">Paket Seçimi *</label>
                <select
                  value={editPlanId}
                  onChange={e => setEditPlanId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
                >
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} - {formatPrice(p.monthly_price_cents)}/ay ({p.max_devices} Cihaz, {p.max_users} Kullanıcı)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Eklenen Süre (Gün) *</label>
                <div className="flex gap-2 mb-2">
                  {[30, 90, 365].map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setEditDays(d)}
                      className={`flex-1 py-2 rounded text-xs font-semibold border transition-colors ${
                        editDays === d
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      +{d} Gün
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={editDays}
                  onChange={e => setEditDays(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded px-3 py-2 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setSelectedSub(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={updatingSub || !editPlanId}
                  className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded disabled:opacity-50 transition-colors shadow-sm"
                >
                  {updatingSub ? 'Kaydediliyor...' : 'Aboneliği Kaydet & Uzat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PAKET EKLEME & DÜZENLEME MODALI */}
      {isPlanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-600/20 border border-indigo-500/30 rounded-lg text-indigo-400">
                  <PackageCheck size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {editingPlan ? `Paketi Düzenle: ${editingPlan.name}` : 'Yeni Paket Ekle'}
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Paket sınırlarını, özelliklerini ve fiyatını belirleyin. Yapılan değişiklikler bağlı tüm işletmelerde anında uygulanır.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsPlanModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSavePlan} className="p-6 overflow-y-auto space-y-4 text-xs">
              {planModalMsg && (
                <div
                  className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
                    planModalMsg.type === 'success'
                      ? 'bg-green-950/80 border border-green-800 text-green-300'
                      : 'bg-red-950/80 border border-red-800 text-red-300'
                  }`}
                >
                  {planModalMsg.type === 'success' ? (
                    <CheckCircle2 size={16} className="text-green-400 shrink-0" />
                  ) : (
                    <AlertOctagon size={16} className="text-red-400 shrink-0" />
                  )}
                  <span>{planModalMsg.text}</span>
                </div>
              )}

              {/* Temel Bilgiler */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Paket Adı *</label>
                  <input
                    type="text"
                    required
                    value={planForm.name}
                    onChange={e => setPlanForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Örn: Gurme Restoran Paketi"
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Paket ID / Kodu</label>
                  <input
                    type="text"
                    disabled={!!editingPlan}
                    value={planForm.id}
                    onChange={e => setPlanForm(f => ({ ...f, id: e.target.value }))}
                    placeholder={editingPlan ? editingPlan.id : 'Otomatik veya plan_custom'}
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:bg-slate-900 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Aylık Fiyat (₺) *</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      required
                      value={planForm.monthlyPriceTL}
                      onChange={e => setPlanForm(f => ({ ...f, monthlyPriceTL: Number(e.target.value) }))}
                      className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 pr-8"
                    />
                    <span className="absolute right-3 top-2 text-slate-400 font-medium">₺</span>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Öne Çıkan Rozet (Badge)</label>
                  <input
                    type="text"
                    value={planForm.badge}
                    onChange={e => setPlanForm(f => ({ ...f, badge: e.target.value }))}
                    placeholder="Örn: Popüler, Kampanya, Limitsiz"
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Limitler */}
              <div className="p-4 bg-slate-950/40 rounded-xl border border-slate-800 space-y-3">
                <h4 className="text-xs font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Zap size={14} />
                  Kapasite &amp; Kullanıcı Limitleri (Yetki Sınırları)
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1 flex items-center gap-1">
                      <Smartphone size={13} className="text-blue-400" />
                      Azami Cihaz (Terminal) *
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      required
                      value={planForm.maxDevices}
                      onChange={e => setPlanForm(f => ({ ...f, maxDevices: Number(e.target.value) }))}
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1 flex items-center gap-1">
                      <Users size={13} className="text-purple-400" />
                      Azami Personel/Kullanıcı *
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      required
                      value={planForm.maxUsers}
                      onChange={e => setPlanForm(f => ({ ...f, maxUsers: Number(e.target.value) }))}
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1 flex items-center gap-1">
                      <Building size={13} className="text-yellow-400" />
                      Azami Şube Limiti *
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      required
                      value={planForm.maxBranches}
                      onChange={e => setPlanForm(f => ({ ...f, maxBranches: Number(e.target.value) }))}
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-yellow-500"
                    />
                  </div>
                </div>
              </div>

              {/* Dahil Olan Özellikler (Hazır Preset Seçenekleri + Özel Ekleme) */}
              <div className="space-y-2">
                <label className="block text-slate-300 font-semibold">
                  Pakete Dahil Modüller &amp; Özellikler ({planForm.features.length})
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PRESET_FEATURES.map(feat => {
                    const isSelected = planForm.features.includes(feat);
                    return (
                      <button
                        key={feat}
                        type="button"
                        onClick={() => handleToggleFeature(feat)}
                        className={`flex items-center gap-2 p-2.5 rounded-lg border text-left text-xs transition-all ${
                          isSelected
                            ? 'bg-indigo-950/70 border-indigo-500 text-indigo-200 font-medium shadow-sm'
                            : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:bg-slate-800'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-700'
                          }`}
                        >
                          {isSelected && <Check size={11} />}
                        </div>
                        <span className="truncate">{feat}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Özel Özellik Ekle */}
                <div className="flex gap-2 pt-2">
                  <input
                    type="text"
                    value={planForm.newFeatureText}
                    onChange={e => setPlanForm(f => ({ ...f, newFeatureText: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomFeature();
                      }
                    }}
                    placeholder="Ekstra özel özellik yazın ve ekleyin..."
                    className="flex-1 bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomFeature}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold"
                  >
                    + Ekle
                  </button>
                </div>

                {/* Seçilen Özelliklerin Etiketleri */}
                {planForm.features.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {planForm.features.map(feat => (
                      <span
                        key={feat}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-200 text-[11px]"
                      >
                        {feat}
                        <button
                          type="button"
                          onClick={() => handleToggleFeature(feat)}
                          className="hover:text-red-400 ml-0.5"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsPlanModalOpen(false)}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors font-medium"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={savingPlan || !planForm.name.trim()}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg disabled:opacity-50 transition-colors shadow-lg shadow-indigo-600/20"
                >
                  {savingPlan ? 'Kaydediliyor...' : editingPlan ? 'Paketi Güncelle' : 'Paketi Oluştur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PAKET SİLME ONAY MODALI */}
      {deletingPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-red-800/80 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden p-6 space-y-4 text-left">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-red-950 border border-red-800 rounded-xl text-red-400 shrink-0">
                <Trash2 size={24} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Paketi Silmek İstiyor Musunuz?</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  <strong className="text-red-300">{deletingPlan.name}</strong> ({deletingPlan.id}) kalıcı olarak silinecektir.
                </p>
              </div>
            </div>

            {deleteError && (
              <div className="p-3 bg-red-950/80 border border-red-800 rounded-lg text-xs text-red-300 flex items-center gap-2">
                <AlertOctagon size={16} className="shrink-0 text-red-400" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="text-xs text-slate-400 bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
              <p className="text-slate-300 font-semibold flex items-center gap-1">
                <AlertCircle size={13} className="text-amber-400" /> Güvenlik Denetimi:
              </p>
              <p>Eğer bu pakete atanmış aktif kiracı veya işletme aboneliği varsa silme işlemi sistem tarafından engellenecektir.</p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingPlan(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
              >
                İptal
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDeletePlan}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
              >
                {isDeleting ? 'Siliniyor...' : 'Evet, Paketi Sil'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
