export type LegalKind = 'DOCUMENT' | 'POLICY' | 'LICENSE';
export type LegalStatus = 'EXPIRED' | 'SOON' | 'VALID';

export interface LegalDocumentRow {
  id: string;
  doc_type: string;
  title: string;
  authority: string | null;
  document_number: string | null;
  issue_date: string | null;
  expiry_date: string;
  reminder_days: number;
  file_path: string | null;
  notes: string | null;
  is_active: boolean;
}

export interface PolicyRow {
  id: string;
  policy_type: string;
  insurance_company: string;
  policy_number: string;
  premium_cents: number;
  coverage_cents: number | null;
  issue_date: string;
  expiry_date: string;
  reminder_days: number;
  notes: string | null;
  is_active: boolean;
}

export interface LicenseRow {
  id: string;
  license_type: string;
  year: number;
  amount_cents: number;
  expiry_date: string;
  reminder_days: number;
  notes: string | null;
  is_active: boolean;
}

export type LegalSource =
  | { kind: 'DOCUMENT'; record: LegalDocumentRow }
  | { kind: 'POLICY'; record: PolicyRow }
  | { kind: 'LICENSE'; record: LicenseRow };

export interface LegalRow {
  key: string;
  type: string;
  title: string;
  detail: string;
  expiryDate: string;
  daysLeft: number;
  status: LegalStatus;
  source: LegalSource;
}

export const DOC_TYPES: Record<string, string> = {
  RUHSAT: 'İşletme Ruhsatı',
  YANGIN: 'Yangın Raporu',
  HACCP: 'HACCP',
  VERGI: 'Vergi Levhası',
  SGK: 'SGK',
  DIGER: 'Diğer Belge',
};

export const POLICY_TYPES: Record<string, string> = {
  ISYERI: 'İşyeri Sigortası',
  SORUMLULUK: 'Sorumluluk Sigortası',
  SGK: 'SGK Poliçesi',
  KASKO: 'Kasko',
  DIGER: 'Diğer Poliçe',
};

export const LICENSE_TYPES: Record<string, string> = {
  MESAM: 'MESAM',
  MSG: 'MSG',
  BILGI: 'Bilgi Lisansı',
  DIGER: 'Diğer Lisans',
};

const DAY_MS = 86_400_000;

/** Tarihler gün hassasiyetindedir; saat dilimi kayması için UTC gün farkı alınır. */
export function daysBetween(today: string, expiry: string): number {
  return Math.round((Date.parse(expiry) - Date.parse(today)) / DAY_MS);
}

export function statusOf(daysLeft: number, reminderDays: number): LegalStatus {
  if (daysLeft < 0) return 'EXPIRED';
  return daysLeft <= reminderDays ? 'SOON' : 'VALID';
}

export function daysText(daysLeft: number): string {
  if (daysLeft < 0) return `${-daysLeft} gün geçti`;
  return daysLeft === 0 ? 'Bugün bitiyor' : `${daysLeft} gün kaldı`;
}

const row = (source: LegalSource, type: string, title: string, detail: string, today: string): LegalRow => {
  const { id, expiry_date: expiryDate, reminder_days: reminderDays } = source.record;
  const daysLeft = daysBetween(today, expiryDate);
  return { key: `${source.kind}:${id}`, type, title, detail, expiryDate, daysLeft, status: statusOf(daysLeft, reminderDays), source };
};

/** Üç ayrı kayıt türü tek takvimde birleşir: en acil olan her zaman en üsttedir. */
export function legalRows(
  documents: LegalDocumentRow[],
  policies: PolicyRow[],
  licenses: LicenseRow[],
  today: string,
): LegalRow[] {
  const rows = [
    ...documents.filter((record) => record.is_active).map((record) =>
      row({ kind: 'DOCUMENT', record }, DOC_TYPES[record.doc_type] ?? record.doc_type, record.title, record.authority ?? record.document_number ?? '', today)),
    ...policies.filter((record) => record.is_active).map((record) =>
      row({ kind: 'POLICY', record }, POLICY_TYPES[record.policy_type] ?? record.policy_type, record.insurance_company, record.policy_number, today)),
    ...licenses.filter((record) => record.is_active).map((record) =>
      row({ kind: 'LICENSE', record }, 'Müzik Lisansı', LICENSE_TYPES[record.license_type] ?? record.license_type, String(record.year), today)),
  ];
  return rows.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Her işletmede beklenen belgeler; "Diğer" zorunlu değildir. */
export function missingDocTypes(documents: LegalDocumentRow[]): string[] {
  const held = new Set(documents.filter((record) => record.is_active).map((record) => record.doc_type));
  return Object.keys(DOC_TYPES).filter((type) => type !== 'DIGER' && !held.has(type));
}
