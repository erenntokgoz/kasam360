import {
  EDocumentPayload,
  EDocumentSendResult,
  EDocumentStatusResult,
  IEInvoiceIntegrator,
} from './EInvoiceIntegrator.interface';

/**
 * Base abstract integrator providing pre-flight schema validation,
 * tax computation verification, and normalized error wrappers.
 */
export abstract class BaseEInvoiceIntegrator implements IEInvoiceIntegrator {
  public abstract readonly providerId: string;
  public abstract readonly providerName: string;

  public abstract executeSendEArchive(document: EDocumentPayload): Promise<EDocumentSendResult>;
  public abstract executeSendEInvoice(document: EDocumentPayload): Promise<EDocumentSendResult>;
  public abstract executeStatusCheck(documentUuid: string): Promise<EDocumentStatusResult>;

  public async sendEArchiveInvoice(document: EDocumentPayload): Promise<EDocumentSendResult> {
    this.validateDocumentPayload(document);
    return this.executeSendEArchive(document);
  }

  public async sendEInvoice(document: EDocumentPayload): Promise<EDocumentSendResult> {
    this.validateDocumentPayload(document);
    return this.executeSendEInvoice(document);
  }

  public async checkDocumentStatus(documentUuid: string): Promise<EDocumentStatusResult> {
    if (!documentUuid || documentUuid.trim().length === 0) {
      throw new Error('Document UUID is required for status check.');
    }
    return this.executeStatusCheck(documentUuid);
  }

  protected validateDocumentPayload(doc: EDocumentPayload): void {
    if (!doc.uuid) {
      throw new Error('Document UUID is mandatory.');
    }
    if (!doc.customer || !doc.customer.taxOrIdNumber) {
      throw new Error('Customer Tax or Identity Number (VKN/TCKN) is mandatory.');
    }
    const taxNum = doc.customer.taxOrIdNumber.trim();
    if (taxNum.length !== 10 && taxNum.length !== 11) {
      throw new Error(`Invalid VKN/TCKN length: expected 10 or 11 digits, got ${taxNum.length}.`);
    }
    if (!doc.items || doc.items.length === 0) {
      throw new Error('Document must contain at least one line item.');
    }

    const calculatedSubTotal = doc.items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0
    );
    const calculatedVat = doc.items.reduce((sum, item) => sum + item.vatAmount, 0);
    const roundedSubTotal = Math.round(calculatedSubTotal * 100) / 100;
    const roundedVat = Math.round(calculatedVat * 100) / 100;
    const roundedDocGrandTotal = Math.round(doc.grandTotal * 100) / 100;
    const expectedGrandTotal =
      Math.round((roundedSubTotal + roundedVat - (doc.totalDiscount ?? 0)) * 100) / 100;

    if (Math.abs(expectedGrandTotal - roundedDocGrandTotal) > 0.05) {
      throw new Error(
        `E-Document validation failed: Calculated total (${expectedGrandTotal}) differs from grand total (${roundedDocGrandTotal}).`
      );
    }
  }
}
