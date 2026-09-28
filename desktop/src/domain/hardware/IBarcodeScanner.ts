import { IHardwareDevice } from './IHardwareDevice';

export interface IBarcodeScanner extends IHardwareDevice {
  onBarcodeScanned(callback: (barcode: string) => void): void;
  removeListener(): void;
}
