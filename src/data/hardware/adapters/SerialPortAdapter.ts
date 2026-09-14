import { BaseAdapter } from './BaseAdapter';

export class SerialPortAdapter extends BaseAdapter {
  constructor(id: string, name: string, private portPath: string, private baudRate: number) {
    super(id, name, 'rs232');
  }

  async connect(): Promise<boolean> {
    // Gerçek bir uygulamada, bu seri port açmak için Tauri IPC'yi çağıracaktır
    console.log(`[SerialPortAdapter] Connecting to ${this.portPath} at ${this.baudRate} baud...`);
    this.connected = true;
    this.status = 'online';
    return true;
  }

  async disconnect(): Promise<boolean> {
    // Gerçek bir uygulamada, bu seri portu kapatmak için Tauri IPC'yi çağıracaktır
    console.log(`[SerialPortAdapter] Disconnecting from ${this.portPath}...`);
    this.connected = false;
    this.status = 'offline';
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async writeData(_data: Uint8Array): Promise<boolean> {
    if (!this.connected) throw new Error('Not connected');
    // Veri yazmak için Tauri komutunu çağır
    return true;
  }
}
