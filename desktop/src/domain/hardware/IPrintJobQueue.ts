import { PrintJob } from './types';

export interface IPrintJobQueue {
  enqueue(job: Omit<PrintJob, 'status' | 'retryCount' | 'id'>): Promise<PrintJob>;
  dequeue(): Promise<PrintJob | null>;
  peek(): Promise<PrintJob | null>;
  markCompleted(jobId: string): Promise<void>;
  markFailed(jobId: string, error: string): Promise<void>;
  getPendingJobs(): Promise<PrintJob[]>;
  clear(): Promise<void>;
}
