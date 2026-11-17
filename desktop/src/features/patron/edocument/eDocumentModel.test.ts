import { describe, expect, it } from 'vitest';
import {
  canRetry,
  canSubmit,
  formatStamp,
  overviewWarnings,
  settingsProblem,
  type EDocumentEntry,
  type EDocumentOverview,
  type EDocumentSettings,
} from './eDocumentModel';

const settings = (patch: Partial<EDocumentSettings> = {}): EDocumentSettings => ({
  enabled: true,
  taxId: '0690000001',
  legalName: 'Örnek Lokanta',
  taxOffice: 'Küçükçekmece',
  seriesCode: 'ADS',
  street: '',
  district: '',
  city: 'İstanbul',
  ...patch,
});

const overview = (patch: Partial<EDocumentOverview> = {}): EDocumentOverview => ({
  enabled: true,
  providerConfigured: true,
  counts: { draft: 0, pending: 0, sent: 0, failed: 0 },
  ...patch,
});

describe('settingsProblem', () => {
  it('eksiksiz ayarda sorun döndürmez', () => {
    expect(settingsProblem(settings())).toBeNull();
  });

  it('kapalıyken eksik alanı kabul eder ama biçim hatasını reddeder', () => {
    expect(settingsProblem(settings({ enabled: false, legalName: '' }))).toBeNull();
    expect(settingsProblem(settings({ enabled: false, taxId: '123' }))).toMatch(/haneli/);
  });

  it('açıkken kimlik, unvan, vergi dairesi ve şehir ister', () => {
    expect(settingsProblem(settings({ taxId: '' }))).toMatch(/VKN/);
    expect(settingsProblem(settings({ legalName: ' ' }))).toMatch(/unvan/);
    expect(settingsProblem(settings({ taxOffice: '' }))).toMatch(/vergi dairesi/);
    expect(settingsProblem(settings({ city: '' }))).toMatch(/şehir/);
  });

  it('birim kodunu 3 karakter ister', () => {
    expect(settingsProblem(settings({ seriesCode: 'AB' }))).toMatch(/Birim kodu/);
  });
});

describe('overviewWarnings', () => {
  it('sağlıklı durumda uyarı çıkarmaz', () => {
    expect(overviewWarnings(overview())).toEqual([]);
  });

  it('hata, sağlayıcı yokluğu ve kapalıyken bekleyen belgeyi bildirir', () => {
    const counts = { draft: 0, pending: 2, sent: 0, failed: 3 };
    expect(overviewWarnings(overview({ counts }))).toHaveLength(1);
    expect(overviewWarnings(overview({ providerConfigured: false })).join(' ')).toMatch(/sağlayıcı/);
    expect(overviewWarnings(overview({ enabled: false, counts })).join(' ')).toMatch(/kapalı/);
  });
});

describe('durum kuralları ve zaman', () => {
  const entry = (status: EDocumentEntry['status']): EDocumentEntry => ({
    id: 'edq_1', orderId: 'ord_1', ettn: 'x', documentNumber: 'ADS2026000000001', status, attempts: 0,
    lastError: null, totalCents: 100, providerRef: null, remoteStatus: null, createdAt: '', updatedAt: '', sentAt: null,
  });

  it('yalnız taslak onaylanır, yalnız hata yeniden denenir', () => {
    expect(canSubmit(entry('DRAFT'))).toBe(true);
    expect(canSubmit(entry('PENDING'))).toBe(false);
    expect(canRetry(entry('FAILED'))).toBe(true);
    expect(canRetry(entry('SENT'))).toBe(false);
  });

  it('saat dilimsiz SQLite damgasını UTC sayar, çözülemeyeni olduğu gibi bırakır', () => {
    expect(formatStamp('2026-03-01 10:00:00')).toBe(new Date('2026-03-01T10:00:00Z').toLocaleString('tr-TR'));
    expect(formatStamp('belirsiz')).toBe('belirsiz');
  });
});
