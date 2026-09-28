import { IOKC, OKCTransactionData, OKCTransactionResult, DeviceHealth, ConnectionType, DeviceStatus } from '../../../domain/hardware';

export class MockOKC implements IOKC {
  private connected = false;
  private status: DeviceStatus = 'offline';
  private transactionCount = 0;

  getId(): string {
    return 'mock-okc-1';
  }

  getName(): string {
    return 'Mock YN ÖKC';
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
      message: this.status === 'online' ? 'ÖKC is ready' : 'ÖKC is offline'
    };
  }

  async processTransaction(data: OKCTransactionData): Promise<OKCTransactionResult> {
    if (!this.connected || this.status !== 'online') {
      return {
        success: false,
        error: 'ÖKC device is not ready'
      };
    }

    // Ağ/işlem gecikmesini simüle et
    await new Promise(resolve => setTimeout(resolve, 800));

    this.transactionCount++;
    const fiscalCode = `FSC-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    console.log(`[MockOKC] Processed transaction: Amount: ${data.amount}, Tax: ${data.taxRate}%, FiscalCode: ${fiscalCode}`);

    return {
      success: true,
      zNo: 'Z-001',
      receiptNo: `R-${this.transactionCount.toString().padStart(4, '0')}`,
      fiscalCode
    };
  }

  async printZReport(): Promise<boolean> {
    if (!this.connected || this.status !== 'online') return false;
    console.log('[MockOKC] Z Report printed.');
    return true;
  }

  async printXReport(): Promise<boolean> {
    if (!this.connected || this.status !== 'online') return false;
    console.log('[MockOKC] X Report printed.');
    return true;
  }

  simulateFailure() {
    this.status = 'error';
  }
}
