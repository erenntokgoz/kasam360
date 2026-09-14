import {
  CashDrawerStatus,
  FiscalDeviceStatus,
  FiscalReceiptRequest,
  FiscalReceiptResult,
  FiscalReportOptions,
  FiscalReportResult,
  IFiscalDevice,
} from './FiscalDevice.interface';
import { GenericFiscalDriver } from './GenericFiscalDriver';

/**
 * Evrensel Mali Cihaz Yöneticisi
 *
 * Bağımlılıkları Tersine Çevirme Prensibini uygular.
 * POS Kullanıcı Arayüzü (UI) ve Etki Alanı Kullanım Senaryoları (Domain Use Cases) yalnızca bu Yönetici ile etkileşime girer.
 * Donanım sürücülerinin değişimi (A Satıcısı -> B Satıcısı), tek bir iş mantığı veya UI kodu satırını
 * değiştirmeden kayıt yoluyla işlenir.
 */
export class FiscalDeviceManager implements IFiscalDevice {
  private static instance: FiscalDeviceManager | null = null;
  private drivers: Map<string, IFiscalDevice> = new Map();
  private activeDriverId: string | null = null;

  private constructor() {
    // Varsayılan evrensel sürücüyü kaydet
    const defaultDriver = new GenericFiscalDriver();
    this.registerDriver(defaultDriver);
    this.setActiveDriver(defaultDriver.vendorId);
  }

  public static getInstance(): FiscalDeviceManager {
    if (!FiscalDeviceManager.instance) {
      FiscalDeviceManager.instance = new FiscalDeviceManager();
    }
    return FiscalDeviceManager.instance;
  }

  /**
   * Singleton örneğini sıfırlar (birim testleri için yararlıdır).
   */
  public static resetInstance(): void {
    FiscalDeviceManager.instance = null;
  }

  /**
   * Bir donanım satıcısı sürücüsü uygulamasını kaydeder.
   */
  public registerDriver(driver: IFiscalDevice): void {
    this.drivers.set(driver.vendorId, driver);
    if (!this.activeDriverId) {
      this.activeDriverId = driver.vendorId;
    }
  }

  /**
   * Arayanları etkilemeden çalışma zamanında aktif satıcı sürücüsünü değiştirir.
   */
  public setActiveDriver(vendorId: string): void {
    if (!this.drivers.has(vendorId)) {
      throw new Error(`Fiscal driver '${vendorId}' is not registered.`);
    }
    this.activeDriverId = vendorId;
  }

  public getActiveDriver(): IFiscalDevice {
    if (!this.activeDriverId || !this.drivers.has(this.activeDriverId)) {
      throw new Error('No active fiscal device driver configured.');
    }
    const driver = this.drivers.get(this.activeDriverId);
    if (!driver) {
      throw new Error('Active driver reference is missing.');
    }
    return driver;
  }

  public get vendorId(): string {
    return this.getActiveDriver().vendorId;
  }

  public get vendorName(): string {
    return this.getActiveDriver().vendorName;
  }

  public get deviceModel(): string {
    return this.getActiveDriver().deviceModel;
  }

  public async initialize(): Promise<boolean> {
    return this.getActiveDriver().initialize();
  }

  public async disconnect(): Promise<void> {
    return this.getActiveDriver().disconnect();
  }

  public async getDeviceStatus(): Promise<FiscalDeviceStatus> {
    return this.getActiveDriver().getDeviceStatus();
  }

  public async printFiscalReceipt(receipt: FiscalReceiptRequest): Promise<FiscalReceiptResult> {
    return this.getActiveDriver().printFiscalReceipt(receipt);
  }

  public async printZReport(options?: FiscalReportOptions): Promise<FiscalReportResult> {
    return this.getActiveDriver().printZReport(options);
  }

  public async printXReport(): Promise<FiscalReportResult> {
    const driver = this.getActiveDriver();
    if (driver.printXReport) {
      return driver.printXReport();
    }
    // X-Raporu yerel olarak desteklenmiyorsa geri dönüş
    return {
      success: true,
      printedAt: new Date().toISOString(),
      rawResponse: 'X-Report completed (simulated)',
    };
  }

  public async getCashDrawerStatus(): Promise<CashDrawerStatus> {
    return this.getActiveDriver().getCashDrawerStatus();
  }

  public async openCashDrawer(): Promise<boolean> {
    return this.getActiveDriver().openCashDrawer();
  }
}
