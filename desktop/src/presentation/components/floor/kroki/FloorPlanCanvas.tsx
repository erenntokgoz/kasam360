/**
 * Faz 13 · Kroki çizim yüzeyi.
 *
 * Sürükleme dnd-kit ile yapılır. Elle pointer dinlemek yerine kütüphane
 * kullanılmasının nedeni: dokunmatik, fare ve klavye desteği hazırdır. Elle
 * yazılan sürükleme klavye odağını kaybeder ve krokiyle hiç etkileşim
 * kurulamaz.
 *
 * **Ölçek sözleşmesi**: kroki koordinatları 4000x3000'lük mantıksal tuvalde
 * yaşar; ekranda yüzde 32 ölçekle görünür. Sürükleme dnd-kit'ten **ekran
 * pikseli** olarak gelir, bu yüzden ekran delta'sı mantıksal koordinata
 * çevrilmek zorundadır. Yanlış çeviri, 100 piksel sürüklemeyi 3 piksele
 * indirir ve masa "kaymıyor" gibi görünür. Dönüşüm tek yerde hesaplanır:
 * `olcekOlustur`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { ArchitecturalObject } from './ArchitecturalObject';
import { FloorPlanToolbar } from './FloorPlanToolbar';
import { SelectionBar } from './SelectionBar';
import { TableShape } from './TableShape';
import { olcekOlustur } from './snap';
import { useFloorLayout } from './useFloorLayout';
import type { FloorObject, LayoutTable, ObjectKind } from './krokiTypes';

/** Yeni obje, görünür alanın merkezine konur. */
const YENI_OBJE_MERKEZI = { x: 2000, y: 1500 } as const;

export interface FloorPlanCanvasProps {
  canEdit: boolean;
  zoneId: string | null;
}

export function FloorPlanCanvas({ canEdit, zoneId }: FloorPlanCanvasProps) {
  const kroki = useFloorLayout(canEdit, zoneId);
  const [aktifTuru, setAktifTuru] = useState<string | null>(null);
  const [ekranGenislik, setEkrangenislik] = useState(0);
  const yuzeyRef = useRef<HTMLDivElement | null>(null);

  const mantiksalGenislik = kroki.layout?.canvas_width ?? 4000;
  const olcek = useMemo(
    () => olcekOlustur(ekranGenislik, mantiksalGenislik),
    [ekranGenislik, mantiksalGenislik],
  );

  // Yüzey genişliği kutu açıldığında ölçülür. Sabit yüzde kullanmak yanlıştır:
  // ekran genişliği değişince kroki farklı ölçeklenir ve konum kayar.
  useEffect(() => {
    const yuzey = yuzeyRef.current;
    if (!yuzey) return;
    const olc = () => setEkrangenislik(yuzey.getBoundingClientRect().width);
    olc();
    const gozlemci = new ResizeObserver(olc);
    gozlemci.observe(yuzey);
    return () => gozlemci.disconnect();
  }, [kroki.loading, kroki.layout]);

  const sensors = useSensors(
    // 4 piksel eşik: eşiğin altındaki her tık sürüklemeye dönüşürse krokide
    // masaya tıklamak imkânsızlaşır.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const baslangicKonumlari = useRef<Record<string, { x: number; y: number }>>({});

  const onDragBaslangic = useCallback(
    (olay: DragStartEvent) => {
      const kimlik = String(olay.active.id);
      setAktifTuru(kimlik);
      const masa = kroki.draft.tables.find((t) => t.id === kimlik);
      const obje = kroki.draft.objects.find((o) => o.id === kimlik);
      const kaynak = masa ?? obje;
      if (kaynak) {
        baslangicKonumlari.current[kimlik] = { x: kaynak.x, y: kaynak.y };
      }
    },
    [kroki.draft],
  );

  const onDragBitis = useCallback(
    (olay: DragEndEvent) => {
      const kimlik = String(olay.active.id);
      setAktifTuru(null);
      const baslangic = baslangicKonumlari.current[kimlik];
      if (!baslangic) return;
      delete baslangicKonumlari.current[kimlik];

      const mantiksal = {
        x: baslangic.x + olay.delta.x * olcek,
        y: baslangic.y + olay.delta.y * olcek,
      };
      if (kroki.draft.tables.some((t) => t.id === kimlik)) {
        kroki.moveTable(kimlik, mantiksal.x, mantiksal.y);
      } else if (kroki.draft.objects.some((o) => o.id === kimlik)) {
        kroki.moveObject(kimlik, mantiksal.x, mantiksal.y);
      }
    },
    [kroki, olcek],
  );

  const ekleObje = (tur: ObjectKind) => {
    void kroki.addObject(tur, YENI_OBJE_MERKEZI.x, YENI_OBJE_MERKEZI.y, zoneId);
  };

  if (kroki.loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm opacity-60">
        Kroki yükleniyor
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <FloorPlanToolbar
        templates={kroki.templates}
        dirty={kroki.dirty}
        saving={kroki.saving}
        canEdit={canEdit}
        error={kroki.error}
        onAddObject={ekleObje}
        onApplyTemplate={kroki.applyTemplate}
        onSave={() => void kroki.save()}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--glass-thin)] backdrop-blur-xl">
        {/*
          Ölçek sarmalayıcısı: 4000x3000 mantıksal tuvelin tamamı tek bir
          `scale` ile ekrana sığdırılır. Böylece masa, obje ve ızgara **aynı**
          çarpanı paylaşır. Her bileşene ayrı ölçek geçirmek, birinin
          unutulmasına ve objenin masadan farklı büyümesine yol açar.
        */}
        <div
          style={{
            width: mantiksalGenislik,
            height: kroki.layout?.canvas_height ?? 3000,
            transform: `scale(${olcek})`,
            transformOrigin: 'top left',
          }}
        >
          <Izgara
            grid={kroki.layout?.grid ?? 20}
            genislik={kroki.layout?.canvas_width ?? 4000}
            yukseklik={kroki.layout?.canvas_height ?? 3000}
          />

          <DndContext
            sensors={sensors}
            onDragStart={onDragBaslangic}
            onDragEnd={onDragBitis}
            onDragCancel={() => setAktifTuru(null)}
          >
            {/* Katman sırası: objeler masaların altında. Masaya tıklanır; objeye
              tıklamak kastedmiyorsa masanın önde kalması kullanıcıyı yanıltmaz. */}
            {kroki.draft.objects.map((obje) => (
              <Suruklenebilir
                key={obje.id}
                id={obje.id}
                baslangic={{ x: obje.x, y: obje.y }}
                disabled={!canEdit}
                onSecildi={kroki.select}
              >
                <ArchitecturalObject
                  object={obje}
                  selected={kroki.selectedId === obje.id}
                  onSelect={kroki.select}
                  draggable={canEdit}
                />
              </Suruklenebilir>
            ))}

            {kroki.draft.tables.map((masa) => (
              <Suruklenebilir
                key={masa.id}
                id={masa.id}
                baslangic={{ x: masa.x, y: masa.y }}
                disabled={!canEdit}
                onSecildi={kroki.select}
              >
                <TableShape
                  table={masa}
                  selected={kroki.selectedId === masa.id}
                  onSelect={kroki.select}
                  draggable={canEdit}
                />
              </Suruklenebilir>
            ))}

            <DragOverlay>
              {aktifTuru ? (
                <SuruklemeKopya
                  masa={kroki.draft.tables.find((t) => t.id === aktifTuru)}
                  obje={kroki.draft.objects.find((o) => o.id === aktifTuru)}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>

      <SelectionBar
        table={kroki.draft.tables.find((t) => t.id === kroki.selectedId)}
        object={kroki.draft.objects.find((o) => o.id === kroki.selectedId)}
        canEdit={canEdit}
        onRotate={kroki.rotateTable}
        onSeats={kroki.setSeats}
        onDeleteObject={(id) => void kroki.removeObject(id)}
      />
    </div>
  );
}

/**
 * Sürüklenebilir sarmalayıcı.
 *
 * Neden `left/top` doğrudan yazılıyor: dnd-kit öğeyi `transform` ile taşır.
 * Kroki koordinatı CSS `left/top` olarak yazılırsa sürükleme sırasında
 * `transform` devreye girer ve bırakınca temizlenir; konum kaynağı tek kalır.
 */
function Suruklenebilir({
  id,
  baslangic,
  children,
  disabled,
  onSecildi,
}: {
  id: string;
  baslangic: { x: number; y: number };
  children: React.ReactNode;
  disabled: boolean;
  onSecildi: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onSecildi(id)}
      style={{
        position: 'absolute',
        left: baslangic.x,
        top: baslangic.y,
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
      }}
    >
      {children}
    </div>
  );
}

