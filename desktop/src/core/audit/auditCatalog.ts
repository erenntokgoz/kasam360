/**
 * Denetim (audit) kataloğu: sekiz ana kategori, beş operasyon filtresi ve
 * dışa aktarım biçimleri.
 *
 * Bu modül bilerek React'ten bağımsızdır: aynı kurallar patron ekranı, testler
 * ve ileride rapor ekranları tarafından paylaşılır. Saf fonksiyonlar iki yerde
 * yazılırsa kural birbirinden ayrılır.
 *
 * Kural: arayüz **hiçbir zaman** ham SHA-256 değeri göremez. Kayıt yalnızca
 * `sealed: true` mührüyle gelir; bütünlük doğrulaması backend'in tek doğrulayıcısı
 * (`verify_audit_ledger_integrity`) tarafından yapılır.
 */

/** Backend `audit_ledger.category` sütunundaki sekiz kapalı kategori. */
export const AUDIT_CATEGORIES = [
  'SIPARIS_MASA',
  'ODEME',
  'FINANS',
  'PERSONEL',
  'MENU',
  'YETKI',
  'SISTEM',
  'GUVENLIK',
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  SIPARIS_MASA: 'Sipariş & Masa',
  ODEME: 'Ödeme',
  FINANS: 'Finans',
  PERSONEL: 'Personel',
  MENU: 'Menü & Stok',
  YETKI: 'Yetki',
  SISTEM: 'Sistem',
  GUVENLIK: 'Güvenlik',
};

export function isAuditCategory(value: string): value is AuditCategory {
  return (AUDIT_CATEGORIES as readonly string[]).includes(value);
}

export function auditCategoryLabel(value: string): string {
  return isAuditCategory(value) ? AUDIT_CATEGORY_LABELS[value] : 'Diğer';
}

/** Patron ekranındaki beş operasyon filtresi. `ALL` bir kategori değil, sıfırlama. */
export const OPERATION_FILTERS = [
  { id: 'IPTAL_IADE', label: 'İptal & İade' },
  { id: 'INDIRIM_IKRAM', label: 'İndirim & İkram' },
  { id: 'KASA_GIRIS_CIKIS', label: 'Kasa Giriş & Çıkış' },
  { id: 'MASA_TASIMA', label: 'Masa Taşıma' },
  { id: 'STOK_FIRE', label: 'Stok & Fire' },
] as const;

export type OperationFilterId = (typeof OPERATION_FILTERS)[number]['id'];
export type OperationSelection = OperationFilterId | 'ALL';

export const ALL_OPERATIONS: OperationSelection = 'ALL';

/** İstemciye giden denetim kaydı. Hash alanı bilerek yoktur. */
export interface AuditLogDto {
  id: string;
  sequence: number;
  timestamp: string;
  actor_id: string;
  actor_role: string;
  category: string;
  action: string;
  resource_id: string;
  payload: Record<string, unknown> | null;
  sealed: boolean;
}

/**
 * İşlem kodlarının Türkçe karşılığı. Backend'in `alan:eylem` düzenini tek yerden
 * okuyoruz; ekranda ham kod gösterilmez.
 */
const ACTION_LABELS: Record<string, string> = {
  'order:submitted': 'Sipariş Oluşturuldu',
  'order:voided': 'Sipariş İptal Edildi',
  'payment:settled_fifo': 'Ödeme Kapandı',
  'cash:movement_in': 'Kasa Girişi',
  'cash:movement_out': 'Kasa Çıkışı',
  'shift:opened': 'Vardiya Açıldı',
  'shift:closed': 'Vardiya Kapatıldı',
  'day:closed': 'Gün Sonu Kapatıldı',
  'table:add': 'Masa Eklendi',
  'table:remove': 'Masa Kaldırıldı',
  'table:rename': 'Masa Adı Değişti',
  'table:reserved': 'Masa Rezerve Edildi',
  'table:reservation_cancelled': 'Rezervasyon Kaldırıldı',
  'table:reservation_no_show': 'Müşteri Gelmedi',
  'table:reservation_arrived': 'Müşteri Geldi',
  'table:move': 'Masa Taşındı',
  'table:merged': 'Masalar Birleştirildi',
  'stock:movement_in': 'Stok Girişi',
  'stock:movement_out': 'Stok Çıkışı',
  'stock:created': 'Stok Kalemi Açıldı',
  'kds:ticket_status_advanced': 'Mutfak Fişi İlerletildi',
  'menu:category_created': 'Menü Kategorisi Eklendi',
  'menu:category_updated': 'Menü Kategorisi Güncellendi',
  'menu:category_deleted': 'Menü Kategorisi Silindi',
  'menu:product_created': 'Ürün Eklendi',
  'menu:product_updated': 'Ürün Güncellendi',
  'menu:product_deleted': 'Ürün Silindi',
  'menu:product_status_changed': 'Ürün Durumu Değişti',
  'menu:modifier_group_created': 'Modifier Grubu Eklendi',
  'menu:modifier_group_deleted': 'Modifier Grubu Silindi',
  'menu:modifier_option_added': 'Modifier Seçeneği Eklendi',
  'staff:created': 'Personel Eklendi',
  'staff:deactivated': 'Personel Pasife Alındı',
  'security:pin_changed': 'PIN Değiştirildi',
  'security:pin_changed_by_master': 'PIN Değiştirildi (Master)',
  'security:password_reset_by_master': 'Parola Sıfırlandı (Master)',
  'system:tenant_created': 'İşletme Oluşturuldu',
  'system:tenant_updated': 'İşletme Güncellendi',
  'system:tenant_suspended': 'İşletme Askıya Alındı',
  'system:tenant_activated': 'İşletme Aktifleştirildi',
  'system:device_registered': 'Cihaz Kaydedildi',
  'system:device_status_changed': 'Cihaz Durumu Değişti',
  'system:device_deleted': 'Cihaz Silindi',
  'system:remote_session_attached': 'Uzaktan Oturum Bağlandı',
  'system:it_operational_command': 'IT Komutu Çalıştırıldı',
  'platform:tenant_modules_updated': 'Modül Yetkileri Güncellendi',
  'platform:license_key_regenerated': 'Lisans Anahtarı Üretildi',
};

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** İşlem kodlarını beş operasyon filtresinden birine bağlayan tablo. */
const OPERATION_BY_ACTION: Record<string, OperationFilterId> = {
  'order:voided': 'IPTAL_IADE',
  // İkram akışı ayrı bir onay koduyla açıldığında buraya eklenir.
  'order:complimentary': 'INDIRIM_IKRAM',
  'payment:discount_applied': 'INDIRIM_IKRAM',
  'cash:movement_in': 'KASA_GIRIS_CIKIS',
  'cash:movement_out': 'KASA_GIRIS_CIKIS',
  'table:move': 'MASA_TASIMA',
  'table:merged': 'MASA_TASIMA',
  'stock:movement_in': 'STOK_FIRE',
  'stock:movement_out': 'STOK_FIRE',
  'stock:created': 'STOK_FIRE',
};

