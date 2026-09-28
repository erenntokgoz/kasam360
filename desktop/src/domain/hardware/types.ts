export type DeviceStatus = 'online' | 'offline' | 'error' | 'unknown';
export type ConnectionType = 'usb' | 'rs232' | 'tcpip' | 'bluetooth' | 'mock';

export interface DeviceHealth {
  status: DeviceStatus;
  lastChecked: number;
  message?: string;
  batteryLevel?: number;
}

export interface PrintJob {
  id: string;
  content: string; // ESC/POS komutları veya düz metin
  createdAt: number;
  status: 'pending' | 'processing' | 'failed' | 'completed';
  retryCount: number;
  lastError?: string;
}

export interface PrintResult {
  success: boolean;
  jobId: string;
  error?: string;
}
