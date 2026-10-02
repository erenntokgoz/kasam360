/**
 * Modifier yüzeylerinin paylaştığı sözleşmeler.
 *
 * Faz 4: bağımsız `OwnerModifiersTab` sekmesi yerine aynı veri iki gömülü
 * yüzeyden (`CategoryForm` ve `ProductForm`) yönetilir. Tipler ayrı dosyada
 * tutulur ki iki yüzey aynı sözleşmeyi paylaşsın ve kopya oluşmasın.
 */

export interface ModifierOption {
    id: string;
    name: string;
    /** Seçeneğin fiyat **farkı** (kuruş). Ürünün temel fiyatına eklenmez. */
    priceCents: number;
}

export interface ModifierGroup {
    id: string;
    name: string;
    isRequired: boolean;
    minSelections: number;
    maxSelections: number | null;
    /** Bu grubun şablon olduğu kategori. `null` ise serbest gruptir. */
    categoryId: string | null;
    options: ModifierOption[];
}

export type ModifierSectionMode = 'template' | 'assign';

export interface ModifierSectionProps {
    mode: ModifierSectionMode;
    /** `template` kipinde şablonun bağlanacağı kategori. */
    categoryId?: string | null;
    /** `assign` kipinde ürüne bağlı gruplar. */
    selectedGroupIds?: string[];
    onSelectionChange?: (groupIds: string[]) => void;
    /**
     * `assign` kipinde ürünün kategorisi. Kategori şablonlarının ürüne
     * önerilmesi için kullanılır (Faz 4 / B4).
     */
    productCategoryId?: string | null;
    /** Yönetici değilse bölüm salt-okunur açılır (ör. müdür ürün düzenleme). */
    readOnly?: boolean;
}

/**
 * Kuruşu kullanıcı diline çevirir.
 *
 * Neden `Intl`: para birimi biçimi elle yazılırsa ondalık ayracı ve simge
 * Türkçe'ye uymaz; biçimlendirme tarayıcının dil verisinden gelir. Değer
 * yine de kuruş (`cents`) olarak taşınır, float'a dönüşmez.
 */
const CENTS_FORMATTER = new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

export function formatCents(cents: number): string {
    return CENTS_FORMATTER.format(cents / 100);
}