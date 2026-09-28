import { IPrinter, ICashDrawer, IBarcodeScanner, IOKC, IPrintJobQueue } from '../../domain/hardware';
import { MockPrinter } from './mock/MockPrinter';
import { MockCashDrawer } from './mock/MockCashDrawer';
import { MockBarcodeScanner } from './mock/MockBarcodeScanner';
import { MockOKC } from './mock/MockOKC';
import { PersistentPrintQueue } from './queue/PersistentPrintQueue';
import { PrintSpooler } from './queue/PrintSpooler';

export class HardwareManager {
  private static instance: HardwareManager;

  public printer!: IPrinter;
  public cashDrawer!: ICashDrawer;
  public barcodeScanner!: IBarcodeScanner;
  public okc!: IOKC;
  
  public printQueue!: IPrintJobQueue;
  public printSpooler!: PrintSpooler;

  private constructor() {}

  public static getInstance(): HardwareManager {
    if (!HardwareManager.instance) {
      HardwareManager.instance = new HardwareManager();
    }
    return HardwareManager.instance;
  }

  public async initialize(): Promise<void> {
    // Gerçek bir uygulamada, mock veya gerçek adaptörlerin kullanılıp kullanılmayacağına karar vermek için yapılandırma okunurdu
    // Şimdilik, gereksinimlere dayanarak, fiziksel cihazlar olmadığında mock adaptörler kullanıyoruz.

    this.printer = new MockPrinter();
    this.cashDrawer = new MockCashDrawer();
    this.barcodeScanner = new MockBarcodeScanner();
    this.okc = new MockOKC();

    await Promise.all([
      this.printer.connect(),
      this.cashDrawer.connect(),
      this.barcodeScanner.connect(),
      this.okc.connect()
    ]);

    // Spooler ve Queue başlat
    this.printQueue = new PersistentPrintQueue();
    this.printSpooler = new PrintSpooler(this.printer, this.printQueue, 3000, 5);
    this.printSpooler.start();

    console.log('[HardwareManager] Hardware abstraction layer initialized successfully.');
  }

  public async shutdown(): Promise<void> {
    this.printSpooler?.stop();
    
    await Promise.all([
      this.printer?.disconnect(),
      this.cashDrawer?.disconnect(),
      this.barcodeScanner?.disconnect(),
      this.okc?.disconnect()
    ]);
    
    console.log('[HardwareManager] Hardware abstraction layer shut down.');
  }
}

export const hardwareManager = HardwareManager.getInstance();
