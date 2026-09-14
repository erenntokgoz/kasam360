import { IPrinter, IPrintJobQueue } from '../../../domain/hardware';

export class PrintSpooler {
  private isProcessing = false;
  private intervalId: number | null = null;

  constructor(
    private printer: IPrinter,
    private queue: IPrintJobQueue,
    private checkIntervalMs = 5000,
    private maxRetries = 3
  ) {}

  start() {
    if (this.intervalId !== null) return;
    this.intervalId = setInterval(() => this.processQueue(), this.checkIntervalMs) as unknown as number;
  }

  stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const health = await this.printer.checkHealth();
      if (health.status !== 'online') {
        // Yazıcı hazır değil, bir sonraki işleyişi bekleyin
        this.isProcessing = false;
        return;
      }

      let job = await this.queue.dequeue();
      while (job !== null) {
        if (job.retryCount > this.maxRetries) {
          await this.queue.markFailed(job.id, 'Max retries exceeded');
          job = await this.queue.dequeue();
          continue;
        }

        const result = await this.printer.print(job);
        
        if (result.success) {
          await this.queue.markCompleted(job.id);
        } else {
          await this.queue.markFailed(job.id, result.error || 'Unknown printing error');
          // Yazıcı başarısız olursa, döngüyü kırın ve daha sonra tekrar deneyin
          break;
        }

        job = await this.queue.dequeue();
      }
    } catch (error) {
      console.error('Error processing print queue:', error);
    } finally {
      this.isProcessing = false;
    }
  }
}
