/**
 * Kullanıcının yazdığı TL tutarını float'a uğramadan kuruşa çevirir.
 * Geçersiz girişte null döner; çağıran sessizce sıfır varsaymaz.
 */
export function parseCents(text: string): number | null {
  const clean = text.replace(/\s|₺|TL/gi, '').replace(/\.(?=\d{3}(\D|$))/g, '');
  const match = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(clean);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Tekrar denemede aynı kalan işlem anahtarı üretir. */
export function newOperationId(): string {
  return `op_${crypto.randomUUID()}`;
}

/** Backend hata kodunu ayırır; kullanıcıya gerekçe metni kalır. */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // Kod ve rol listesi kullanıcıya gösterilmez: "UNAUTHORIZED", "(izin: OWNER, ...)" destek içindir.
  return text
    .replace(/\b[A-Z][A-Z_]{3,}:\s*/g, '')
    .replace(/\s*\(izin:[^)]*\)/g, '')
    .trim();
}

export function errorCode(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error);
  return /^([A-Z_]+):/.exec(text)?.[1] ?? null;
}

/** Yerel takvime göre YYYY-AA-GG. */
export function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
