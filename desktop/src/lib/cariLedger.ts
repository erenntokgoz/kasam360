import { localDate } from './cariInput';
import type { AwaitingDocument, LedgerDebt, StatementLine } from '../types/ledger';

/**
 * Cari bakiyenin yönü. İşaret backend ile aynıdır: artı, cari bize borçlu;
 * eksi, işletme cariye borçlu. Ekranda tutar mutlak yazılır, yön etiketle söylenir.
 */
export function balanceLabel(cents: number): 'Borçlu' | 'Alacaklı' | 'Bakiye yok' {
  if (cents > 0) return 'Borçlu';
  if (cents < 0) return 'Alacaklı';
  return 'Bakiye yok';
}

/** Ekstre bakiye sütunundaki kısa yön: B (borçlu), A (alacaklı). */
export function balanceSide(cents: number): 'B' | 'A' | '' {
  if (cents > 0) return 'B';
  if (cents < 0) return 'A';
  return '';
}

/** Kaydın türü: alış, adisyon veresiyesi, elle borç ya da alacak. */
export function debtLabel(debt: Pick<LedgerDebt, 'type' | 'orderId' | 'purchaseOrderId'>): string {
  if (debt.purchaseOrderId) return 'Mal alımı';
  if (debt.type === 'GIVEN') return debt.orderId ? 'Veresiye' : 'Borç kaydı';
  return 'Alacak kaydı';
}

/** Satır türünü kayda bakarak adlandırır; tek "Kayıt" etiketi alışı veresiyeden ayırmazdı. */
export function lineLabel(line: StatementLine): string {
  switch (line.kind) {
    case 'TAHSILAT':
      return 'Tahsilat';
    case 'TEDIYE':
      return 'Tediye';
    case 'IADE':
      return 'İade';
    case 'BORC_ACILDI':
      return debtLabel({
        type: line.signedAmountCents > 0 ? 'GIVEN' : 'TAKEN',
        orderId: line.orderId,
        purchaseOrderId: line.purchaseOrderId,
      });
  }
}

/** Alış satırının bağlantısı; belge no girilmemişse sipariş no ile aynıdır, iki kez yazılmaz. */
export function purchaseLink(line: Pick<StatementLine, 'orderNumber' | 'documentNo'>): string | null {
  const parts: string[] = [];
  if (line.orderNumber) parts.push(`Sipariş ${line.orderNumber}`);
  if (line.documentNo && line.documentNo !== line.orderNumber) parts.push(`Belge ${line.documentNo}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export type PeriodKey = 'THIS_MONTH' | 'LAST_MONTH' | 'ALL';

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  THIS_MONTH: 'Bu Ay',
  LAST_MONTH: 'Geçen Ay',
  ALL: 'Tüm Zamanlar',
};

/** Tüm zamanların başlangıcı: kayıtlar bu tarihten önce olamaz. */
const EPOCH = '2000-01-01';

export function statementPeriod(key: PeriodKey, now = new Date()): { from: string; to: string } {
  const year = now.getFullYear();
  const month = now.getMonth();
  switch (key) {
    case 'THIS_MONTH':
      return { from: localDate(new Date(year, month, 1)), to: localDate(now) };
    case 'LAST_MONTH':
      return { from: localDate(new Date(year, month - 1, 1)), to: localDate(new Date(year, month, 0)) };
    case 'ALL':
      return { from: EPOCH, to: localDate(now) };
  }
}

/** Seçili tarih aralığı hızlı dönemlerden birine denkse onu döndürür. */
export function matchingPeriod(from: string, to: string, now = new Date()): PeriodKey | null {
  const keys: PeriodKey[] = ['THIS_MONTH', 'LAST_MONTH', 'ALL'];
  return keys.find((key) => {
    const period = statementPeriod(key, now);
    return period.from === from && period.to === to;
  }) ?? null;
}

/**
 * Dönem başından önce açılıp hâlâ kapanmamış kayıtlar. Ekstrede satırları
 * olmadığı için ödemesi ancak bu listeden yapılabilir.
 */
export function carriedOpenDebts(debts: LedgerDebt[], lines: StatementLine[]): LedgerDebt[] {
  const listed = new Set(lines.filter((line) => line.kind === 'BORC_ACILDI').map((line) => line.debtId));
  return debts.filter((debt) => debt.status !== 'PAID' && !listed.has(debt.id));
}

/** Yalnız elle açılmış, hiç ödeme görmemiş kayıt düzeltilir; adisyon ve alış belgesine bağlıdır. */
export function isEditable(debt: LedgerDebt): boolean {
  return debt.status === 'PENDING' && !debt.orderId && !debt.purchaseOrderId;
}

function dueFromTerm(days: number, now: Date): string {
  return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}

/**
 * Yeni mal kabulünden önce teslim alınmış, borcu açılmamış sipariş için onay
 * girdisi. Belge no sipariş no, tutar kabul tutarıdır: fark olmadığı için
 * gerekçe gerekmez ve onay tek tıkla yapılabilir.
 */
export function legacyApproval(document: AwaitingDocument, operationId: string, now = new Date()) {
  return {
    operationId,
    purchaseOrderId: document.purchaseOrderId,
    documentNo: document.orderNumber,
    documentTotalCents: document.receivedTotalCents,
    dueDate: dueFromTerm(document.paymentTermDays, now),
  };
}
