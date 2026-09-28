import React, { useState, useEffect } from 'react';
import { X, Pencil } from 'lucide-react';

interface EditTableModalProps {
  isOpen: boolean;
  table: { id: string; name: string } | null;
  onClose: () => void;
  onSave: (id: string, newName: string) => Promise<void>;
}

export function EditTableModal({ isOpen, table, onClose, onSave }: EditTableModalProps) {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (table) {
      setName(table.name);
      setIsSubmitting(false);
    }
  }, [table]);

  if (!isOpen || !table) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSave(table.id, trimmed);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-2xl p-4 animate-in fade-in duration-200">
      <div className="backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl shadow-2xl w-full max-w-md overflow-hidden p-6 animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center mb-5 pb-3 border-b dark:border-white/10 border-black/[0.08]">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-[#007AFF]/15 text-[#007AFF] border border-[#007AFF]/25">
              <Pencil className="w-4 h-4" />
            </div>
            <h3 className="text-lg font-semibold tracking-tight dark:text-white text-zinc-900">Masa Adını Düzenle</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 dark:text-zinc-400 text-zinc-500 hover:dark:bg-white/[0.08] hover:bg-black/[0.05] hover:dark:text-white hover:text-zinc-900 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 mb-1.5">
              Yeni Masa Adı
            </label>
            <input
              type="text"
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Masa 1, Teras 4"
              className="w-full px-4 py-3 dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-[#007AFF] text-sm transition-all"
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-2xl text-xs font-semibold dark:text-zinc-400 text-zinc-600 hover:dark:bg-white/[0.08] hover:bg-black/[0.05] transition-colors cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="px-5 py-2.5 rounded-2xl text-xs font-semibold bg-[#007AFF] hover:bg-[#0071eb] disabled:opacity-40 text-white shadow-md shadow-[#007AFF]/25 transition-all active:scale-95 cursor-pointer"
            >
              {isSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
