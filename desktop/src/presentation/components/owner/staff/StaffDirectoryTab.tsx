import { useCallback, useEffect, useMemo, useState } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { Users, UserPlus, Trash2, Search, KeyRound, Shield, Eye, EyeOff } from 'lucide-react';
import {
  BirthdayStrip,
  StaffEmptyState,
  StaffErrorBar,
  StaffLoading,
  StaffPanelHeader,
  useStaffContext,
} from './StaffPrimitives';
import { ROLE_LABELS, money } from './staff360Types';
import type { StaffProfile } from './staff360Types';

export type StaffMember = {
  id: string;
  name: string;
  role: string;
  tenant_id: string;
};

const ROLE_INFO: Record<string, { badge: string; desc: string }> = {
  MANAGER: {
    badge: 'bg-[#0A84FF]/15 text-[#007AFF] dark:text-[#409CFF] border-[#0A84FF]/30',
    desc: 'Kasa açma/kapama, onaylar, ikram ve iptal yetkisi',
  },
  CASHIER: {
    badge: 'bg-[#30D158]/15 text-[#34C759] dark:text-[#30D158] border-[#30D158]/30',
    desc: 'Ödeme alma, vardiya yönetimi, fiş kesme',
  },
  WAITER: {
    badge: 'bg-[#FF9F0A]/15 text-[#FF9500] dark:text-[#FF9F0A] border-[#FF9F0A]/30',
    desc: 'Masa yönetimi, sipariş oluşturma ve servis takibi',
  },
  KITCHEN: {
    badge: 'bg-[#FF453A]/15 text-[#FF3B30] dark:text-[#FF453A] border-[#FF453A]/30',
    desc: 'KDS ekranı ve sipariş hazırlık istasyonları',
  },
  OWNER: {
    badge: 'bg-[#BF5AF2]/15 text-[#AF52DE] dark:text-[#BF5AF2] border-[#BF5AF2]/30',
    desc: 'Tam sistem, şube ve finansal yönetim yetkisi',
  },
};

const ROLE_FILTERS = ['ALL', 'OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'] as const;

/**
 * Sekme 1 — Personel: kullanıcı + yetki yönetimi ve personel profilleri.
 *
 * Neden iki liste bir arada: patron önce "kimi işe alıyorum" sonra "bu kişinin
 * maaşı ve doğum günü ne". Aynı ekranda iki kayıt türünü ayrı sekmelere
 * bölmek, ikinci ekrana gitmeden profil açamamaya yol açardı.
 */
