import { Archive, Building2, Pencil } from 'lucide-react';

export interface BranchCardModel {
  id: string;
  name: string;
  address: string | null;
  status: string;
}

interface BranchCardProps {
  branch: BranchCardModel;
  onEdit: (branch: BranchCardModel) => void;
  onArchive: (branch: BranchCardModel) => void;
}

/**
 * Platform şube kartı.
 *
 * Arşivli şube kart kaybolmaz, "Arşiv" rozetine döner ve yazma düğmeleri
 * pasifleşir: şube silinmez, `status = 'ARCHIVED'` olur (AGENTS.md §2).
 */
export function BranchCard({ branch, onEdit, onArchive }: BranchCardProps) {
  const archived = branch.status === 'ARCHIVED';

  return (
    <article className="rounded-2xl border border-black/[0.08] dark:border-white/10 bg-white/70 dark:bg-white/[0.03] p-4 backdrop-blur-xl">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold dark:text-white text-zinc-900 truncate">
            <Building2 size={14} className="shrink-0" />
            {branch.name}
          </p>
          <p className="mt-1 text-[11px] dark:text-zinc-400 text-zinc-600 truncate">
            {branch.address || 'Adres girilmemiş'}
          </p>
        </div>
        <span
          className={
            archived
              ? 'text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 bg-black/[0.06] dark:bg-white/10 dark:text-zinc-400 text-zinc-600'
              : 'text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 bg-[#30D158]/15 text-[#1E7A38] dark:text-[#30D158]'
          }
        >
          {archived ? 'Arşiv' : 'Aktif'}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={archived}
          onClick={() => onEdit(branch)}
          className="flex items-center gap-1.5 rounded-lg border dark:border-white/10 border-black/10 px-2.5 py-1 text-[11px] dark:text-zinc-200 text-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-black/[0.05] dark:hover:bg-white/[0.06] cursor-pointer"
        >
          <Pencil size={12} />
          <span>Düzenle</span>
        </button>
        <button
          type="button"
          disabled={archived}
          onClick={() => onArchive(branch)}
          className="flex items-center gap-1.5 rounded-lg border border-[#FF453A]/30 px-2.5 py-1 text-[11px] text-[#FF453A] dark:text-[#FF6B60] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#FF453A]/10 cursor-pointer"
        >
          <Archive size={12} />
          <span>Arşivle</span>
        </button>
      </div>
    </article>
  );
}