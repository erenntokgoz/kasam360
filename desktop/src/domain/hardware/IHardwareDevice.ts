import { DeviceHealth, ConnectionType } from './types';

export interface IHardwareDevice {
  getId(): string;
  getName(): string;
  getConnectionType(): ConnectionType;
  connect(): Promise<boolean>;
  disconnect(): Promise<boolean>;
  checkHealth(): Promise<DeviceHealth>;
}
