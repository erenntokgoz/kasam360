/** Türkçe karakter ve harf büyüklüğünden bağımsız karşılaştırma biçimi. */
export function foldText(text: string): string {
  return text
    .replace(/[İIı]/g, 'i')
    .replace(/[Şş]/g, 's')
    .replace(/[Ğğ]/g, 'g')
    .replace(/[Üü]/g, 'u')
    .replace(/[Öö]/g, 'o')
    .replace(/[Çç]/g, 'c')
    .toLowerCase()
    .trim();
}

/** Ürün adında geçen metni ya da birebir barkodu bulur. */
export function matchesProduct(query: string, name: string, barcode?: string): boolean {
  const wanted = foldText(query);
  if (!wanted) return true;
  return foldText(name).includes(wanted) || barcode === query.trim();
}
