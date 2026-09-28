import { IBarcodeScanner, DeviceHealth, ConnectionType, DeviceStatus } from '../../../domain/hardware';

export class MockBarcodeScanner implements IBarcodeScanner {
  private connected = false;
  private status: DeviceStatus = 'offline';
  private callback: ((barcode: string) => void) | null = null;

  getId(): string {
    return 'mock-scanner-1';
  }

  getName(): string {
    return 'Mock Barcode Scanner';
  }

  getConnectionType(): ConnectionType {
    return 'mock';
  }

  async connect(): Promise<boolean> {
    this.connected = true;
    this.status = 'online';
    return true;
  }

  async disconnect(): Promise<boolean> {
    this.connected = false;
    this.status = 'offline';
    return true;
  }

  async checkHealth(): Promise<DeviceHealth> {
    return {
      status: this.status,
      lastChecked: Date.now(),
      message: this.status === 'online' ? 'Scanner is ready' : 'Scanner is offline'
    };
  }

  onBarcodeScanned(cb: (barcode: string) => void): void {
    this.callback = cb;
  }

  removeListener(): void {
    this.callback = null;
  }

  // Testler/mocklar için bir barkod taramasını simüle et
  simulateScan(barcode: string) {
    if (this.connected && this.status === 'online' && this.callback) {
      console.log(`[MockBarcodeScanner] Scanned: ${barcode}`);
      this.callback(barcode);
    }
  }
}
