import { describe, expect, it } from 'vitest';
import { CANVAS_HEIGHT, CANVAS_WIDTH, clampToCanvas, dragPosition, pointerToWorld, rotateByStep, rotatedBounds } from './krokiGeometry';
import { getBlueprintCanvasSize } from '../features/floor/blueprintView';

const SIZE = { width: 110, height: 110 };

describe('pointerToWorld', () => {
  it('ölçek ve kaydırma ne olursa olsun aynı dünya noktasını verir', () => {
    // Dünyada (300,200) noktası; farklı ölçek ve kaydırma/konteyner kaymaları.
    for (const scale of [0.5, 1, 1.6, 2]) {
      for (const shift of [{ x: 24, y: 80 }, { x: -400, y: -30 }]) {
        const screen = { x: shift.x + 300 * scale, y: shift.y + 200 * scale };
        const world = pointerToWorld(screen, shift, scale);
        expect(world.x).toBeCloseTo(300);
        expect(world.y).toBeCloseTo(200);
      }
    }
  });
});

describe('dragPosition', () => {
  const grabAt = (x: number, y: number, pointer: { x: number; y: number }) => ({ x: pointer.x - x, y: pointer.y - y });

  it('imleç tutulan noktayı korur ve ızgaraya yuvarlar', () => {
    const grab = grabAt(200, 100, { x: 230, y: 130 });
    expect(dragPosition({ x: 333, y: 247 }, grab, SIZE, 0)).toEqual({ x: 300, y: 220 });
  });

  it('aynı fare yolu farklı zoom düzeyinde aynı kayıtlı konumu üretir', () => {
    const origin = { x: 40, y: 120 };
    const results = [0.5, 1, 2].map((scale) => {
      const toScreen = (world: { x: number; y: number }) => ({ x: origin.x + world.x * scale, y: origin.y + world.y * scale });
      const grab = grabAt(200, 100, pointerToWorld(toScreen({ x: 230, y: 130 }), origin, scale));
      return dragPosition(pointerToWorld(toScreen({ x: 530, y: 430 }), origin, scale), grab, SIZE, 0);
    });
    expect(results[0]).toEqual({ x: 500, y: 400 });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it('negatif ve tuval dışı konuma çıkmaz', () => {
    expect(dragPosition({ x: -500, y: -500 }, { x: 0, y: 0 }, SIZE, 0)).toEqual({ x: 10, y: 0 });
    const far = dragPosition({ x: 99999, y: 99999 }, { x: 0, y: 0 }, SIZE, 0);
    expect(far.x).toBeLessThanOrEqual(CANVAS_WIDTH - SIZE.width);
    expect(far.y).toBeLessThanOrEqual(CANVAS_HEIGHT - SIZE.height);
  });

  it('(0,0) yerleştirilmemiş sayıldığından bu kareye bırakılan masa kaydırılır', () => {
    expect(dragPosition({ x: 3, y: 2 }, { x: 0, y: 0 }, SIZE, 0)).toEqual({ x: 10, y: 0 });
  });
});

describe('dönüş', () => {
  it('her adım 45 derecedir ve 360 sonrası başa döner', () => {
    expect(Array.from({ length: 9 }, (_, index) => rotateByStep(index * 45))).toEqual([45, 90, 135, 180, 225, 270, 315, 0, 45]);
    expect(rotateByStep(-45)).toBe(0);
  });

  it('döndürülen kutunun merkezi sabit kalır', () => {
    const bounds = rotatedBounds({ x: 100, y: 100, ...SIZE }, 45);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(155);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(155);
    expect(bounds.width).toBeCloseTo(110 * Math.SQRT2);
  });

  it('döndürülmüş masa köşede tuvalin dışına taşmaz', () => {
    const position = clampToCanvas({ x: 0, y: 0 }, SIZE, 45);
    const bounds = rotatedBounds({ ...position, ...SIZE }, 45);
    expect(bounds.x).toBeGreaterThanOrEqual(-1e-9);
    expect(bounds.y).toBeGreaterThanOrEqual(-1e-9);
  });
});

describe('oda tuvali', () => {
  it('pencere boyutu değişince yalnız sağ ve alt kenar uzar, sol-üst başlangıç sabit kalır', () => {
    expect(getBlueprintCanvasSize(800, 500, 1000, 700, 1)).toEqual({ width: 952, height: 652 });
    expect(getBlueprintCanvasSize(800, 500, 1800, 1100, 1)).toEqual({ width: 1752, height: 1052 });
    expect(pointerToWorld({ x: 24 + 300, y: 24 + 200 }, { x: 24, y: 24 }, 1)).toEqual({ x: 300, y: 200 });
  });
});
