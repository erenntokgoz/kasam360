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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-rose-900/60 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden p-6 animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3 text-rose-400">
            <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-800/80">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-100">Masayı Sil</h3>
              <p className="text-xs text-slate-400">Bu işlem geri alınamaz.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-slate-300 text-sm mb-6 leading-relaxed">
          <strong className="text-white font-semibold">{table.name}</strong> masasını ve ilişkili salon kaydını kalıcı olarak silmek istediğinize emin misiniz?
        </p>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            disabled={isDeleting}
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:bg-slate-800 transition-colors"
          >
            Vazgeç
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={handleConfirm}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white shadow-md transition-all active:scale-98 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            <span>{isDeleting ? 'Siliniyor...' : 'Evet, Masayı Sil'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
