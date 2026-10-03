/**
 * Faz 13 · Kroki düzeni veri hook'u.
 *
 * Tasarım kararı: hook **çizim durumunu** (draft) tutar ve kaydetmeden önce
 * doğrulama yapar. Neden ayrı draft: kullanıcı masayı sürükler, ekranı kapatır,
 * kaydetmezse veri tabanı **aynı kalır**. Taslak otomatik kaydedilse bir masa
 * 5 piksel kayar ve patron "bana kim dokundu?" diye sorar; kaydedilmemiş taslak
 * ise sorun değildir.
 *
 * Kaydetme tek tuşla ve atomiktir: backend ya hepsini yazar ya hiçbirini.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { tauriInvoke } from '../../../../data/ipc/tauriInvoke';
import {
  DEFAULT_OBJECT_SIZE,
  type CreateObjectInput,
  type FloorLayout,
  type FloorObject,
  type FloorTemplateInfo,
  type LayoutTable,
  type ObjectKind,
  type SaveLayoutInput,
} from './krokiTypes';
import { snapPoint, snapRotation, validateLayoutDraft } from './snap';

/** Taslak hata mesajı veya null. */
export interface FloorLayoutDraft {
  tables: LayoutTable[];
  objects: FloorObject[];
}

export interface UseFloorLayoutResult {
  layout: FloorLayout | null;
  templates: FloorTemplateInfo[];
  draft: FloorLayoutDraft;
  /** Değişiklik var mı? Kaydet butonu yalnız burada yanar. */
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** Seçili öğenin kimliği (tablo veya obje). */
  selectedId: string | null;
  select: (id: string | null) => void;
  moveTable: (id: string, x: number, y: number) => void;
  rotateTable: (id: string, rotation: number) => void;
  setSeats: (id: string, seats: number) => void;
  assignZone: (id: string, zoneId: string | null) => void;
  moveObject: (id: string, x: number, y: number) => void;
  addObject: (kind: ObjectKind, x: number, y: number, zoneId: string | null) => Promise<void>;
  removeObject: (id: string) => Promise<void>;
  applyTemplate: (templateId: string) => Promise<void>;
  save: () => Promise<boolean>;
  reload: () => Promise<void>;
}

const BOS_DUZEN: FloorLayoutDraft = { tables: [], objects: [] };

