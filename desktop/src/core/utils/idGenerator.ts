/**
 * Prefixed K-Sortable ID Generator (Stripe / ULID Standard)
 * Kasam360 Kurumsal Kimlik Anatomisi
 */

let counter = 0;

export function generatePrefixedId(prefix: string): string {
  const nowMs = Date.now();
  counter = (counter + 1) & 0xffff;
  const timeHex = nowMs.toString(16).padStart(12, '0');
  const seqHex = counter.toString(16).padStart(4, '0');
  const randHex = Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  return `${prefix}_${timeHex}${seqHex}${randHex}`;
}
