/** İstemciden tekrar gönderilecek hareketler için bir kez üretilen anahtar. */
export function createPrefixedId(prefix: string): string {
  if (!/^[a-z][a-z0-9]{1,7}$/.test(prefix)) throw new Error('Geçersiz kimlik ön eki.');
  const timestamp = Date.now().toString(16).padStart(12, '0').slice(-12);
  const entropy = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${timestamp}${entropy}`;
}
