// Görsel türü başlığa değil baytlara bakılarak doğrulanır; yalnız WebP kabul edilir.

export const MAX_IMAGE_BYTES = 1_572_864;
export const MAX_IMAGE_SIDE = 1600;

export type WebpResult =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: 'not_webp' | 'invalid' };

const ascii = (bytes: Uint8Array, start: number, text: string) =>
  bytes.length >= start + text.length && [...text].every((char, index) => bytes[start + index] === char.charCodeAt(0));

export function inspectWebp(bytes: Uint8Array): WebpResult {
  if (bytes.length < 30 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP')) return { ok: false, reason: 'not_webp' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // RIFF boyut alanı dosyayı kesilmiş ya da arkasına bayt eklenmiş göstermemeli.
  if (view.getUint32(4, true) + 8 !== bytes.length) return { ok: false, reason: 'invalid' };
  let width: number;
  let height: number;
  if (ascii(bytes, 12, 'VP8 ')) {
    // Kayıplı: kare başlığı 0x9d 0x01 0x2a, ardından 14 bit genişlik/yükseklik.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return { ok: false, reason: 'invalid' };
    width = view.getUint16(26, true) & 0x3fff;
    height = view.getUint16(28, true) & 0x3fff;
  } else if (ascii(bytes, 12, 'VP8L')) {
    if (bytes[20] !== 0x2f) return { ok: false, reason: 'invalid' };
    const bits = view.getUint32(21, true);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else if (ascii(bytes, 12, 'VP8X')) {
    width = (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1;
    height = (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1;
  } else {
    return { ok: false, reason: 'invalid' };
  }
  if (width < 1 || height < 1 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) return { ok: false, reason: 'invalid' };
  return { ok: true, width, height };
}
