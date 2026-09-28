import { useState } from 'react';
import { X, AlertTriangle, Trash2 } from 'lucide-react';

interface DeleteTableModalProps {
  isOpen: boolean;
  table: { id: string; name: string } | null;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
}

export function DeleteTableModal({ isOpen, table, onClose, onConfirm }: DeleteTableModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen || !table) return null;

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirm(table.id);
      onClose();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-2xl p-4 animate-in fade-in duration-200">
      <div className="backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 border dark:border-rose-500/30 border-rose-500/30 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden p-6 animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3 text-rose-500">
            <div className="p-2.5 rounded-2xl bg-rose-500/15 border border-rose-500/25">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold tracking-tight dark:text-white text-zinc-900">Masayı Sil</h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 dark:text-zinc-400 text-zinc-500 hover:dark:bg-white/[0.08] hover:bg-black/[0.05] hover:dark:text-white hover:text-zinc-900 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="dark:text-zinc-400 text-zinc-600 text-xs mb-6 leading-relaxed">
          <strong className="dark:text-white text-zinc-900 font-semibold">{table.name}</strong> masasını ve ilişkili salon kaydını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.
        </p>

        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            disabled={isDeleting}
            onClick={onClose}
            className="px-4 py-2.5 rounded-2xl text-xs font-semibold dark:text-zinc-400 text-zinc-600 hover:dark:bg-white/[0.08] hover:bg-black/[0.05] transition-colors cursor-pointer"
          >
            Vazgeç
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={handleConfirm}
            className="px-5 py-2.5 rounded-2xl text-xs font-semibold bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white shadow-md shadow-rose-500/25 transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>{isDeleting ? 'Siliniyor...' : 'Evet, Masayı Sil'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
