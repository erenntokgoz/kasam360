import { ErrorToast } from '../../ui/ErrorToast';
import { capitalizeRecordName } from '../../lib/recordName';
// Menü Yeni Kategori Ekleme Modalı
// Açık ve koyu tema tam uyumlu, CSS tema değişkenleriyle desteklenir.

import React, { useEffect, useRef, useState } from 'react';
import { useStationStore } from '../../stores/stationStore';
import { useMenuExtrasStore } from '../../stores/menuExtrasStore';
import { Modal } from '../../ui/Modal';
import { useMenuStore } from '../../stores/menuStore';
import type { CategoryDto } from '../../types/menu';

interface MenuCategoryModalProps {
  isOpen: boolean;
  /** Verilirse pencere düzenleme açılır. */
  category?: CategoryDto | null;
  onClose: () => void;
  onCreated?: (category: CategoryDto) => void;
}

export const MenuCategoryModal: React.FC<MenuCategoryModalProps> = ({
  isOpen,
  category = null,
  onClose,
  onCreated,
}) => {
  const { createCategory, updateCategory, busy, categories } = useMenuStore();
  const parents = useMenuExtrasStore((state) => state.parents);
  const setParent = useMenuExtrasStore((state) => state.setParent);
  const [parentId, setParentId] = useState('');
  const [name, setName] = useState('');
  const stations = useStationStore((state) => state.stations);
  const loadStations = useStationStore((state) => state.load);
  const [station, setStation] = useState('');
  const [stationDraft, setStationDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [stationSaving, setStationSaving] = useState(false);
  const savedCategory = useRef<CategoryDto | null>(null);

  useEffect(() => {
    if (isOpen) void loadStations().catch((caught) => setError(String(caught)));
  }, [isOpen, loadStations]);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(category?.name ?? '');
    setStation(category?.defaultStation ?? '');
    setParentId(category ? useMenuExtrasStore.getState().parents[category.id] ?? '' : '');
    savedCategory.current = null;
    setStationDraft(null);
    setError(null);
  }, [isOpen, category?.id]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || busy || stationSaving || stationDraft !== null) return;
    if (!name.trim()) {
      setError('Kategori adı zorunludur.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // Üst kategori kaydı reddedilirse yeniden deneme ikinci bir kategori oluşturmaz.
      const existing = category ?? savedCategory.current;
      const success = existing
        ? await updateCategory(existing, name.trim(), station)
        : await createCategory(name.trim(), station, (created) => { savedCategory.current = created; });
      if (!success) throw new Error(useMenuStore.getState().error ?? 'Kategori kaydedilemedi.');
      const saved = existing ?? savedCategory.current;
      if (!saved) throw new Error('Kategori kimliği alınamadı.');
      if ((useMenuExtrasStore.getState().parents[saved.id] ?? '') !== parentId) {
        await setParent(saved.id, parentId || null);
      }
      onCreated?.({ ...saved, name: name.trim(), defaultStation: station });
      onClose();
    } catch (caught) {
      setError(String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal cardFlow isOpen onClose={() => { if (!saving && !stationSaving) onClose(); }} title={category ? 'Kategoriyi Düzenle' : 'Kategori Ekle'} maxWidth="sm">
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <ErrorToast message={error} />
          )}

          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
              Kategori Adı
            </label>
            <input
              type="text"
              aria-label="Kategori adı"
              value={name} onBlur={(event) => setName(capitalizeRecordName(event.currentTarget.value))}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md min-h-12 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
              Varsayılan İstasyon
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => setStation('')} className="min-h-12 border border-[var(--border)] rounded-md" aria-pressed={station === ''}>İstasyon yok</button>
              {stations.map(({ name: st }) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStation(st)}
                  aria-pressed={station === st}
                  className={`min-h-12 px-1 text-sm font-bold rounded-md border cursor-pointer text-center transition-colors ${
                    station === st
                      ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border-[var(--accent-blue)] shadow-[inset_0_0_0_1px_var(--accent-blue)]'
                      : 'bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
            {stationDraft === null ? (
              <button type="button" className="min-h-12 font-bold" onClick={() => setStationDraft('')}>Yeni istasyon oluştur</button>
            ) : (
              <div className="mt-2 space-y-2 border border-[var(--border)] rounded-md p-2">
                <label className="block text-sm">İstasyon adı
                  <input value={stationDraft} disabled={stationSaving} onChange={(event) => setStationDraft(event.target.value)} className="block w-full min-h-12 px-3 border border-[var(--border)] rounded-md" />
                </label>
                <div className="flex gap-2">
                  <button type="button" disabled={stationSaving} className="min-h-12 px-3" onClick={() => setStationDraft(null)}>Vazgeç</button>
                  <button type="button" disabled={stationSaving || !stationDraft.trim()} className="min-h-12 px-3 font-bold" onClick={async () => {
                    setStationSaving(true);
                    setError(null);
                    try {
                      const created = await useStationStore.getState().create(stationDraft);
                      setStation(created.name);
                      setStationDraft(null);
                    } catch (caught) {
                      setError(String(caught));
                    } finally {
                      setStationSaving(false);
                    }
                  }}>İstasyonu oluştur</button>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-bold mb-1">Üst Kategori</label>
            <select
              aria-label="Üst kategori"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
              className="w-full min-h-12 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm"
            >
              <option value="">Yok</option>
              {categories
                .filter((item) => item.id !== category?.id && !parents[item.id])
                .map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
            </select>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || stationSaving}
              className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-sm font-bold text-[var(--text-primary)] border border-[var(--border)] cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={busy || saving || stationSaving || stationDraft !== null}
              className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-sm font-bold text-white flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <span>Kaydet</span>
            </button>
          </div>
        </form>
    </Modal>
  );
};
