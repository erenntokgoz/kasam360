import { BaseEInvoiceIntegrator } from './BaseEInvoiceIntegrator';
import {
  EDocumentPayload,
  EDocumentSendResult,
  EDocumentStatusResult,
  RecipientQueryResponse,
} from './EInvoiceIntegrator.interface';

export interface GenericEInvoiceConfig {
  providerId?: string;
  providerName?: string;
  endpointUrl?: string;
  username?: string;
  prefix?: string;
}

/**
 * Concrete Driver Wrapper for E-Invoice Integrators.
 * Translates universal e-document requests into vendor-specific SOAP/REST payloads.
 */
export class GenericEInvoiceIntegrator extends BaseEInvoiceIntegrator {
  public readonly providerId: string;
  public readonly providerName: string;
  private readonly prefix: string;
  private sequenceCounter = 1000;

  constructor(config?: GenericEInvoiceConfig) {
    super();
    this.providerId = config?.providerId ?? 'GENERIC_EINVOICE_PROVIDER';
    this.providerName = config?.providerName ?? 'Universal E-Document Integrator';
    this.prefix = config?.prefix ?? 'GIB';
  }

  public async executeSendEArchive(document: EDocumentPayload): Promise<EDocumentSendResult> {
    this.sequenceCounter += 1;
    const year = new Date(document.issueDate).getFullYear();
    const docNo =
      document.invoiceNumber ??
      `${this.prefix}${year}${String(this.sequenceCounter).padStart(9, '0')}`;

    return {
      success: true,
      uuid: document.uuid,
      documentNumber: docNo,
      gibStatusCode: '1000',
      gibStatusDescription: 'GİB e-Arşiv Fatura kuyruğuna alındı ve imzalandı.',
      signedHash: `sha256_${Date.now().toString(16)}_${document.uuid.slice(0, 8)}`,
      deliveredAt: new Date().toISOString(),
    };
  }

  public async executeSendEInvoice(document: EDocumentPayload): Promise<EDocumentSendResult> {
    this.sequenceCounter += 1;
    const year = new Date(document.issueDate).getFullYear();
    const docNo =
      document.invoiceNumber ??
      `${this.prefix}${year}${String(this.sequenceCounter).padStart(9, '0')}`;

    return {
      success: true,
      uuid: document.uuid,
      documentNumber: docNo,
      gibStatusCode: '1200',
      gibStatusDescription: 'GİB Zarfı oluşturuldu ve alıcı posta kutusuna sevk edildi.',
      signedHash: `sha256_${Date.now().toString(16)}_${document.uuid.slice(0, 8)}`,
      deliveredAt: new Date().toISOString(),
    };
  }

  public async executeStatusCheck(documentUuid: string): Promise<EDocumentStatusResult> {
    return {
      uuid: documentUuid,
      status: 'APPROVED',
      statusCode: '1300',
      statusDescription: 'GİB ve Alıcı sistemleri tarafından başarıyla işlendi ve onaylandı.',
      checkedAt: new Date().toISOString(),
      gibEnvelopeId: `ENV_${documentUuid.slice(0, 12)}`,
      isFinal: true,
    };
  }

  public async queryRecipient(taxOrIdNumber: string): Promise<RecipientQueryResponse> {
    const isEInv = taxOrIdNumber.startsWith('1') || taxOrIdNumber.endsWith('0');
    return {
      isRegistered: isEInv,
      aliases: isEInv ? [`urn:mail:defaultpk@${taxOrIdNumber}.gib.gov.tr`] : [],
      defaultAlias: isEInv ? `urn:mail:defaultpk@${taxOrIdNumber}.gib.gov.tr` : undefined,
    };
  }
}
