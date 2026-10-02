import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Search } from 'lucide-react';

import { tauriInvoke } from '../../../../data/ipc/tauriInvoke';
import { isMultiBranchEnabledForModules } from '../../../hooks/useFeatureFlags';
import { FeatureDisabledNotice } from './FeatureDisabledNotice';
import { BranchCard, type BranchCardModel } from './BranchCard';
import { BranchFormModal, type BranchFormValues } from './BranchFormModal';
import { BranchArchiveDialog } from './BranchArchiveDialog';

interface PlatformTenant {
  id: string;
  name: string;
  status: string;
  modules: string[];
}

interface PlatformBranch {
  id: string;
  tenant_id: string;
  name: string;
  address: string | null;
  status: string;
}

interface BranchFormState {
  mode: 'create' | 'edit';
  branchId: string;
  name: string;
  address: string;
}

/**
 * Platform (MASTER) şube yönetim paneli.
 *
 * Neden burada: AGENTS.md §6 "Şube ekle/sil → sadece MASTER", §6 ayrıca patron
 * panelinde şube sekmesi olmadığını söyler. Bu yüzden yazma yetkisi yalnız bu
 * ekranda vardır; işletme sahibi yalnız `BranchSwitcher` ile geçiş yapar.
 *
 * Özellik bayrağı: `feat_multi_branch` kiracının modül listesinden okunur.
 * Kapalıysa panel **404 yüzeyi** gösterir (AGENTS.md §3.3) — MASTER için bayrak
 * her zaman "açık" sayılmaz, çünkü bayrağın sahibi işletmedir, MASTER değil.
 */