/** İşlem koduna göre operasyon filtresi; eşleşme yoksa `null`. */
export function operationOfAction(action: string): OperationFilterId | null {
  return OPERATION_BY_ACTION[action] ?? null;
}

/**
 * Ödeme kaydı, sepet/sepet geneli indirim taşıyorsa "İndirim & İkram"
 * filtresine girer: indirim kodu `payment:settled_fifo` içinde taşınır.
 */
function hasDiscount(log: AuditLogDto): boolean {
  if (log.action !== 'payment:settled_fifo') return false;
  const payload = log.payload;
  if (!payload) return false;
  const discount = payload.discountCents;
  return typeof discount === 'number' && discount > 0;
}

export function matchesOperation(log: AuditLogDto, selection: OperationSelection): boolean {
  if (selection === ALL_OPERATIONS) return true;
  if (hasDiscount(log)) return selection === 'INDIRIM_IKRAM';
  return operationOfAction(log.action) === selection;
}

export function filterAuditLogs(
  logs: readonly AuditLogDto[],
  selection: OperationSelection,
  searchTerm: string
): AuditLogDto[] {
  const term = searchTerm.trim().toLowerCase();
  return logs.filter((log) => {
    if (!matchesOperation(log, selection)) return false;
    if (term === '') return true;
    return (
      log.actor_id.toLowerCase().includes(term) ||
      log.action.toLowerCase().includes(term) ||
      log.resource_id.toLowerCase().includes(term) ||
      auditActionLabel(log.action).toLowerCase().includes(term) ||
      auditCategoryLabel(log.category).toLowerCase().includes(term)
    );
  });
}

/** CSV kaçışı (RFC 4180): tırnak çiftlenir, formül enjeksiyonu nötralize edilir. */
function csvCell(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

const EXPORT_COLUMNS = [
  'sira',
  'zaman',
  'kategori',
  'islem',
  'personel',
  'rol',
  'kaynak',
  'muhur',
] as const;

/** Görünen kayıtları CSV'ye çevirir. Hash sütunu yoktur. */
export function buildAuditCsv(logs: readonly AuditLogDto[]): string {
  const lines = [EXPORT_COLUMNS.join(';')];
  for (const log of logs) {
    lines.push(
      [
        String(log.sequence),
        csvCell(log.timestamp),
        csvCell(auditCategoryLabel(log.category)),
        csvCell(auditActionLabel(log.action)),
        csvCell(log.actor_id),
        csvCell(log.actor_role),
        csvCell(log.resource_id),
        log.sealed ? 'Mühürlü' : 'Mühürsüz',
      ].join(';'),
    );
  }
  return lines.join('\r\n');
}

/** Görünen kayıtları JSON'a çevirir. Hash sütunu yoktur. */
export function buildAuditJson(logs: readonly AuditLogDto[]): string {
  return JSON.stringify(
    logs.map((log) => ({
      sequence: log.sequence,
      timestamp: log.timestamp,
      category: log.category,
      categoryLabel: auditCategoryLabel(log.category),
      action: log.action,
      actionLabel: auditActionLabel(log.action),
      actorId: log.actor_id,
      actorRole: log.actor_role,
      resourceId: log.resource_id,
      payload: log.payload,
      sealed: log.sealed,
    })),
    null,
    2,
  );
}
