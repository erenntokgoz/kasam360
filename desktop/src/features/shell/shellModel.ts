import type { AppModule } from '../../stores/uiStore';
import type { UserRole } from '../../types/auth';

/** Menü mantıksal gruplara bölünür; grup başlığı kısa taramada işi bulmayı kolaylaştırır. */
export type NavGroupId = 'OPERATION' | 'MONEY' | 'BUSINESS';

export const NAV_GROUP_TITLE: Record<NavGroupId, string> = {
  OPERATION: 'OPERASYON',
  MONEY: 'PARA',
  BUSINESS: 'İŞLETME',
};

export const MODULE_LABEL: Record<AppModule, string> = {
  FLOOR: 'Salon',
  POS: 'Sipariş',
  KDS: 'Mutfak',
  CASHIER: 'Kasa',
  ERP: 'Yönetim',
  CATALOG: 'Menü',
  SETTINGS: 'Ayarlar',
};

export const MODULE_GROUP: Record<AppModule, NavGroupId> = {
  FLOOR: 'OPERATION',
  POS: 'OPERATION',
  KDS: 'OPERATION',
  CASHIER: 'MONEY',
  ERP: 'MONEY',
  CATALOG: 'BUSINESS',
  SETTINGS: 'BUSINESS',
};

const GROUP_ORDER: NavGroupId[] = ['OPERATION', 'MONEY', 'BUSINESS'];

export interface NavEntry {
  id: AppModule;
  label: string;
  badge?: number;
  visible: boolean;
}

export interface NavSection {
  id: NavGroupId;
  title: string;
  items: NavEntry[];
}

/**
 * Görünür öğeleri gruplar ve arama metnine göre süzer. Görünürlük rol ve özellik bayrağından
 * gelir; arama bu kuralları genişletemez, yalnız görünür olanı daraltır.
 */
export function buildNavSections(entries: NavEntry[], query: string): NavSection[] {
  const needle = query.trim().toLocaleLowerCase('tr-TR');
  return GROUP_ORDER.map((id) => ({
    id,
    title: NAV_GROUP_TITLE[id],
    items: entries.filter(
      (entry) =>
        entry.visible &&
        MODULE_GROUP[entry.id] === id &&
        (needle === '' || entry.label.toLocaleLowerCase('tr-TR').includes(needle)),
    ),
  })).filter((section) => section.items.length > 0);
}

export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Günaydın';
  if (hour >= 12 && hour < 18) return 'İyi günler';
  return 'İyi akşamlar';
}

const DATE_FORMAT = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

export function longDate(date: Date): string {
  return DATE_FORMAT.format(date);
}

export const ROLE_TITLE: Record<UserRole, string> = {
  MASTER: 'Platform',
  OWNER: 'Patron',
  MANAGER: 'Müdür',
  CASHIER: 'Kasiyer',
  WAITER: 'Garson',
  KITCHEN: 'Mutfak',
};

export function firstName(fullName: string | undefined): string {
  return fullName?.trim().split(/\s+/)[0] ?? '';
}

export function initials(fullName: string | undefined): string {
  const parts = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return '?';
  const letters = parts.length === 1 ? [parts[0][0]] : [parts[0][0], parts[parts.length - 1][0]];
  return letters.join('').toLocaleUpperCase('tr-TR');
}
