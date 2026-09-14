import { IHardwareDevice } from './IHardwareDevice';
import { PrintJob, PrintResult } from './types';

export interface IPrinter extends IHardwareDevice {
  print(job: PrintJob): Promise<PrintResult>;
  cutPaper(): Promise<boolean>;
}
