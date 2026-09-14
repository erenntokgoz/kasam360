import { ICashDrawer, DeviceHealth, ConnectionType, DeviceStatus } from '../../../domain/hardware';

export class MockCashDrawer implements ICashDrawer {
  private connected = false;
  private status: DeviceStatus = 'offline';
  private opened = false;

  getId(): string {
    return 'mock-drawer-1';
  }

  getName(): string {
    return 'Mock Cash Drawer';
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
      message: this.status === 'online' ? 'Drawer is ready' : 'Drawer is offline'
    };
  }

  async open(): Promise<boolean> {
    if (!this.connected || this.status !== 'online') {
      return false;
    }
    this.opened = true;
    console.log('[MockCashDrawer] Drawer opened.');
    
    // 2 saniye sonra otomatik kapanmayı simüle et
    setTimeout(() => {
      this.opened = false;
      console.log('[MockCashDrawer] Drawer closed.');
    }, 2000);
    
    return true;
  }

  async isOpen(): Promise<boolean> {
    return this.opened;
  }
  
  // Testler için yardımcı
  simulateFailure() {
    this.status = 'error';
    this.connected = false;
  }
}
