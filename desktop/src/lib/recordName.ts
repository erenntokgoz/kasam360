/** Türkçe harfleri düzeltirken marka, kısaltma ve kullanıcının mevcut yazımı korunur. */
export function capitalizeRecordName(value: string): string {
  return value.replace(/(^|\s)(\p{Ll})/gu, (_, space: string, letter: string) =>
    space + letter.toLocaleUpperCase('tr-TR'),
  );
}
