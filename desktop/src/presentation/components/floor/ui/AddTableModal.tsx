import React, { useState, useEffect } from 'react';
import { X, Plus, Layers, Hash } from 'lucide-react';

interface AddTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingTableCount: number;
  onAddSingle: (id: string, name: string) => Promise<void>;
  onAddBatch: (tables: { id: string; name: string }[]) => Promise<void>;
}

export function AddTableModal({
  isOpen,
  onClose,
  existingTableCount,
  onAddSingle,
  onAddBatch,
}: AddTableModalProps) {
  const [tab, setTab] = useState<'single' | 'batch'>('single');

  // Single table state
  const [section, setSection] = useState('Ana Salon');
  const [singleName, setSingleName] = useState('');

  // Batch table state
  const [batchPrefix, setBatchPrefix] = useState('Masa');
  const [batchStart, setBatchStart] = useState(existingTableCount + 1);
  const [batchCount, setBatchCount] = useState(5);

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSingleName(`Masa ${existingTableCount + 1}`);
      setBatchStart(existingTableCount + 1);
      setIsSubmitting(false);
    }
  }, [isOpen, existingTableCount]);

  if (!isOpen) return null;

  const sections = ['Ana Salon', 'Bahçe', 'Teras', 'Balkon', 'VIP', 'Bar'];

  const handleSectionSelect = (sec: string) => {
    setSection(sec);
    if (sec === 'Ana Salon') {
      setSingleName(`Masa ${existingTableCount + 1}`);
    } else {
      setSingleName(`${sec} 1`);
    }
  };

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = singleName.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const id = `tbl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await onAddSingle(id, trimmed);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || batchCount < 1) return;

    setIsSubmitting(true);
    try {
      const prefix = batchPrefix.trim() || 'Masa';
      const tablesToAdd: { id: string; name: string }[] = [];
      for (let i = 0; i < batchCount; i++) {
        const num = batchStart + i;
        const id = `tbl_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
        tablesToAdd.push({
          id,
          name: `${prefix} ${num}`,
        });
      }
      await onAddBatch(tablesToAdd);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Preview for batch
  const batchPreview = Array.from({ length: Math.min(batchCount, 6) }, (_, i) => {
    return `${batchPrefix.trim() || 'Masa'} ${batchStart + i}`;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-2xl p-4 animate-in fade-in duration-200">
      <div className="backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        {/* Apple Başlık */}
        <div className="p-6 border-b dark:border-white/10 border-black/[0.08] flex justify-between items-center dark:bg-white/[0.02] bg-black/[0.02]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-[#007AFF]/15 text-[#007AFF] border border-[#007AFF]/25">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold tracking-tight dark:text-white text-zinc-900">Yeni Masa Ekle</h3>
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

        {/* Tab Seçimi */}
        <div className="flex border-b dark:border-white/[0.08] border-black/[0.08] dark:bg-white/[0.01] bg-black/[0.01] px-6 pt-3 gap-3">
          <button
            type="button"
            onClick={() => setTab('single')}
            className={`flex items-center gap-2 pb-3 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              tab === 'single'
                ? 'border-[#007AFF] text-[#007AFF]'
                : 'border-transparent dark:text-zinc-400 text-zinc-500 hover:dark:text-white hover:text-zinc-900'
            }`}
          >
            <Hash className="w-4 h-4" />
            <span>Tek Masa Ekle</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('batch')}
            className={`flex items-center gap-2 pb-3 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              tab === 'batch'
                ? 'border-[#007AFF] text-[#007AFF]'
                : 'border-transparent dark:text-zinc-400 text-zinc-500 hover:dark:text-white hover:text-zinc-900'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Toplu Masa Ekle</span>
          </button>
        </div>

        {/* Tab İçeriği */}
        <div className="p-6">
          {tab === 'single' ? (
            <form onSubmit={handleSingleSubmit} className="space-y-5">
              {/* Alan / Bölüm Seçimi */}
              <div>
                <label className="block text-xs font-semibold dark:text-zinc-400 text-zinc-600 uppercase tracking-wider mb-2">
                  Bölüm / Alan
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {sections.map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => handleSectionSelect(sec)}
                      className={`px-3 py-2.5 rounded-2xl text-xs font-semibold transition-all border cursor-pointer active:scale-95 ${
                        section === sec
                          ? 'bg-[#007AFF] border-[#007AFF] text-white shadow-md shadow-[#007AFF]/25'
                          : 'dark:bg-white/[0.04] bg-black/[0.03] dark:border-white/[0.08] border-black/[0.08] dark:text-zinc-300 text-zinc-700 hover:dark:bg-white/[0.08] hover:bg-black/[0.06]'
                      }`}
                    >
                      {sec}
                    </button>
                  ))}
                </div>
              </div>

              {/* Masa Adı Girişi */}
              <div>
                <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 mb-1.5">
                  Masa Adı
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={singleName}
                  onChange={(e) => setSingleName(e.target.value)}
                  placeholder="Masa 1, Bahçe 2, VIP 1"
                  className="w-full px-4 py-3 dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-[#007AFF] text-sm transition-all"
                />
              </div>

              {/* Butonlar */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-2xl text-xs font-semibold dark:text-zinc-400 text-zinc-600 hover:dark:bg-white/[0.08] hover:bg-black/[0.05] transition-colors cursor-pointer"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !singleName.trim()}
                  className="px-5 py-2.5 rounded-2xl text-xs font-semibold bg-[#007AFF] hover:bg-[#0071eb] disabled:opacity-40 text-white shadow-md shadow-[#007AFF]/25 transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isSubmitting ? 'Ekleniyor...' : 'Masayı Ekle'}</span>
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleBatchSubmit} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 mb-1.5">
                    Masa Ön Eki
                  </label>
                  <input
                    type="text"
                    required
                    value={batchPrefix}
                    onChange={(e) => setBatchPrefix(e.target.value)}
                    placeholder="Masa, Teras"
                    className="w-full px-4 py-3 dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-[#007AFF] text-sm transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 mb-1.5">
                    Başlangıç No
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={batchStart}
                    onChange={(e) => setBatchStart(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-4 py-3 dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-[#007AFF] text-sm transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 mb-1.5">
                  Masa Sayısı: <span className="text-[#007AFF] font-bold">{batchCount}</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={batchCount}
                  onChange={(e) => setBatchCount(parseInt(e.target.value))}
                  className="w-full accent-[#007AFF] cursor-pointer"
                />
                <div className="flex justify-between text-[11px] dark:text-zinc-500 text-zinc-400 mt-1 font-mono">
                  <span>1</span>
                  <span>10</span>
                  <span>20</span>
                </div>
              </div>

              {/* Önizleme Kapsülleri */}
              <div>
                <label className="block text-xs font-semibold dark:text-zinc-400 text-zinc-600 uppercase tracking-wider mb-2">
                  Önizleme ({batchCount} masa)
                </label>
                <div className="flex flex-wrap gap-1.5 p-3 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/[0.08] border-black/[0.08]">
                  {batchPreview.map((item, idx) => (
                    <span
                      key={idx}
                      className="text-xs px-2.5 py-1 rounded-xl dark:bg-white/[0.06] bg-black/[0.04] dark:text-zinc-200 text-zinc-800 border dark:border-white/[0.08] border-black/[0.08] font-medium"
                    >
                      {item}
                    </span>
                  ))}
                  {batchCount > 6 && (
                    <span className="text-xs px-2 py-1 rounded-xl dark:text-zinc-500 text-zinc-400 font-medium">
                      +{batchCount - 6} daha...
                    </span>
                  )}
                </div>
              </div>

              {/* Butonlar */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-2xl text-xs font-semibold dark:text-zinc-400 text-zinc-600 hover:dark:bg-white/[0.08] hover:bg-black/[0.05] transition-colors cursor-pointer"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || batchCount < 1}
                  className="px-5 py-2.5 rounded-2xl text-xs font-semibold bg-[#007AFF] hover:bg-[#0071eb] disabled:opacity-40 text-white shadow-md shadow-[#007AFF]/25 transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                >
                  <Layers className="w-4 h-4" />
                  <span>{isSubmitting ? 'Oluşturuluyor...' : `${batchCount} Masayı Oluştur`}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
