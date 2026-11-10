/**
 * Tarih ve saat biçimlendirme yardımcıları.
 * Arayüzde tabular-nums ile net ve hizalı gösterim sağlar.
 */

export function formatTime(dateInput?: string | Date | number): string {
  const d = dateInput ? toDate(dateInput) : new Date();
  if (isNaN(d.getTime())) return '--:--';
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** SQLite `datetime('now')` UTC yazar ama dilim eki taşımaz; yerel sanılırsa saat üç saat geri görünür. */
function toDate(dateInput: string | Date | number): Date {
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(dateInput)) {
    return new Date(`${dateInput.replace(' ', 'T')}Z`);
  }
  return new Date(dateInput);
}

export function formatDateTime(dateInput?: string | Date | number): string {
  const d = dateInput ? toDate(dateInput) : new Date();
  if (isNaN(d.getTime())) return '--.--.---- --:--';
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

/** Sunucunun `YYYY-AA-GG SS:DD:ss` saati UTC'dir; `formatDateTime` aynı kuralı uygular. */
export function formatServerDateTime(value: string): string {
  return formatDateTime(value);
}

export function minutesElapsed(startTime?: string): number {
  if (!startTime) return 0;
  // SQLite saati dilim bilgisi taşımaz ve UTC'dir; yerel sanılırsa süre saatlerce şişer.
  const plainServerTime = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(startTime);
  const start = new Date(plainServerTime ? `${startTime.replace(' ', 'T')}Z` : startTime).getTime();
  if (isNaN(start)) return 0;
  const diffMs = Math.max(0, Date.now() - start);
  return Math.floor(diffMs / 60000);
}

/** ISO tarihi gün.ay.yıl yazar; saat varsa atılır. */
export const formatDay = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');

/**
 * Kayıt anının yerel gününü gün.ay.yıl yazar. Saat taşıyan kayıt UTC anıdır: ilk on karakteri
 * almak gece 00:00-03:00 arası kayıtları bir önceki güne yazardı. Yalnız tarih taşıyan metin
 * zaten yerel gündür ve olduğu gibi yazılır.
 */
export const formatInstantDay = (iso: string): string => {
  if (iso.length <= 10) return formatDay(iso);
  const date = toDate(iso);
  if (isNaN(date.getTime())) return formatDay(iso);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()}`;
};
