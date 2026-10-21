/**
 * Tarih ve saat biçimlendirme yardımcıları.
 * Arayüzde tabular-nums ile net ve hizalı gösterim sağlar.
 */

export function formatTime(dateInput?: string | Date | number): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) return '--:--';
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function formatDateTime(dateInput?: string | Date | number): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) return '--.--.---- --:--';
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

export function minutesElapsed(startTime?: string): number {
  if (!startTime) return 0;
  const start = new Date(startTime).getTime();
  if (isNaN(start)) return 0;
  const diffMs = Math.max(0, Date.now() - start);
  return Math.floor(diffMs / 60000);
}

/**
 * Rezervasyona 60 dakika veya daha az kalıp kalmadığını kontrol eder.
 * Anayasa Kuralı: Rezerve saatine 60dk kala masa otomatik rezerve rozeti alır ve kilitlenir.
 */
export function isWithin60Minutes(reservationTimeStr?: string): boolean {
  if (!reservationTimeStr) return false;
  const target = new Date(reservationTimeStr).getTime();
  if (isNaN(target)) return false;
  const diffMs = target - Date.now();
  const minutesLeft = diffMs / 60000;
  return minutesLeft > 0 && minutesLeft <= 60;
}
