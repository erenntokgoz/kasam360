/**
 * Evrensel E-Belge Entegrasyon Sözleşmesi (e-Fatura / e-Arşiv)
 * Kasam360 Entegrasyon Katmanı
 *
 * Bağımlılıkları Tersine Çevirme Prensibini (DIP) uygular.
 * Çekirdek iş sistemleri, sağlayıcıya özgü protokolleri (örn. Logo, Sovos/Foriba, EDM, Uyumsoft, Digital Planet)
 * izole ederek kesinlikle bu arayüzle etkileşime girer.
 */

export type EDocumentType = 'E_INVOICE' | 'E_ARCHIVE';

export type EDocumentProfile =
  'TICARIFATURA' | 'TEMELFATURA' | 'EARSIVFATURA' | 'IHRACAT' | 'KAMU' | 'HAL';

export type EInvoiceScenario = 'COMMERCIAL' | 'BASIC' | 'EXPORT';

export interface CustomerTaxInfo {
  taxOrIdNumber: string; // 10 haneli VKN veya 11 haneli TCKN
  title: string;
  firstName?: string;
  lastName?: string;
  taxOffice?: string;
  email?: string;
  phone?: string;
  address?: string;
  district?: string;
  city?: string;
  country?: string;
  postalCode?: string;
  isEInvoiceRecipient?: boolean;
  mailboxAlias?: string; // GİB Posta Kutusu Etiketi (örn. urn:mail:defaultpk@...)
}

export interface EDocumentLineItem {
  lineId: string;
  name: string;
  quantity: number;
  unit: string; // C62 (Adet), KGM (Kg), LTR (Litre) vb.
  unitPrice: number; // KDV hariç net birim fiyat
  vatRate: number; // örn. 1, 10, 20
  vatAmount: number;
  discountAmount?: number;
  discountRate?: number;
  totalAmount: number; // KDV ve indirimler dahil satır toplamı
  categoryCode?: string;
}

export interface EDocumentPayload {
  uuid: string; // Küresel olarak benzersiz tanımlayıcı (UUID v4)
  invoiceNumber?: string; // İsteğe bağlı önceden tahsis edilmiş seri numarası (örn. GIB2026000000001)
  issueDate: string; // YYYY-MM-DD
  issueTime: string; // HH:mm:ss
  documentType: EDocumentType;
  profile: EDocumentProfile;
  currency: string; // TRY, USD, EUR
  exchangeRate?: number;
  customer: CustomerTaxInfo;
  items: EDocumentLineItem[];
  subTotal: number; // KDV hariç toplam
  totalVat: number; // Toplam KDV tutarı
  totalDiscount: number;
  grandTotal: number; // Ödenecek genel toplam tutar
  paymentMethod?: 'CASH' | 'CREDIT_CARD' | 'BANK_TRANSFER' | 'OTHER';
  notes?: string[];
  metadata?: Record<string, string | number | boolean>;
}

export interface EDocumentSendResult {
  success: boolean;
  uuid: string;
  documentNumber: string;
  gibStatusCode?: string;
  gibStatusDescription?: string;
  signedHash?: string;
  deliveredAt: string;
  isQueuedOffline?: boolean;
  error?: string;
}

export type EDocumentProcessingStatus =
  'PENDING' | 'QUEUED' | 'PROCESSING' | 'APPROVED' | 'REJECTED' | 'FAILED' | 'CANCELLED';

export interface EDocumentStatusResult {
  uuid: string;
  documentNumber?: string;
  status: EDocumentProcessingStatus;
  statusCode: string;
  statusDescription: string;
  checkedAt: string;
  gibEnvelopeId?: string;
  isFinal: boolean;
  rawResponse?: string;
}

export interface RecipientQueryResponse {
  isRegistered: boolean;
  aliases: string[];
  defaultAlias?: string;
}

/**
 * e-Fatura / e-Arşiv servis sağlayıcıları için Evrensel Sözleşme.
 */
export interface IEInvoiceIntegrator {
  readonly providerId: string;
  readonly providerName: string;

  /**
   * GİB onaylı özel entegratöre bir e-Arşiv faturası iletir.
   */
  sendEArchiveInvoice(document: EDocumentPayload): Promise<EDocumentSendResult>;

  /**
   * Özel entegratör aracılığıyla kayıtlı bir GİB alıcısına bir e-Fatura iletir.
   */
  sendEInvoice(document: EDocumentPayload): Promise<EDocumentSendResult>;

  /**
   * Daha önce gönderilmiş bir belgenin işleme yaşam döngüsü durumunu sorgular.
   */
  checkDocumentStatus(documentUuid: string): Promise<EDocumentStatusResult>;

  /**
   * Verilen bir VKN/TCKN'nin resmi GİB e-Fatura alıcı posta kutusu listesinde kayıtlı olup olmadığını doğrular.
   */
  queryRecipient?(taxOrIdNumber: string): Promise<RecipientQueryResponse>;

  /**
   * İzin verilen iptal penceresi dahilinde destekleniyorsa belge iptalini başlatır.
   */
  cancelDocument?(
    documentUuid: string,
    reason: string
  ): Promise<{ success: boolean; message: string }>;
}
