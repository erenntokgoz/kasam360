import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, fitSize, fitUnderLimit, isAcceptedImage } from './productImage';

const webp = (size: number) => new Blob([new Uint8Array(size)], { type: 'image/webp' });

describe('ürün görseli küçültme', () => {
  it('en uzun kenarı 1600 pikselde sınırlar, oranı korur, küçüğü büyütmez', () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(3000, 6000)).toEqual({ width: 800, height: 1600 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it('JPG, PNG, WebP, GIF ve HEIC kabul eder; türü boş HEIC dosyayı uzantıdan tanır', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic']) {
      expect(isAcceptedImage({ type, name: 'a' })).toBe(true);
    }
    expect(isAcceptedImage({ type: '', name: 'foto.HEIC' })).toBe(true);
    expect(isAcceptedImage({ type: 'application/pdf', name: 'a.pdf' })).toBe(false);
    expect(isAcceptedImage({ type: '', name: 'a.txt' })).toBe(false);
  });

  it('0.82 kalitede sığıyorsa ilk denemeyi kullanır', async () => {
    const calls: Array<[number, number]> = [];
    const blob = await fitUnderLimit(async (q, s) => { calls.push([q, s]); return webp(1000); });
    expect(blob.size).toBe(1000);
    expect(calls).toEqual([[0.82, 1]]);
  });

  it('sığmazsa kaliteyi düşürür, sonra ölçüyü', async () => {
    const calls: Array<[number, number]> = [];
    const blob = await fitUnderLimit(async (q, s) => {
      calls.push([q, s]);
      return webp(s === 1 ? MAX_IMAGE_BYTES + 1 : MAX_IMAGE_BYTES);
    });
    expect(blob.size).toBe(MAX_IMAGE_BYTES);
    expect(calls[1]?.[0]).toBeLessThan(0.82);
    expect(calls[calls.length - 1]?.[1]).toBe(0.75);
  });

  it('hiçbir ayarda sığmazsa açık hata verir', async () => {
    await expect(fitUnderLimit(async () => webp(MAX_IMAGE_BYTES + 1))).rejects.toThrow('1,5 MB');
  });

  it('WebP üretilemezse PNG’ye düşmez, hata verir', async () => {
    await expect(fitUnderLimit(async () => new Blob([new Uint8Array(10)], { type: 'image/png' })))
      .rejects.toThrow('WebP');
    await expect(fitUnderLimit(async () => null)).rejects.toThrow('WebP');
  });
});