export function PlatformBranchesPanel() {
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [branches, setBranches] = useState<PlatformBranch[]>([]);
  const [form, setForm] = useState<BranchFormState | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<BranchCardModel | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId) ?? null;
  const isMultiBranchEnabled = isMultiBranchEnabledForModules(
    selectedTenant?.modules,
    'MASTER',
  );

  const loadTenants = useCallback(async () => {
    try {
      const rows = await tauriInvoke<PlatformTenant[]>('get_tenants', {});
      const list = Array.isArray(rows) ? rows : [];
      setTenants(list);
      setSelectedTenantId((current) =>
        current && list.some((tenant) => tenant.id === current) ? current : list[0]?.id ?? '',
      );
    } catch {
      setTenants([]);
      setSelectedTenantId('');
    }
  }, []);

  const loadBranches = useCallback(async (tenantId: string) => {
    if (!tenantId) {
      setBranches([]);
      return;
    }
    try {
      const rows = await tauriInvoke<PlatformBranch[]>('get_branches', {
        tenantId,
        tenant_id: tenantId,
        includeArchived: true,
      });
      setBranches(Array.isArray(rows) ? rows : []);
    } catch {
      setBranches([]);
    }
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  useEffect(() => {
    setIsLoading(true);
    void loadBranches(selectedTenantId).finally(() => setIsLoading(false));
  }, [selectedTenantId, loadBranches]);

  const submitForm = async (values: BranchFormValues) => {
    if (!form || !selectedTenantId) return;
    const name = values.name.trim();
    if (!name) {
      setError('Şube adı zorunludur.');
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      if (form.mode === 'create') {
        await tauriInvoke('create_branch', {
          tenantId: selectedTenantId,
          tenant_id: selectedTenantId,
          name,
          address: values.address.trim() || null,
        });
      } else {
        await tauriInvoke('update_branch', {
          tenantId: selectedTenantId,
          tenant_id: selectedTenantId,
          branchId: form.branchId,
          branch_id: form.branchId,
          name,
          address: values.address.trim() || null,
        });
      }
      setForm(null);
      await loadBranches(selectedTenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İşlem tamamlanamadı.');
    } finally {
      setIsBusy(false);
    }
  };

  const confirmArchive = async () => {
    if (!archiveTarget || !selectedTenantId) return;
    setIsBusy(true);
    setError(null);
    try {
      await tauriInvoke('archive_branch', {
        tenantId: selectedTenantId,
        tenant_id: selectedTenantId,
        branchId: archiveTarget.id,
        branch_id: archiveTarget.id,
      });
      setArchiveTarget(null);
      await loadBranches(selectedTenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Şube arşivlenemedi.');
    } finally {
      setIsBusy(false);
    }
  };

  if (!isLoading && selectedTenant && !isMultiBranchEnabled) {
    return (
      <FeatureDisabledNotice
        featureName="Çok Şubeli İşletme"
        hint={`${selectedTenant.name} işletmesinde çok şubeli modülü kapalı. Bu panel yalnız modülü açık işletmelerde kullanılabilir.`}
      />
    );
  }

  const visible = searchTerm.trim()
    ? branches.filter((branch) =>
        `${branch.name} ${branch.address ?? ''}`.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    : branches;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight dark:text-white text-zinc-900">
            Şube Yönetimi
          </h2>
          <p className="text-xs dark:text-zinc-400 text-zinc-600">
            Şube ekleme, güncelleme ve arşivleme yalnız platform yöneticisine açıktır.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="platform-branch-tenant">
            İşletme
          </label>
          <select
            id="platform-branch-tenant"
            value={selectedTenantId}
            onChange={(event) => setSelectedTenantId(event.target.value)}
            className="rounded-xl border dark:border-white/10 border-black/10 bg-white/80 dark:bg-white/[0.05] px-3 py-1.5 text-xs dark:text-zinc-100 text-zinc-800 cursor-pointer"
          >
            {tenants.length === 0 && <option value="">Kayıtlı işletme yok</option>}
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void loadBranches(selectedTenantId)}
            title="Listeyi yenile"
            className="flex h-8 w-8 items-center justify-center rounded-xl border dark:border-white/10 border-black/10 dark:bg-white/5 bg-black/5 dark:text-zinc-200 text-zinc-700 hover:bg-black/[0.08] cursor-pointer"
          >
            <RefreshCw size={14} />
          </button>

          <button
            type="button"
            disabled={!isMultiBranchEnabled || isBusy}
            onClick={() =>
              setForm({ mode: 'create', branchId: '', name: '', address: '' })
            }
            className="flex items-center gap-1.5 rounded-xl bg-[#0A84FF] dark:bg-[#007AFF] text-white px-3 py-1.5 text-xs font-medium hover:bg-[#409CFF] disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
          >
            <Plus size={14} />
            <span>Şube Ekle</span>
          </button>
        </div>
      </header>

      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
        />
        <label className="sr-only" htmlFor="platform-branch-search">
          Şube ara
        </label>
        <input
          id="platform-branch-search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Şube ara"
          className="w-full rounded-xl border dark:border-white/10 border-black/10 bg-white/70 dark:bg-white/[0.04] pl-9 pr-3 py-2 text-xs dark:text-zinc-100 text-zinc-800 placeholder:text-zinc-500"
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-[#FF453A] dark:text-[#FF6B60]">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((branch) => (
          <BranchCard
            key={branch.id}
            branch={branch}
            onEdit={(target) =>
              setForm({
                mode: 'edit',
                branchId: target.id,
                name: target.name,
                address: target.address ?? '',
              })
            }
            onArchive={(target) => setArchiveTarget(target)}
          />
        ))}

        {!isLoading && visible.length === 0 && (
          <p className="text-xs dark:text-zinc-400 text-zinc-600">
            Bu işletmede henüz şube kaydı yok.
          </p>
        )}
      </div>

      {form && (
        <BranchFormModal
          branchId={form.branchId}
          initialValues={{ name: form.name, address: form.address }}
          isBusy={isBusy}
          error={error}
          onSubmit={(values) =>
            void submitForm({ ...form, ...values })
          }
          onClose={() => setForm(null)}
        />
      )}

      {archiveTarget && (
        <BranchArchiveDialog
          branchName={archiveTarget.name}
          isBusy={isBusy}
          onConfirm={() => void confirmArchive()}
          onCancel={() => setArchiveTarget(null)}
        />
      )}
    </div>
  );
}