/** Ürün görseli: en uzun kenar 1600 px'e iner, WebP'ye çevrilir, 1,5 MiB'ı aşmaz. */
export const MAX_IMAGE_EDGE = 1600;
export const MAX_IMAGE_BYTES = 1_572_864;
const QUALITIES = [0.82, 0.72, 0.62, 0.5, 0.4, 0.3];
const SCALES = [1, 0.75, 0.5];
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
const ACCEPTED_NAME = /\.(jpe?g|png|webp|gif|heic|heif)$/i;

export const IMAGE_ACCEPT = [...ACCEPTED_TYPES, '.heic', '.heif'].join(',');

export function isAcceptedImage(file: { type: string; name: string }): boolean {
  return ACCEPTED_TYPES.includes(file.type) || (file.type === '' && ACCEPTED_NAME.test(file.name));
}

/** En uzun kenar sınırı aşarsa oran korunarak küçülür; küçük görsel büyütülmez. */
export function fitSize(width: number, height: number, maxEdge = MAX_IMAGE_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/**
 * Kaliteyi, gerekirse ölçüyü düşürerek sınıra sığan ilk WebP'yi döndürür. Önce 0.82 denenir;
 * kodlayıcı WebP üretemiyorsa (`null` ya da başka tür) sessizce PNG'ye düşülmez, hata verilir.
 */
export async function fitUnderLimit(
  encode: (quality: number, scale: number) => Promise<Blob | null>,
  limit = MAX_IMAGE_BYTES,
): Promise<Blob> {
  for (const scale of SCALES) {
    for (const quality of QUALITIES) {
      const blob = await encode(quality, scale);
      if (!blob || blob.type !== 'image/webp') {
        throw new Error('Bu cihazın görüntü motoru WebP üretemiyor. Uygulamayı güncelleyin.');
      }
      if (blob.size <= limit) return blob;
    }
  }
  throw new Error('Görsel 1,5 MB altına indirilemedi. Daha küçük bir görsel seçin.');
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Ürün görseli okunamadı.')));
    reader.onerror = () => reject(new Error('Ürün görseli okunamadı.'));
    reader.readAsDataURL(blob);
  });
}

function isHeic(file: File): boolean {
  return file.type === 'image/heic' || file.type === 'image/heif' || /\.(heic|heif)$/i.test(file.name);
}

/** Seçilen dosyayı yayınlanabilir WebP veri adresine çevirir. */
export async function prepareProductImage(file: File): Promise<string> {
  if (!isAcceptedImage(file)) {
    throw new Error('JPG, PNG, WebP, GIF veya HEIC bir görsel seçin.');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(isHeic(file)
      ? 'Bu cihaz HEIC görselleri açamıyor. Görseli JPG veya PNG olarak kaydedip seçin.'
      : 'Görsel açılamadı. Dosya bozuk olabilir.');
  }
  try {
    const base = fitSize(bitmap.width, bitmap.height);
    const blob = await fitUnderLimit((quality, scale) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(base.width * scale));
      canvas.height = Math.max(1, Math.round(base.height * scale));
      const context = canvas.getContext('2d');
      if (!context) return Promise.reject(new Error('Görsel işlenemedi.'));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    });
    return await readAsDataUrl(blob);
  } finally {
    bitmap.close();
  }
}
