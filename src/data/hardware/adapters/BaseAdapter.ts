import { ConnectionType, DeviceHealth, IHardwareDevice } from '../../../domain/hardware';

export abstract class BaseAdapter implements IHardwareDevice {
  protected connected = false;
  protected status: DeviceHealth['status'] = 'offline';

  constructor(protected id: string, protected name: string, protected connectionType: ConnectionType) {}

  getId(): string {
    return this.id;
  }

  getName(): string {
    return this.name;
  }

  getConnectionType(): ConnectionType {
    return this.connectionType;
  }

  abstract connect(): Promise<boolean>;
  
  abstract disconnect(): Promise<boolean>;

  async checkHealth(): Promise<DeviceHealth> {
    return {
      status: this.status,
      lastChecked: Date.now(),
      message: this.status === 'online' ? 'Device connected' : 'Device disconnected'
    };
  }
}
