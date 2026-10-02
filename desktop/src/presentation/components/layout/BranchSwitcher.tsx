import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';

import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../store/useAuthStore';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';

export interface BranchSummary {
  id: string;
  tenant_id: string;
  name: string;
  address?: string | null;
  status: string;
}

/** Okuma yetkisi olan roller: patron ve müdür. Kasiyer şube geçirmez. */
const SWITCH_ROLES = ['OWNER', 'MANAGER'];

/**
 * Şube geçiş açılır listesi.
 *
 * Neden ayrı bileşen: Faz 6'da patron panelindeki "Şubeler" sekmesi kaldırıldı;
 * patronun şube üzerindeki tek yetkisi **oturduğu şubeyi seçmek**. Bu yüzden
 * yalnız okuma vardır, ekleme/güncelleme/arşivleme MASTER'ın platform
 * ekranındadır.
 *
 * Görünürlük iki kapıya bağlıdır:
 * 1. `feat_multi_branch` açık olmalı (kapalıysa tek şube kipinde çalışılır),
 * 2. rol `OWNER` veya `MANAGER` olmalı.
 */
export function BranchSwitcher() {
  const { isMultiBranchEnabled } = useFeatureFlags();
  const role = useAuthStore((state) => state.user?.role ?? '');
  const branchId = useAuthStore((state) => state.branchId);
  const branchName = useAuthStore((state) => state.branchName);
  const setBranch = useAuthStore((state) => state.setBranch);

  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const canSwitch = isMultiBranchEnabled && SWITCH_ROLES.includes(role);

  const loadBranches = useCallback(async () => {
    try {
      const rows = await tauriInvoke<BranchSummary[]>('get_branches', {
        includeArchived: false,
      });
      setBranches(Array.isArray(rows) ? rows : []);
    } catch {
      // Okunamayan liste geçişi gizlemez: tek şube kipinde çalışılır.
      setBranches([]);
    }
  }, []);

  useEffect(() => {
    if (!canSwitch) return;
    void loadBranches();
  }, [canSwitch, loadBranches]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  // Tek şube varsa seçim anlamı taşımaz: liste açılmaz.
  if (!canSwitch || branches.length <= 1) {
    if (!branchName) return null;
    return (
      <span className="hidden sm:inline text-xs font-normal text-zinc-600 dark:text-zinc-400 dark:bg-white/5 bg-black/5 border dark:border-white/10 border-black/10 px-3 py-1 rounded-full">
        {branchName}
      </span>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Aktif şubeyi değiştir"
        className="flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 dark:bg-white/5 bg-black/5 hover:dark:bg-white/10 hover:bg-black/10 border dark:border-white/10 border-black/10 px-3 py-1 rounded-full transition-all cursor-pointer active:scale-95"
      >
        <Building2 size={13} />
        <span className="max-w-[140px] truncate">
          {branchName || branches[0]?.name || 'Şube'}
        </span>
        <ChevronDown size={13} className="text-zinc-500" />
      </button>

      {isOpen && (
        <ul
          role="listbox"
          aria-label="Şubeler"
          className="absolute left-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/10 bg-white/95 dark:bg-[#1F2024]/95 backdrop-blur-2xl shadow-xl"
        >
          {branches.map((branch) => {
            const active = branch.id === branchId;
            return (
              <li key={branch.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    setBranch(branch.id, branch.name);
                    setIsOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-xs text-zinc-800 dark:text-zinc-100 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] cursor-pointer"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{branch.name}</span>
                    {branch.address && (
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {branch.address}
                      </span>
                    )}
                  </span>
                  {active && <Check size={14} className="text-[#007AFF] shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}