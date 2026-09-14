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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <Plus className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-100">Yeni Masa Ekle</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Salona tek tek veya toplu olarak yeni masalar tanımlayın.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-800 bg-slate-950/20 px-6 pt-3 gap-3">
          <button
            onClick={() => setTab('single')}
            className={`flex items-center gap-2 pb-3 px-3 text-sm font-semibold border-b-2 transition-all ${
              tab === 'single'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Hash className="w-4 h-4" />
            <span>Tek Masa Ekle</span>
          </button>
          <button
            onClick={() => setTab('batch')}
            className={`flex items-center gap-2 pb-3 px-3 text-sm font-semibold border-b-2 transition-all ${
              tab === 'batch'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Toplu Masa Ekle</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-6">
          {tab === 'single' ? (
            <form onSubmit={handleSingleSubmit} className="space-y-5">
              {/* Section Buttons */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Bölüm / Alan Seçimi
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {sections.map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => handleSectionSelect(sec)}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${
                        section === sec
                          ? 'bg-blue-600 border-blue-500 text-white shadow-sm'
                          : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {sec}
                    </button>
                  ))}
                </div>
              </div>

              {/* Table Name Input */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Masa Adı / Tanımı
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={singleName}
                  onChange={(e) => setSingleName(e.target.value)}
                  placeholder="örn: Masa 13, Bahçe 2, VIP 1"
                  className="w-full px-4 py-3 bg-slate-800/90 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-base"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Masa kartında ve fişlerde görüntülenecek isim.
                </p>
              </div>

              {/* Buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:bg-slate-800 transition-colors"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !singleName.trim()}
                  className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white shadow-md transition-all active:scale-98 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isSubmitting ? 'Ekleniyor...' : 'Masayı Ekle'}</span>
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleBatchSubmit} className="space-y-5">
              <div className="bg-blue-950/40 border border-blue-800/40 p-3.5 rounded-xl text-blue-200 text-xs leading-relaxed">
                Tek tıkla ardışık birden fazla masa oluşturabilirsiniz. Masa isimleri otomatik olarak numaralandırılacaktır.
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Masa Ön Eki
                  </label>
                  <input
                    type="text"
                    required
                    value={batchPrefix}
                    onChange={(e) => setBatchPrefix(e.target.value)}
                    placeholder="örn: Masa, Teras"
                    className="w-full px-4 py-2.5 bg-slate-800/90 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Başlangıç Numarası
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={batchStart}
                    onChange={(e) => setBatchStart(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-4 py-2.5 bg-slate-800/90 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Eklenecek Masa Sayısı: <span className="text-blue-400 font-bold">{batchCount}</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={batchCount}
                  onChange={(e) => setBatchCount(parseInt(e.target.value))}
                  className="w-full accent-blue-600 cursor-pointer"
                />
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>1 adet</span>
                  <span>10 adet</span>
                  <span>20 adet</span>
                </div>
              </div>

              {/* Preview Chips */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Eklenecek Masalar Önizleme ({batchCount} masa)
                </label>
                <div className="flex flex-wrap gap-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  {batchPreview.map((item, idx) => (
                    <span
                      key={idx}
                      className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 font-medium"
                    >
                      {item}
                    </span>
                  ))}
                  {batchCount > 6 && (
                    <span className="text-xs px-2 py-1 rounded-lg text-slate-400 font-medium">
                      +{batchCount - 6} daha...
                    </span>
                  )}
                </div>
              </div>

              {/* Buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:bg-slate-800 transition-colors"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || batchCount < 1}
                  className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white shadow-md transition-all active:scale-98 flex items-center gap-2"
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
