import { BaseAdapter } from './BaseAdapter';

export class TcpIpAdapter extends BaseAdapter {
  constructor(id: string, name: string, private ipAddress: string, private port: number) {
    super(id, name, 'tcpip');
  }

  async connect(): Promise<boolean> {
    // TCP/IP soket bağlantı mantığı (örn. ağ yazıcıları için)
    console.log(`[TcpIpAdapter] Connecting to ${this.ipAddress}:${this.port}...`);
    this.connected = true;
    this.status = 'online';
    return true;
  }

  async disconnect(): Promise<boolean> {
    console.log(`[TcpIpAdapter] Disconnecting from ${this.ipAddress}:${this.port}...`);
    this.connected = false;
    this.status = 'offline';
    return true;
  }
}