/** Sürükleme sırasında imlecin altındaki kopya. */
function SuruklemeKopya({
  masa,
  obje,
}: {
  masa: LayoutTable | undefined;
  obje: FloorObject | undefined;
}) {
  if (masa) {
    return <TableShape table={masa} selected onSelect={() => undefined} draggable />;
  }
  if (obje) {
    return (
      <ArchitecturalObject object={obje} selected onSelect={() => undefined} draggable />
    );
  }
  return null;
}

/**
 * Izgara arka planı.
 *
 * Neden CSS `background-image` değil: 20 px ızgara %32 ölçekte ekranda ~6 piksele
 * denk gelir. CSS ile çizilirse satırlar arasında moiré oluşur; SVG
 * `shapeRendering="crispEdges"` verildiği için çizgi kalınlığı sabit kalır ve
 * ızgara zıplamaz.
 *
 * `viewBox` mantıksal tuvali tanımlar; yukarıdaki `scale` sarmalayıcısıyla
 * birlikte ızgara tam olarak sürükleme konumlarıyla hizalı çizilir.
 */
function Izgara({
  grid,
  genislik,
  yukseklik,
}: {
  grid: number;
  genislik: number;
  yukseklik: number;
}) {
  const adim = Math.max(grid, 1);
  return (
    <svg
      aria-hidden="true"
      className="pointer-none absolute inset-0"
      width={genislik}
      height={yukseklik}
      viewBox={`0 0 ${genislik} ${yukseklik}`}
      shapeRendering="crispEdges"
    >
      <defs>
        <pattern
          id="kroki-izgara"
          width={adim}
          height={adim}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${adim} 0 L 0 0 0 ${adim}`}
            fill="none"
            stroke="var(--border)"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width={genislik} height={yukseklik} fill="url(#kroki-izgara)" />
    </svg>
  );
}