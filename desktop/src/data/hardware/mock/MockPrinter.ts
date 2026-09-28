import { IPrinter, PrintJob, PrintResult, DeviceHealth, ConnectionType, DeviceStatus } from '../../../domain/hardware';

export class MockPrinter implements IPrinter {
  private connected = false;
  private status: DeviceStatus = 'offline';

  getId(): string {
    return 'mock-printer-1';
  }

  getName(): string {
    return 'Mock ESC/POS Printer';
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
      message: this.status === 'online' ? 'Printer is ready' : 'Printer is offline'
    };
  }

  async print(job: PrintJob): Promise<PrintResult> {
    if (!this.connected || this.status !== 'online') {
      return {
        success: false,
        jobId: job.id,
        error: 'Printer is offline or not connected'
      };
    }


    await new Promise(resolve => setTimeout(resolve, 500));

    console.log(`[MockPrinter] Printing job ${job.id}:\n${job.content}`);

    return {
      success: true,
      jobId: job.id
    };
  }

  async cutPaper(): Promise<boolean> {
    if (!this.connected || this.status !== 'online') return false;
    console.log('[MockPrinter] Paper cut.');
    return true;
  }

  // Testler için yardımcı metod
  simulateFailure(offline: boolean) {
    this.status = offline ? 'offline' : 'online';
    this.connected = !offline;
  }
}
