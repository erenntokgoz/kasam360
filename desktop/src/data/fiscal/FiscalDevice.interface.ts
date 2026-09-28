/**
 * Evrensel Mali Cihaz Entegrasyon Sözleşmesi
 * Kasam360 Donanım Entegrasyon Katmanı
 *
 * Bağımlılıkları Tersine Çevirme Prensibini (DIP) uygular.
 * Çekirdek iş sistemleri ve POS arayüzü yalnızca bu soyutlama ile etkileşime girerek,
 * donanım satıcısı değişimlerini (örn. Hugin, Beko, Ingenico, Vera) şeffaf hale getirir.
 */

export type FiscalPaymentType = 'CASH' | 'CREDIT_CARD' | 'MEAL_CARD' | 'CHECK' | 'OTHER';

export interface FiscalPaymentBreakdown {
  type: FiscalPaymentType;
  amount: number;
}

export interface FiscalReceiptItem {
  id?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  vatRate: number; // Yüzde: örn. 1, 10, 20
  totalAmount: number; // KDV ve indirimler dahil son tutar
  discountAmount?: number;
  categoryCode?: string;
  unit?: string;
}

export interface FiscalReceiptRequest {
  receiptId: string;
  orderId: string;
  items: FiscalReceiptItem[];
  payments: FiscalPaymentBreakdown[];
  totalAmount: number;
  totalVatAmount: number;
  cashierId?: string;
  branchId?: string;
  customerTaxNumber?: string; // Vergiye kayıtlı müşteri ise VKN veya TCKN
  customerTitle?: string;
  notes?: string[];
  timestamp?: string;
}

export interface FiscalReceiptResult {
  success: boolean;
  receiptNumber?: string;
  fiscalReceiptNumber?: string;
  zNumber?: string;
  fiscalMemoryId?: string;
  ejNumber?: string; // Elektronik Kayıt Ünitesi sıra numarası
  totalAmount: number;
  printedAt: string;
  rawResponse?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface FiscalReportOptions {
  date?: string; // YYYY-MM-DD
  reportNumber?: string;
  includeDepartments?: boolean;
}

export interface FiscalReportResult {
  success: boolean;
  zNumber?: string;
  fiscalReportNumber?: string;
  totalSales?: number;
  totalVat?: number;
  cashTotal?: number;
  creditCardTotal?: number;
  mealCardTotal?: number;
  printedAt: string;
  rawResponse?: string;
  errorCode?: string;
  errorMessage?: string;
}

export type DrawerState = 'OPEN' | 'CLOSED' | 'UNKNOWN';

export interface CashDrawerStatus {
  isOpen: boolean;
  status: DrawerState;
  lastOpenedAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface FiscalDeviceStatus {
  isConnected: boolean;
  isReady: boolean;
  hasPaper: boolean;
  isCoverOpen: boolean;
  isFiscalMemoryFull: boolean;
  isEJMemoryFull: boolean;
  deviceSerial: string;
  brand: string;
  model: string;
  firmwareVersion?: string;
  lastZNumber?: string;
}

/**
 * Yazar Kasalar / Mali Yazıcılar için Evrensel Donanım Sözleşmesi.
 * Somut satıcı sürücüleri bu arayüzü uygulamalıdır.
 */
export interface IFiscalDevice {
  readonly vendorId: string;
  readonly vendorName: string;
  readonly deviceModel: string;

  /**
   * Mali donanımla iletişimi başlatır.
   */
  initialize(): Promise<boolean>;

  /**
   * Donanım bağlantılarını düzgün bir şekilde kapatır.
   */
  disconnect(): Promise<void>;

  /**
   * Mevcut donanım durumunu (kağıt durumu, kapak, iletişim, hafıza) kontrol eder.
   */
  getDeviceStatus(): Promise<FiscalDeviceStatus>;

  /**
   * Cihaza mali fiş yazdırma işlemini gönderir.
   */
  printFiscalReceipt(receipt: FiscalReceiptRequest): Promise<FiscalReceiptResult>;

  /**
   * Gün sonu Z-Raporu oluşturma ve yazdırma işlemini gönderir.
   */
  printZReport(options?: FiscalReportOptions): Promise<FiscalReportResult>;

  /**
   * Mali günü kapatmadan bir ara X-Raporu gönderir.
   */
  printXReport?(): Promise<FiscalReportResult>;

  /**
   * Bağlı fiziksel para çekmecesinin mevcut durumunu denetler.
   */
  getCashDrawerStatus(): Promise<CashDrawerStatus>;

  /**
   * Para çekmecesi çıkarma bobinini tetikler.
   */
  openCashDrawer(): Promise<boolean>;
}
