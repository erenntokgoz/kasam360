import {
  CashDrawerStatus,
  FiscalDeviceStatus,
  FiscalPaymentBreakdown,
  FiscalReceiptItem,
  FiscalReceiptRequest,
  FiscalReceiptResult,
  FiscalReportOptions,
  FiscalReportResult,
  IFiscalDevice,
} from './FiscalDevice.interface';

/**
 * Abstract Base Driver for Fiscal Hardware Integration.
 * Provides parameter validation, receipt calculation verification, and lifecycle hooks.
 */
export abstract class BaseFiscalDriver implements IFiscalDevice {
  public abstract readonly vendorId: string;
  public abstract readonly vendorName: string;
  public abstract readonly deviceModel: string;

  protected isInitialized = false;

  public abstract initialize(): Promise<boolean>;
  public abstract disconnect(): Promise<void>;
  public abstract getDeviceStatus(): Promise<FiscalDeviceStatus>;
  public abstract executeReceiptPrint(receipt: FiscalReceiptRequest): Promise<FiscalReceiptResult>;
  public abstract executeZReport(options?: FiscalReportOptions): Promise<FiscalReportResult>;
  public abstract executeCashDrawerQuery(): Promise<CashDrawerStatus>;
  public abstract executeCashDrawerOpen(): Promise<boolean>;

  public async printFiscalReceipt(receipt: FiscalReceiptRequest): Promise<FiscalReceiptResult> {
    this.validateReceiptRequest(receipt);
    return this.executeReceiptPrint(receipt);
  }

  public async printZReport(options?: FiscalReportOptions): Promise<FiscalReportResult> {
    this.ensureInitialized();
    return this.executeZReport(options);
  }

  public async getCashDrawerStatus(): Promise<CashDrawerStatus> {
    this.ensureInitialized();
    return this.executeCashDrawerQuery();
  }

  public async openCashDrawer(): Promise<boolean> {
    this.ensureInitialized();
    return this.executeCashDrawerOpen();
  }

  protected ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error(`Fiscal device '${this.vendorName}' is not initialized.`);
    }
  }

  protected validateReceiptRequest(receipt: FiscalReceiptRequest): void {
    if (!receipt.receiptId) {
      throw new Error('Receipt ID is required.');
    }
    if (!receipt.items || receipt.items.length === 0) {
      throw new Error('Receipt must contain at least one item.');
    }
    if (!receipt.payments || receipt.payments.length === 0) {
      throw new Error('Receipt must contain at least one payment method.');
    }

    const calculatedItemsTotal = receipt.items.reduce(
      (sum: number, item: FiscalReceiptItem) => sum + item.totalAmount,
      0
    );
    const calculatedPaymentsTotal = receipt.payments.reduce(
      (sum: number, payment: FiscalPaymentBreakdown) => sum + payment.amount,
      0
    );

    const roundedItems = Math.round(calculatedItemsTotal * 100) / 100;
    const roundedPayments = Math.round(calculatedPaymentsTotal * 100) / 100;
    const roundedReceiptTotal = Math.round(receipt.totalAmount * 100) / 100;

    if (Math.abs(roundedItems - roundedReceiptTotal) > 0.01) {
      throw new Error(
        `Receipt validation failed: Items sum (${roundedItems}) does not match receipt total (${roundedReceiptTotal}).`
      );
    }

    if (Math.abs(roundedPayments - roundedReceiptTotal) > 0.01) {
      throw new Error(
        `Receipt validation failed: Payments sum (${roundedPayments}) does not match receipt total (${roundedReceiptTotal}).`
      );
    }
  }
}
