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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden p-6 animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center mb-5 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-slate-800 text-blue-400 border border-slate-700">
              <Pencil className="w-5 h-5" />
            </div>
            <h3 className="text-xl font-bold text-slate-100">Masa Adını Düzenle</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Yeni Masa Adı
            </label>
            <input
              type="text"
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="örn: Masa 1, Teras 4"
              className="w-full px-4 py-2.5 bg-slate-800/90 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:bg-slate-800 transition-colors"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="px-5 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white shadow-md transition-all active:scale-98"
            >
              {isSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
