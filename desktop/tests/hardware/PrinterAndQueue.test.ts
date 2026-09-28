import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockPrinter } from '../../src/data/hardware/mock/MockPrinter';
import { PersistentPrintQueue } from '../../src/data/hardware/queue/PersistentPrintQueue';
import { PrintSpooler } from '../../src/data/hardware/queue/PrintSpooler';

describe('Hardware Abstraction - Printer & Queue', () => {
  let printer: MockPrinter;
  let queue: PersistentPrintQueue;
  let spooler: PrintSpooler;

  beforeEach(async () => {
    // Mock localStorage for PersistentPrintQueue
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    });

    printer = new MockPrinter();
    await printer.connect();
    
    queue = new PersistentPrintQueue();
    await queue.clear();

    // Fast interval for tests
    spooler = new PrintSpooler(printer, queue, 100, 3);
  });

  afterEach(() => {
    spooler.stop();
    vi.restoreAllMocks();
  });

  it('TEST: printer success - should print and mark completed', async () => {
    const job = await queue.enqueue({ content: 'TEST RECEIPT', createdAt: Date.now() });
    expect(job.status).toBe('pending');
    
    const result = await printer.print(job);
    expect(result.success).toBe(true);
    
    await queue.markCompleted(job.id);
    const pending = await queue.getPendingJobs();
    expect(pending.length).toBe(0);
  });

  it('TEST: printer unavailable - queue should hold job', async () => {
    printer.simulateFailure(true); // Offline
    
    await queue.enqueue({ content: 'TEST RECEIPT OFFLINE', createdAt: Date.now() });
    
    spooler.start();
    await new Promise(r => setTimeout(r, 300)); // wait for spooler tick
    
    const pending = await queue.getPendingJobs();
    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe('pending'); // Spooler shouldn't have dequeued it if printer is offline
  });

  it('TEST: retry - spooler should retry when printer comes online', async () => {
    printer.simulateFailure(true); // Offline
    await queue.enqueue({ content: 'RETRY TEST', createdAt: Date.now() });
    
    spooler.start();
    await new Promise(r => setTimeout(r, 200)); 
    
    let pending = await queue.getPendingJobs();
    expect(pending.length).toBe(1);

    // Printer comes online
    printer.simulateFailure(false);
    
    await new Promise(r => setTimeout(r, 700)); // wait for spooler to process and mock print delay
    
    pending = await queue.getPendingJobs();
    expect(pending.length).toBe(0); // Job processed and completed
  });

  it('TEST: process restart & queue recovery', async () => {
    // Enqueue job with first queue instance
    await queue.enqueue({ content: 'PERSISTENCE TEST', createdAt: Date.now() });
    
    // Simulate restart by creating a new queue (which reads from mocked localStorage)
    const newQueue = new PersistentPrintQueue();
    const pending = await newQueue.getPendingJobs();
    
    expect(pending.length).toBe(1);
    expect(pending[0].content).toBe('PERSISTENCE TEST');
  });
});