export function useFloorLayout(canEdit: boolean, zoneId: string | null): UseFloorLayoutResult {
  const [layout, setLayout] = useState<FloorLayout | null>(null);
  const [templates, setTemplates] = useState<FloorTemplateInfo[]>([]);
  const [draft, setDraft] = useState<FloorLayoutDraft>(BOS_DUZEN);
  const [baseline, setBaseline] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [duzen, sablonlar] = await Promise.all([
        tauriInvoke<FloorLayout>('get_floor_layout', { zoneId }),
        tauriInvoke<FloorTemplateInfo[]>('list_floor_templates', {}),
      ]);
      const taslak: FloorLayoutDraft = { tables: duzen.tables, objects: duzen.objects };
      setLayout(duzen);
      setTemplates(sablonlar);
      setDraft(taslak);
      setBaseline(JSON.stringify(taslak));
    } catch (hata) {
      setError(hata instanceof Error ? hata.message : 'Kroki okunamadı');
    } finally {
      setLoading(false);
    }
  }, [zoneId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Izgara ve döndürme kuralları backend'den gelir; frontend sabit kodlamaz. */
  const kurallar = useMemo(
    () => ({
      grid: layout?.grid ?? 20,
      rotationStep: layout?.rotation_step ?? 15,
      canvasWidth: layout?.canvas_width ?? 4000,
      canvasHeight: layout?.canvas_height ?? 3000,
    }),
    [layout],
  );

  const dirty = JSON.stringify(draft) !== baseline;

  /** Taslak güncellemesi tek noktadan; her hareket aynı kurallardan geçer. */
  const hedefle = useCallback(
    (x: number, y: number) =>
      snapPoint(x, y, kurallar.grid, {
        width: kurallar.canvasWidth,
        height: kurallar.canvasHeight,
      }),
    [kurallar],
  );

  const moveTable = useCallback(
    (id: string, x: number, y: number) => {
      const nokta = hedefle(x, y);
      setDraft((oncekisi) => ({
        ...oncekisi,
        tables: oncekisi.tables.map((masa) =>
          masa.id === id ? { ...masa, x: nokta.x, y: nokta.y } : masa,
        ),
      }));
    },
    [hedefle],
  );

  const rotateTable = useCallback((id: string, rotation: number) => {
    const aci = snapRotation(rotation, 15);
    setDraft((oncekisi) => ({
      ...oncekisi,
      tables: oncekisi.tables.map((masa) =>
        masa.id === id ? { ...masa, rotation: aci } : masa,
      ),
    }));
  }, []);

  const setSeats = useCallback((id: string, seats: number) => {
    setDraft((oncekisi) => ({
      ...oncekisi,
      tables: oncekisi.tables.map((masa) => (masa.id === id ? { ...masa, seats } : masa)),
    }));
  }, []);

  const assignZone = useCallback((id: string, yeniBolum: string | null) => {
    setDraft((oncekisi) => ({
      ...oncekisi,
      tables: oncekisi.tables.map((masa) =>
        masa.id === id ? { ...masa, zone_id: yeniBolum } : masa,
      ),
      objects: oncekisi.objects.map((obje) =>
        obje.id === id ? { ...obje, zone_id: yeniBolum } : obje,
      ),
    }));
  }, []);

  const moveObject = useCallback(
    (id: string, x: number, y: number) => {
      const nokta = hedefle(x, y);
      setDraft((oncekisi) => ({
        ...oncekisi,
        objects: oncekisi.objects.map((obje) =>
          obje.id === id ? { ...obje, x: nokta.x, y: nokta.y } : obje,
        ),
      }));
    },
    [hedefle],
  );

  const addObject = useCallback(
    async (kind: ObjectKind, x: number, y: number, bolum: string | null) => {
      const nokta = hedefle(x, y);
      const olcu = DEFAULT_OBJECT_SIZE[kind];
      const govde: CreateObjectInput = {
        zone_id: bolum,
        kind,
        label: null,
        x: nokta.x,
        y: nokta.y,
        width: olcu.width,
        height: olcu.height,
        rotation: 0,
      };
      try {
        // Obje **önce** kaydedilir, sonra taslağa eklenir. Taslağa eklenip
        // kayıt başarısız olursa krokide hayalet bir obje kalır ve sonraki
        // kaydetme "obje bulunamadı" ile tüm düzeni reddeder.
        const id = await tauriInvoke<string>('create_floor_object', { args: govde });
        setDraft((oncekisi) => ({
          ...oncekisi,
          objects: [...oncekisi.objects, { ...govde, id, is_active: true } as FloorObject],
        }));
        setError(null);
      } catch (hata) {
        setError(hata instanceof Error ? hata.message : 'Obje eklenemedi');
      }
    },
    [hedefle],
  );

  const removeObject = useCallback(async (id: string) => {
    try {
      await tauriInvoke<void>('delete_floor_object', { objectId: id });
      setDraft((oncekisi) => ({
        ...oncekisi,
        objects: oncekisi.objects.filter((obje) => obje.id !== id),
      }));
      setSelectedId(null);
    } catch (hata) {
      setError(hata instanceof Error ? hata.message : 'Obje silinemedi');
    }
  }, []);

  const applyTemplate = useCallback(async (templateId: string) => {
    try {
      await tauriInvoke<string>('apply_floor_template', { templateId });
      // Şablon taslağı doğrudan değiştirir: kaydetmeden "geri al" yolu
      // kalmaz, kullanıcı ne yaptığını bilir.
      await reload();
    } catch (hata) {
      setError(hata instanceof Error ? hata.message : 'Şablon uygulanamadı');
    }
  }, [reload]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!canEdit) {
      setError('UNAUTHORIZED: bu salon görünümünde kroki kaydedilemez');
      return false;
    }
    const hata = validateLayoutDraft(draft, kurallar);
    if (hata) {
      setError(hata);
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const govde: SaveLayoutInput = {
        tables: draft.tables.map((masa) => ({
          table_id: masa.id,
          x: masa.x,
          y: masa.y,
          rotation: masa.rotation,
          seats: masa.seats,
          zone_id: masa.zone_id,
        })),
        objects: draft.objects.map((obje) => ({
          object_id: obje.id,
          zone_id: obje.zone_id,
          kind: obje.kind,
          label: obje.label,
          x: obje.x,
          y: obje.y,
          width: obje.width,
          height: obje.height,
          rotation: obje.rotation,
        })),
      };
      await tauriInvoke<void>('save_floor_layout', { args: govde });
      setBaseline(JSON.stringify(draft));
      return true;
    } catch (hata2) {
      setError(hata2 instanceof Error ? hata2.message : 'Kroki kaydedilemedi');
      return false;
    } finally {
      setSaving(false);
    }
  }, [canEdit, draft, kurallar]);

  return {
    layout,
    templates,
    draft,
    dirty,
    loading,
    saving,
    error,
    selectedId,
    select: setSelectedId,
    moveTable,
    rotateTable,
    setSeats,
    assignZone,
    moveObject,
    addObject,
    removeObject,
    applyTemplate,
    save,
    reload,
  };
}