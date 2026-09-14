import { IPrintJobQueue, PrintJob } from '../../../domain/hardware';

const STORAGE_KEY = 'kasam360_print_jobs';

export class PersistentPrintQueue implements IPrintJobQueue {
  private memoryQueue: PrintJob[] = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        this.memoryQueue = JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load print queue from storage:', error);
      this.memoryQueue = [];
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.memoryQueue));
    } catch (error) {
      console.error('Failed to save print queue to storage:', error);
    }
  }

  async enqueue(jobData: Omit<PrintJob, 'status' | 'retryCount' | 'id'>): Promise<PrintJob> {
    const job: PrintJob = {
      ...jobData,
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      status: 'pending',
      retryCount: 0
    };

    this.memoryQueue.push(job);
    this.saveToStorage();
    return job;
  }

  async dequeue(): Promise<PrintJob | null> {
    const pendingJobs = this.memoryQueue.filter(j => j.status === 'pending' || j.status === 'failed');
    if (pendingJobs.length === 0) return null;

    const job = pendingJobs[0];
    job.status = 'processing';
    job.retryCount++;
    this.saveToStorage();

    return job;
  }

  async peek(): Promise<PrintJob | null> {
    const pendingJobs = this.memoryQueue.filter(j => j.status === 'pending' || j.status === 'failed');
    if (pendingJobs.length === 0) return null;
    return pendingJobs[0];
  }

  async markCompleted(jobId: string): Promise<void> {
    const job = this.memoryQueue.find(j => j.id === jobId);
    if (job) {
      job.status = 'completed';
      // İsteğe bağlı olarak yer kazanmak için tamamlanan işleri kaldırın
      this.memoryQueue = this.memoryQueue.filter(j => j.id !== jobId);
      this.saveToStorage();
    }
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    const job = this.memoryQueue.find(j => j.id === jobId);
    if (job) {
      job.status = 'failed';
      job.lastError = error;
      this.saveToStorage();
    }
  }

  async getPendingJobs(): Promise<PrintJob[]> {
    return this.memoryQueue.filter(j => j.status === 'pending' || j.status === 'failed');
  }

  async clear(): Promise<void> {
    this.memoryQueue = [];
    this.saveToStorage();
  }
}
