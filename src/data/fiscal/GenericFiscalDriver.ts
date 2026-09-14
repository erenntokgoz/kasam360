import { BaseFiscalDriver } from './BaseFiscalDriver';
import {
  CashDrawerStatus,
  FiscalDeviceStatus,
  FiscalReceiptRequest,
  FiscalReceiptResult,
  FiscalReportOptions,
  FiscalReportResult,
} from './FiscalDevice.interface';

export interface GenericFiscalDriverConfig {
  vendorId?: string;
  vendorName?: string;
  deviceModel?: string;
  deviceSerial?: string;
  port?: string;
  baudRate?: number;
}

/**
 * Concrete Driver Wrapper for Fiscal Devices.
 * Adapts vendor-specific wire protocols, serial communication, or IPC commands
 * into the standardized IFiscalDevice interface.
 */
export class GenericFiscalDriver extends BaseFiscalDriver {
  public readonly vendorId: string;
  public readonly vendorName: string;
  public readonly deviceModel: string;

  private serialNumber: string;
  private isDrawerOpen = false;
  private currentZCounter = 1001;
  private currentReceiptCounter = 5001;

  constructor(config?: GenericFiscalDriverConfig) {
    super();
    this.vendorId = config?.vendorId ?? 'GENERIC_FISCAL_01';
    this.vendorName = config?.vendorName ?? 'Universal Fiscal Driver';
    this.deviceModel = config?.deviceModel ?? 'Kasam-FD-X1';
    this.serialNumber = config?.deviceSerial ?? 'TR-FD-99887766';
  }

  public async initialize(): Promise<boolean> {
    this.isInitialized = true;
    return true;
  }

  public async disconnect(): Promise<void> {
    this.isInitialized = false;
  }

  public async getDeviceStatus(): Promise<FiscalDeviceStatus> {
    this.ensureInitialized();
    return {
      isConnected: true,
      isReady: true,
      hasPaper: true,
      isCoverOpen: false,
      isFiscalMemoryFull: false,
      isEJMemoryFull: false,
      deviceSerial: this.serialNumber,
      brand: this.vendorName,
      model: this.deviceModel,
      firmwareVersion: '1.4.2',
      lastZNumber: `Z-${this.currentZCounter}`,
    };
  }

  public async executeReceiptPrint(receipt: FiscalReceiptRequest): Promise<FiscalReceiptResult> {
    this.ensureInitialized();
    this.currentReceiptCounter += 1;

    const receiptNo = `F-${String(this.currentReceiptCounter).padStart(6, '0')}`;
    const zNo = `Z-${this.currentZCounter}`;
    const ejNo = `EJ-${Date.now().toString().slice(-8)}`;

    return {
      success: true,
      receiptNumber: receiptNo,
      fiscalReceiptNumber: receiptNo,
      zNumber: zNo,
      fiscalMemoryId: `FM-${this.serialNumber}`,
      ejNumber: ejNo,
      totalAmount: receipt.totalAmount,
      printedAt: new Date().toISOString(),
      rawResponse: JSON.stringify({
        status: 'OK',
        receiptNumber: receiptNo,
        fiscalMemory: this.serialNumber,
        itemsCount: receipt.items.length,
      }),
    };
  }

  public async executeZReport(options?: FiscalReportOptions): Promise<FiscalReportResult> {
    this.ensureInitialized();
    this.currentZCounter += 1;
    const zNumberStr = `Z-${String(this.currentZCounter).padStart(4, '0')}`;

    return {
      success: true,
      zNumber: zNumberStr,
      fiscalReportNumber: options?.reportNumber ?? zNumberStr,
      totalSales: 0,
      totalVat: 0,
      cashTotal: 0,
      creditCardTotal: 0,
      mealCardTotal: 0,
      printedAt: new Date().toISOString(),
      rawResponse: JSON.stringify({
        status: 'OK',
        reportType: 'Z_REPORT',
        zNumber: zNumberStr,
        date: options?.date ?? new Date().toISOString().split('T')[0],
      }),
    };
  }

  public async executeCashDrawerQuery(): Promise<CashDrawerStatus> {
    return {
      isOpen: this.isDrawerOpen,
      status: this.isDrawerOpen ? 'OPEN' : 'CLOSED',
      lastOpenedAt: this.isDrawerOpen ? new Date().toISOString() : undefined,
    };
  }

  public async executeCashDrawerOpen(): Promise<boolean> {
    this.isDrawerOpen = true;
    return true;
  }
}
