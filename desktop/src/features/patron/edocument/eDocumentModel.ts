export type EDocumentStatus = 'DRAFT' | 'PENDING' | 'SENT' | 'FAILED';

export interface EDocumentEntry {
  id: string;
  orderId: string;
  ettn: string;
  documentNumber: string;
  status: EDocumentStatus;
  attempts: number;
  lastError: string | null;
  totalCents: number;
  providerRef: string | null;
  remoteStatus: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
}

export interface EDocumentSettings {
  enabled: boolean;
  taxId: string;
  legalName: string;
  taxOffice: string;
  seriesCode: string;
  street: string;
  district: string;
  city: string;
}

export interface EDocumentCounts {
  draft: number;
  pending: number;
  sent: number;
  failed: number;
}

export interface EDocumentOverview {
  enabled: boolean;
  providerConfigured: boolean;
  counts: EDocumentCounts;
}

export interface EDocumentCandidate {
  orderId: string;
  tableName: string;
  totalCents: number;
  closedAt: string;
}

export interface DispatchReport {
  sent: number;
  failed: number;
  deferred: number;
}

export const STATUS_LABEL: Record<EDocumentStatus, string> = {
  DRAFT: 'Taslak',
  PENDING: 'Gönderilecek',
  SENT: 'Gönderildi',
  FAILED: 'Hata',
};

export const STATUS_VARIANT: Record<EDocumentStatus, 'neutral' | 'amber' | 'emerald' | 'red'> = {
  DRAFT: 'neutral',
  PENDING: 'amber',
  SENT: 'emerald',
  FAILED: 'red',
};

export const REMOTE_LABEL: Record<string, string> = {
  ACCEPTED: 'GİB kabul etti',
  PENDING: 'GİB işliyor',
  REJECTED: 'GİB reddetti',
};

/** Kalıcı uyarılar: kapatılabilir bildirim değil, durum bozuk olduğu sürece görünür. */
export function overviewWarnings(overview: EDocumentOverview): string[] {
  const warnings: string[] = [];
  if (overview.counts.failed > 0) {
    warnings.push(`${overview.counts.failed} belge hata durumunda; yeniden deneyin veya hata metnini inceleyin.`);
  }
  if (overview.enabled && !overview.providerConfigured) {
    warnings.push('e-Belge sağlayıcısı bağlı değil; belgeler gönderilmez, kuyrukta bekler.');
  }
  if (!overview.enabled && overview.counts.pending > 0) {
    warnings.push(`e-Adisyon kapalı; ${overview.counts.pending} belge gönderilmeyi bekliyor.`);
  }
  return warnings;
}

/** Sağlama basamağını sunucu doğrular; burada yalnız biçim hatası anında gösterilir. */
export function settingsProblem(settings: EDocumentSettings): string | null {
  const taxId = settings.taxId.trim();
  if (taxId !== '' && !/^(\d{10}|\d{11})$/.test(taxId)) return 'VKN 10, TCKN 11 haneli rakam olmalı.';
  if (!/^[A-Za-z0-9]{3}$/.test(settings.seriesCode.trim())) return 'Birim kodu 3 harf veya rakam olmalı.';
  if (!settings.enabled) return null;
  if (taxId === '') return 'e-Adisyonu açmak için VKN/TCKN girin.';
  if (settings.legalName.trim() === '' || settings.taxOffice.trim() === '' || settings.city.trim() === '') {
    return 'e-Adisyonu açmak için unvan, vergi dairesi ve şehir girin.';
  }
  return null;
}

export const canSubmit = (entry: EDocumentEntry): boolean => entry.status === 'DRAFT';
export const canRetry = (entry: EDocumentEntry): boolean => entry.status === 'FAILED';

/** SQLite zaman damgası UTC ve saat dilimsizdir; ekranda yerel saatle gösterilir. */
export function formatStamp(value: string): string {
  const hasZone = /[zZ]|[+-]\d{2}:\d{2}$/.test(value);
  const parsed = new Date(hasZone ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('tr-TR');
}
