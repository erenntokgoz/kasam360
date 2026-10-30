import { describe, expect, it } from 'vitest';
import { daysBetween, daysText, legalRows, missingDocTypes, statusOf, type LegalDocumentRow, type LicenseRow, type PolicyRow } from './legalRows';

const document = (overrides: Partial<LegalDocumentRow>): LegalDocumentRow => ({
  id: 'doc_1',
  doc_type: 'RUHSAT',
  title: 'Ruhsat',
  authority: null,
  document_number: null,
  issue_date: null,
  expiry_date: '2026-12-31',
  reminder_days: 30,
  file_path: null,
  notes: null,
  is_active: true,
  ...overrides,
});

const policy: PolicyRow = {
  id: 'pol_1',
  policy_type: 'ISYERI',
  insurance_company: 'Anka',
  policy_number: 'P-1',
  premium_cents: 100,
  coverage_cents: null,
  issue_date: '2026-01-01',
  expiry_date: '2026-10-01',
  reminder_days: 30,
  notes: null,
  is_active: true,
};

const license: LicenseRow = {
  id: 'lic_1',
  license_type: 'MESAM',
  year: 2026,
  amount_cents: 100,
  expiry_date: '2026-11-10',
  reminder_days: 30,
  notes: null,
  is_active: true,
};

describe('legalRows', () => {
  it('counts calendar days across a month end', () => {
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
    expect(daysBetween('2026-10-31', '2026-10-30')).toBe(-1);
  });

  it('keeps the expiry day itself inside the reminder and not expired', () => {
    expect(statusOf(-1, 30)).toBe('EXPIRED');
    expect(statusOf(0, 0)).toBe('SOON');
    expect(statusOf(30, 30)).toBe('SOON');
    expect(statusOf(31, 30)).toBe('VALID');
    expect(daysText(0)).toBe('Bugün bitiyor');
  });

  it('merges all records with the most urgent first and drops archived ones', () => {
    const rows = legalRows([document({}), document({ id: 'doc_2', is_active: false })], [policy], [license], '2026-10-31');
    expect(rows.map((row) => row.status)).toEqual(['EXPIRED', 'SOON', 'VALID']);
    expect(rows.map((row) => row.key)).toEqual(['POLICY:pol_1', 'LICENSE:lic_1', 'DOCUMENT:doc_1']);
  });

  it('lists required documents with no active record', () => {
    const missing = missingDocTypes([document({}), document({ id: 'doc_2', doc_type: 'SGK', is_active: false })]);
    expect(missing).toEqual(['YANGIN', 'HACCP', 'VERGI', 'SGK']);
  });
});
