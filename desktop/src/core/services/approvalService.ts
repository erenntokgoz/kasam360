/**
 * Anlık PIN onay servisi (Faz 3).
 *
 * Sözleşme: işlem yapan taraf önce `verify_manager_pin` çağırır, tek kullanımlık
 * `approvalToken` alır, sonra işlemi bu jetonla gönderir. PIN bu modülün dışına
 * çıkmaz; yalnız `requestApproval` çağrısının gövdesinde bulunur ve sonuçta
 * jetonla değiştirilir.
 */

import { tauriInvoke as invoke } from '../../data/ipc/tauriInvoke';

/** Onaylanabilen işlem yüzeyleri. Backend'deki kapalı listeyle birebir aynıdır. */
export const APPROVAL_OPERATIONS = {
  VOID: 'VOID_ORDER',
  DISCOUNT: 'DISCOUNT',
  COMPLIMENTARY: 'COMPLIMENTARY',
} as const;

export type ApprovalOperation =
  (typeof APPROVAL_OPERATIONS)[keyof typeof APPROVAL_OPERATIONS];

/** Anlık PIN onayı isteği. */
export interface ApprovalRequest {
  operation: ApprovalOperation;
  /** İşlemin bağlandığı kaynak: adisyon kimliği veya fiş kimliği. */
  resourceId: string;
  /** İşlemi yapan kişi. Self-approval denetimi bu kimliğe karşı yapılır. */
  actorId: string;
  actorRole: string;
  /** Kuruş cinsinden tutar: void için sipariş tutarı, indirim için indirim tutarı. */
  amountCents: number;
  /** Yalnız DISCOUNT için anlamlı; küçük/büyük eşiğinin oran kolu. */
  discountPercent?: number;
  tenantId?: string;
  terminalId?: string;
}

/** Başarılı onay yanıtı. PIN veya hash içermez. */
export interface ApprovalToken {
  approvalToken: string;
  approverId: string;
  approverName: string;
  approverRole: string;
  resourceId: string;
  operation: string;
  remainingAttempts: number;
}

/**
 * Backend hata kodları. Metin yerine kod eşlenir: sunucu mesajı arayüz
 * görünümüne doğrudan bırakılmaz, kullanıcıya sabit Türkçe metin gösterilir.
 */
export const APPROVAL_ERROR = {
  INVALID_PIN: 'INVALID_APPROVAL_PIN',
  NOT_APPROVER: 'NOT_APPROVER',
  SELF_APPROVAL: 'SELF_APPROVAL_FORBIDDEN',
  LOCKED: 'APPROVAL_LOCKED',
  TOKEN_REQUIRED: 'APPROVAL_REQUIRED',
  TOKEN_INVALID: 'APPROVAL_TOKEN_INVALID',
  TOKEN_USED: 'APPROVAL_TOKEN_USED',
  TOKEN_SCOPE: 'APPROVAL_TOKEN_SCOPE_MISMATCH',
  TOKEN_EXPIRED: 'APPROVAL_TOKEN_EXPIRED',
} as const;

export type ApprovalErrorCode =
  (typeof APPROVAL_ERROR)[keyof typeof APPROVAL_ERROR];

/** Hatalı onay denemesi. Kullanıcıya gösterilecek metin ve kalan hak buradadır. */
export class ApprovalError extends Error {
  readonly code: string;
  readonly remainingAttempts: number | null;

  constructor(message: string, code: string, remainingAttempts: number | null = null) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
    this.remainingAttempts = remainingAttempts;
  }
}

/** Sunucu hata metninden kodu ayıklar. Kod yoksa `null` döner. */
export function parseApprovalErrorCode(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw : String(raw ?? '');
  for (const code of Object.values(APPROVAL_ERROR)) {
    if (text.includes(code)) return code;
  }
  // Sunucu "UNAUTHORIZED: Bu rol onay veremez" biçiminde döner; kod
  // `NOT_APPROVER` değil de yetkisizlik önekiyle gelirse burada yakalanır.
  if (text.includes('UNAUTHORIZED')) return 'UNAUTHORIZED';
  return null;
}

/** Hata metnini koda göre kullanıcı metnine çevirir. */
export function toUserFacingMessage(code: string | null, fallback?: string): string {
  switch (code) {
    case APPROVAL_ERROR.INVALID_PIN:
      return 'Onay PIN\'i hatalı.';
    case APPROVAL_ERROR.NOT_APPROVER:
    case 'UNAUTHORIZED':
      return 'Bu rol onay veremez.';
    case APPROVAL_ERROR.SELF_APPROVAL:
      return 'Kendi işlemini onaylayamazsın.';
    case APPROVAL_ERROR.LOCKED:
      return 'Çok sayıda hatalı deneme. Terminal kilitli.';
    case APPROVAL_ERROR.TOKEN_REQUIRED:
      return 'Bu işlem için onay gerekli.';
    case APPROVAL_ERROR.TOKEN_INVALID:
    case APPROVAL_ERROR.TOKEN_USED:
    case APPROVAL_ERROR.TOKEN_SCOPE:
    case APPROVAL_ERROR.TOKEN_EXPIRED:
      return 'Onay süresi doldu. Lütfen tekrar onay iste.';
    default:
      return fallback ?? 'Onay doğrulanamadı.';
  }
}

/** Kalan deneme hakkı metni. Hak 5'in altına düştüğünde uyarı niteliği taşır. */
export function describeRemainingAttempts(remaining: number | null): string | null {
  if (remaining === null || remaining >= 5) return null;
  if (remaining <= 0) return 'Deneme hakkın kalmadı.';
  return `${remaining} deneme hakkın kaldı.`;
}

/**
 * Anlık PIN onayı ister ve jetonu döner.
 *
 * PIN yalnız burada bulunur: çağıran işlem PIN'i göremez, yalnız jetonu
 * kullanır. Hata durumunda `ApprovalError` fırlatılır; çağıran yalnız `code`
 * ve `remainingAttempts` alanlarını okur.
 */
export async function requestApproval(
  request: ApprovalRequest,
  pin: string,
): Promise<ApprovalToken> {
  try {
    const result = await invoke<ApprovalToken>('verify_manager_pin', {
      payload: {
        operation: request.operation,
        resourceId: request.resourceId,
        actorId: request.actorId,
        actorRole: request.actorRole,
        amountCents: request.amountCents,
        discountPercent: request.discountPercent ?? 0,
        terminalId: request.terminalId,
        pin,
        tenantId: request.tenantId,
      },
    });

    return result;
  } catch (raw) {
    const code = parseApprovalErrorCode(raw);
    const remaining = readRemainingAttempts(raw);
    throw new ApprovalError(toUserFacingMessage(code), code ?? 'UNKNOWN', remaining);
  }
}

/** Sunucu hatasındaki kalan hak sayısını okur; yoksa `null`. */
function readRemainingAttempts(raw: unknown): number | null {
  const text = typeof raw === 'string' ? raw : String(raw ?? '');
  const match = text.match(/(\d+)\s*deneme hakkı kaldı/);
  if (match && match[1]) return Number(match[1]);
  return null;
}