export function StaffDirectoryTab() {
  const { tenantId, actorRole, actorId, toast } = useStaffContext();

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [profiles, setProfiles] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');

  const [showAddModal, setShowAddModal] = useState(false);
  const [deletingStaff, setDeletingStaff] = useState<StaffMember | null>(null);
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('WAITER');
  const [formPin, setFormPin] = useState('');
  const [showPinText, setShowPinText] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const yukle = useCallback(
    async (yenile = false) => {
      if (yenile) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const veri = await invoke<StaffMember[]>('get_staff', {
          actorRole,
          actor_role: actorRole,
          tenantId,
          tenant_id: tenantId,
        });
        setStaff(Array.isArray(veri) ? veri : []);
        // Profil listesi yetkisizse hata döner; o durumda boş bırakılır ve
        // "profil yok" yazısı yanlış sayılmaz, çünkü kayıt yükleme hatası
        // ayrıca gösterilir.
        try {
          const profiller = await invoke<StaffProfile[]>('list_staff_profiles', {
            actorRole,
            actor_role: actorRole,
            tenantId,
            tenant_id: tenantId,
          });
          setProfiles(Array.isArray(profiller) ? profiller : []);
        } catch {
          setProfiles([]);
        }
      } catch (e) {
        setError(typeof e === 'string' ? e : 'Personel listesi alınamadı.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [actorRole, tenantId]
  );

  useEffect(() => {
    yukle();
  }, [yukle]);

  const profilMap = useMemo(() => {
    const m = new Map<string, StaffProfile>();
    profiles.forEach((p) => m.set(p.userId, p));
    return m;
  }, [profiles]);

  const handleOpenAddModal = () => {
    setError(null);
    setFormName('');
    setFormRole('WAITER');
    setFormPin(Math.floor(1000 + Math.random() * 9000).toString());
    setShowPinText(true);
    setShowAddModal(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formPin.trim()) {
      setError('Ad Soyad ve PIN alanları zorunludur.');
      return;
    }
    if (formPin.length < 4 || formPin.length > 8) {
      setError('PIN kodu 4 ila 8 haneli olmalıdır.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const yeniId = await invoke<string>('create_staff_member', {
        actorRole,
        actor_role: actorRole,
        tenantId,
        tenant_id: tenantId,
        name: formName.trim(),
        role: formRole,
        pin: formPin.trim(),
      });
      toast({ title: `${formName.trim()} personeli oluşturuldu.`, type: 'success' });

      // Profil kaydı: kullanıcı satırı olmadan maaş/izin ekranları boş kalır.
      // Yeni kullanıcının kimliği dönmezse bu adım atlanır ve uyarı verilir.
      if (yeniId) {
        try {
          await invoke('save_staff_profile', {
            actorRole,
            actor_role: actorRole,
            actorId,
            actor_id: actorId,
            tenantId,
            tenant_id: tenantId,
            input: {
              userId: yeniId,
              fullName: formName.trim(),
              baseSalaryCents: 0,
              commissionPercent: 0,
            },
          });
        } catch (e) {
          toast({
            title: `Kullanıcı açıldı ancak personel profili kaydedilemedi: ${
              typeof e === 'string' ? e : 'bilinmeyen hata'
            }`,
            type: 'error',
          });
        }
      }
      setShowAddModal(false);
      await yukle(true);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Personel oluşturulurken hata meydana geldi.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingStaff) return;
    try {
      await invoke('delete_staff_member', {
        actorRole,
        actor_role: actorRole,
        tenantId,
        tenant_id: tenantId,
        staffId: deletingStaff.id,
        staff_id: deletingStaff.id,
      });
      toast({ title: `${deletingStaff.name} personeli pasife alındı.`, type: 'success' });
      setDeletingStaff(null);
      await yukle(true);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Personel pasife alınırken hata meydana geldi.');
    }
  };

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return staff.filter((s) => {
      const matchesSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.role.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q);
      const matchesRole = roleFilter === 'ALL' || s.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [staff, searchTerm, roleFilter]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-12">
      <StaffPanelHeader
        icon={<Users size={22} />}
        title="Personel ve Yetki Yönetimi"
        description="PIN kodları, görev rolleri, erişim yetkileri ve personel profilleri."
        onRefresh={() => yukle(true)}
        refreshing={refreshing}
        actions={
          <button
            onClick={handleOpenAddModal}
            className="flex cursor-pointer items-center gap-1.5 rounded-2xl border border-black/10 bg-black/[0.05] px-4 py-2 text-xs font-semibold text-zinc-900 shadow-sm transition-all hover:bg-black/[0.08] active:scale-95 dark:border-white/15 dark:bg-white/[0.08] dark:text-white dark:hover:bg-white/[0.14]"
          >
            <UserPlus size={15} />
            <span>Yeni Personel</span>
          </button>
        }
      />

      <StaffErrorBar message={error} onClose={() => setError(null)} />

      <div className="rounded-3xl border border-black/[0.08] bg-white/70 px-4 py-3 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.03]">
        <BirthdayStrip tenantId={tenantId} actorRole={actorRole} daysAhead={30} />
      </div>

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="relative w-full max-w-sm">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Personel adı, rol veya kimlik ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Personel ara"
            className="w-full rounded-2xl border border-black/[0.08] bg-white/80 py-2.5 pl-9 pr-4 text-xs text-zinc-900 backdrop-blur-md transition-all placeholder-zinc-400 focus:border-[#007AFF] focus:outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto rounded-3xl border border-black/[0.08] bg-white/75 p-1.5 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/[0.04]">
          {ROLE_FILTERS.map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`shrink-0 cursor-pointer rounded-2xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
                roleFilter === r
                  ? 'border border-black/[0.08] bg-white text-[#007AFF] shadow-sm dark:border-white/10 dark:bg-white/15 dark:text-[#409CFF]'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
              }`}
            >
              {r === 'ALL' ? 'Tümü' : (ROLE_LABELS[r] ?? r)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <StaffLoading label="Personel listesi yükleniyor..." />
      ) : filtered.length === 0 ? (
        <StaffEmptyState
          message="Bu filtreye uyan personel yok."
          hint="Arama metnini temizleyip tüm rolleri seçmeyi deneyin."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => {
            const info = ROLE_INFO[s.role];
            const profil = profilMap.get(s.id);
            return (
              <article
                key={s.id}
                className="flex flex-col gap-3 rounded-3xl border border-black/[0.08] bg-white/75 p-4 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-zinc-900 dark:text-white">
                      {s.name}
                    </h3>
                    <p className="mt-0.5 font-mono text-[10px] text-zinc-400">{s.id}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                      info?.badge ??
                      'border-black/10 bg-black/[0.04] text-zinc-600 dark:border-white/15 dark:bg-white/[0.06] dark:text-zinc-300'
                    }`}
                  >
                    {ROLE_LABELS[s.role] ?? s.role}
                  </span>
                </div>

                <p className="flex items-start gap-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                  <Shield size={13} className="mt-0.5 shrink-0 text-[#007AFF]" />
                  <span>{info?.desc ?? 'Rol tanımı yok'}</span>
                </p>

                {profil && (
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-black/[0.06] pt-3 text-[11px] dark:border-white/[0.08]">
                    <dt className="text-zinc-500 dark:text-zinc-500">Dönem maaşı</dt>
                    <dd className="text-right font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                      {actorRole === 'OWNER' ? money(profil.baseSalaryCents) : 'Görünmüyor'}
                    </dd>
                    <dt className="text-zinc-500 dark:text-zinc-500">Komisyon</dt>
                    <dd className="text-right font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                      %{profil.commissionPercent}
                    </dd>
                    <dt className="text-zinc-500 dark:text-zinc-500">Doğum günü</dt>
                    <dd className="text-right text-zinc-700 dark:text-zinc-300">
                      {profil.birthDate ?? 'Bilinmiyor'}
                    </dd>
                  </dl>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={() => setDeletingStaff(s)}
                    aria-label={`${s.name} personeli pasife al`}
                    className="flex cursor-pointer items-center gap-1.5 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 text-[11px] font-medium text-rose-600 transition-all hover:bg-rose-500/20 dark:text-rose-300"
                  >
                    <Trash2 size={13} />
                    <span>Pasife Al</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-xl"
          role="dialog"
          aria-modal="true"
          aria-label="Yeni personel"
        >
          <form
            onSubmit={handleCreate}
            className="w-full max-w-md rounded-3xl border border-black/10 bg-white/90 p-6 shadow-xl backdrop-blur-2xl dark:border-white/15 dark:bg-[#1F2024]/90"
          >
            <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
              Yeni Personel Ekle
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              PIN düz metin saklanmaz; sistem Argon2id ile şifreler.
            </p>

            <label className="mt-5 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Ad Soyad
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
              />
            </label>

            <label className="mt-4 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Rol
              <select
                value={formRole}
                onChange={(e) => setFormRole(e.target.value)}
                className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
              >
                {['WAITER', 'CASHIER', 'KITCHEN', 'MANAGER', 'OWNER'].map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r] ?? r}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-4 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              PIN
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type={showPinText ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={8}
                  value={formPin}
                  onChange={(e) => setFormPin(e.target.value.replace(/\D/g, ''))}
                  className="flex-1 rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm tabular-nums text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPinText((v) => !v)}
                  aria-label={showPinText ? 'PIN gizle' : 'PIN göster'}
                  className="cursor-pointer rounded-2xl border border-black/10 p-2.5 text-zinc-600 hover:bg-black/[0.05] dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/[0.08]"
                >
                  {showPinText ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="cursor-pointer rounded-2xl border border-black/10 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-black/[0.05] dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/[0.08]"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex cursor-pointer items-center gap-1.5 rounded-2xl bg-[#007AFF] px-4 py-2 text-xs font-semibold text-white transition-all active:scale-95 disabled:opacity-50 dark:bg-[#0A84FF]"
              >
                <KeyRound size={14} />
                <span>{isSaving ? 'Kaydediliyor...' : 'Kaydet'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {deletingStaff && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-xl"
          role="dialog"
          aria-modal="true"
          aria-label="Pasife alma onayı"
        >
          <div className="w-full max-w-sm rounded-3xl border border-black/10 bg-white/90 p-6 shadow-xl backdrop-blur-2xl dark:border-white/15 dark:bg-[#1F2024]/90">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
              Personel pasife alınsın mı?
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {deletingStaff.name} silinmez; pasife alınır. Geçmiş vardiya, satış ve
              bordro kayıtları korunur, yalnız giriş ve yeni işlem kapatılır.
            </p>
            <div className="mt-6 flex justify-end gap-2.5">
              <button
                onClick={() => setDeletingStaff(null)}
                className="cursor-pointer rounded-2xl border border-black/10 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-black/[0.05] dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/[0.08]"
              >
                Vazgeç
              </button>
              <button
                onClick={handleConfirmDelete}
                className="cursor-pointer rounded-2xl bg-[#FF3B30] px-4 py-2 text-xs font-semibold text-white transition-all active:scale-95 dark:bg-[#FF453A]"
              >
                Pasife Al
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}