import type { FloorZone } from '../../types/floor';
import { rotateByStep } from '../../lib/krokiGeometry';

/** Kroki kenar boşluğu (her yanda 24px). Salon ve editör aynı değeri kullanır. */
const FRAME_PADDING = 48;

/** Varsayılan ölçek her zaman 1'dir: masalar ekrana sığsın diye küçülmez, büyümez. */
export const DEFAULT_SCALE = 1;

export function getBlueprintZoneId(selectedZoneId: string | null, zones: FloorZone[]): string | null {
  return selectedZoneId && zones.some((zone) => zone.id === selectedZoneId) ? selectedZoneId : zones[0]?.id ?? null;
}

/**
 * Dünya ölçüsündeki oda, görünür dikdörtgenin kalanını doldurur (kareye sıkışmaz).
 * Yalnız sağ/alt kenar uzar; sol-üst başlangıç sabit olduğundan hiçbir masa yer değiştirmez.
 */
export function getBlueprintCanvasSize(layoutWidth: number, layoutHeight: number, frameWidth: number, frameHeight: number, scale: number) {
  return {
    width: Math.max(layoutWidth, Math.max(0, (frameWidth - FRAME_PADDING) / scale)),
    height: Math.max(layoutHeight, Math.max(0, (frameHeight - FRAME_PADDING) / scale)),
  };
}

export function getFloorObjectWidth(label: string): number {
  return Math.min(360, Math.max(140, label.trim().length * 8 + 24));
}

export const rotateFloorObject = rotateByStep;
