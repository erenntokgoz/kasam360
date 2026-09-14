import { IHardwareDevice } from './IHardwareDevice';

export interface OKCTransactionData {
  amount: number;
  taxRate: number;
  receiptNumber?: string;
}

export interface OKCTransactionResult {
  success: boolean;
  zNo?: string;
  receiptNo?: string;
  fiscalCode?: string;
  error?: string;
}

export interface IOKC extends IHardwareDevice {
  processTransaction(data: OKCTransactionData): Promise<OKCTransactionResult>;
  printZReport(): Promise<boolean>;
  printXReport(): Promise<boolean>;
}
