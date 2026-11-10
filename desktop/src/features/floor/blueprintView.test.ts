import { describe, expect, it } from 'vitest';
import type { FloorZone } from '../../types/floor';
import { DEFAULT_SCALE, getBlueprintCanvasSize, getBlueprintZoneId, getFloorObjectWidth, rotateFloorObject } from './blueprintView';

const zones = [{ id: 'salon', name: 'Salon', tableCount: 4 }, { id: 'bahce', name: 'Bahçe', tableCount: 2 }] satisfies FloorZone[];

describe('kroki görünümü', () => {
  it('seçili kısım yoksa yalnız ilk kısmı gösterir', () => {
    expect(getBlueprintZoneId(null, zones)).toBe('salon');
    expect(getBlueprintZoneId(null, [])).toBeNull();
  });

  it('seçili kısmı korur', () => {
    expect(getBlueprintZoneId('bahce', zones)).toBe('bahce');
    expect(getBlueprintZoneId('removed-zone', zones)).toBe('salon');
  });

  it('varsayılan ölçek kısım boyutuna ve ekrana bakmadan 1 kalır', () => {
    expect(DEFAULT_SCALE).toBe(1);
  });

  it('canvası viewportun dikdörtgenine genişletirken dünya ölçülerini korur', () => {
    expect(getBlueprintCanvasSize(1250, 950, 2048, 1053, 1)).toEqual({ width: 2000, height: 1005 });
    expect(getBlueprintCanvasSize(3000, 1800, 900, 600, 1)).toEqual({ width: 3000, height: 1800 });
  });

  it('ince mimari öğelerin etiketine göre genişliğini artırır', () => {
    expect(getFloorObjectWidth('Kapı')).toBe(140);
    expect(getFloorObjectWidth('Balkon kapısı')).toBe(140);
    expect(getFloorObjectWidth('Uzun bir pencere tanımı')).toBeGreaterThan(140);
  });

  it('kapı ve pencere dönüşünü 45 derecelik adımlarla daire içinde ilerletir', () => {
    expect(Array.from({ length: 9 }, (_, index) => rotateFloorObject(index * 45))).toEqual([45, 90, 135, 180, 225, 270, 315, 0, 45]);
    expect(rotateFloorObject(-45)).toBe(0);
  });
});
