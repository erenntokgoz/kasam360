import { IHardwareDevice } from './IHardwareDevice';

export interface ICashDrawer extends IHardwareDevice {
  open(): Promise<boolean>;
  isOpen(): Promise<boolean>;
}
