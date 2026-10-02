/**
 * Rapor dışa aktarma çekirdeği.
 *
 * Neden bağımsız dosya: CSV kaçış kuralları, Türkçe Excel'in ayraç/ondalık
 * beklentisi ve para biriminin kuruştan çevrilmesi **bir kez** doğrulanmalı.
 * Üç ayrı ekranın kendi `downloadTextFile` kopyası olması, birinde Türkçe
 * karakterlerin bozulduğu sessiz hatayı üretirdi.
 *
 * Kurallar:
 * - Para **her zaman** kuruş (`cents`) taşınır; dışa aktarımda gösterime
 *   çevrilir. Float'a yazıp sonra toplam almak yasaktır.
 * - Excel için `;` ayraç ve `,` ondalık kullanılır: Türkçe Excel'in varsayılanı
 *   budur. UTF-8 BOM olmadan Türkçe karakterler Excel'de `Ä°` olur.
 * - PDF kütüphanesi yoktur ve eklenmeyecek: rapor bölgesi yazdırma stil
 *   kurallarıyla (`@media print`) basılır, kullanıcı "PDF olarak kaydet" der.
 */

/** CSV sütunu: başlık + değer üreten erişimçi. */
export interface ExportColumn<T> {
    header: string;
    value: (row: T) => string | number;
}

/** Türkçe para biçimi: binlik ayraç nokta, ondalık virgül. */
const CENTS_TR = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

/** Kuruşu dışa aktarım metnine çevirir (ör. `1234,56`). */
export function centsToExportString(cents: number): string {
    return CENTS_TR.format(Math.round(cents) / 100);
}

/** ISO tarihi `dd.MM.yyyy HH:mm` biçimine çevirir (Excel'de metin olarak kalır). */
export function toTurkishDateTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/** ISO tarihi `dd.MM.yyyy` biçimine çevirir. */
export function toTurkishDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}

/** Hücre değerini kaçışlar; ayraç/atlama satırı yazılamaz hale gelir. */
export function escapeCsvCell(value: string | number, separator: string): string {
    const raw = String(value ?? '');
    const needsQuote = raw.includes(separator) || raw.includes('"') || /[\r\n]/.test(raw);
    if (!needsQuote) return raw;
    return `"${raw.replace(/"/g, '""')}"`;
}

/**
 * Gövdeyi CSV'ye çevirir.
 *
 * @param excelComma true ise Türkçe Excel uyumu için `;` ayraç ve `,` ondalık
 * kullanılır; false ise standart `,` ayraçlı CSV üretilir.
 */
export function buildCsvBody<T>(
    columns: ExportColumn<T>[],
    rows: T[],
    excelComma = false,
): string {
    const separator = excelComma ? ';' : ',';
    const lines: string[] = [];

    lines.push(columns.map(c => escapeCsvCell(c.header, separator)).join(separator));
    for (const row of rows) {
        lines.push(
            columns
                .map(c => escapeCsvCell(c.value(row), separator))
                .join(separator),
        );
    }
    return lines.join('\r\n');
}

/**
 * UTF-8 BOM'lu CSV dosyası indirir.
 *
 * BOM zorunludur: Excel BOM olmadan dosyayı varsayılan kodlama ile açıp
 * Türkçe karakterleri bozar.
 */
export function downloadCsv(
    fileName: string,
    body: string,
    excelComma = false,
): void {
    const mime = excelComma
        ? 'application/vnd.ms-excel;charset=utf-8'
        : 'text/csv;charset=utf-8';
    const blob = new Blob([`\uFEFF${body}`], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/** `kasam360_rapor_2026-10-02` biçiminde dosya adı üretir. */
export function buildReportFileName(prefix: string, extension: string, now = new Date()): string {
    const iso = now.toISOString().slice(0, 10);
    return `kasam360_${prefix}_${iso}.${extension}`;
}
