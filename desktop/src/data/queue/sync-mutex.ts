/**
 * Kasam360 - Global Synchronization Mutex
 * Architecture: src/data/queue/sync-mutex.ts
 *
 * Distributed Systems & Concurrency Mandate:
 * Prevents race conditions and transactional interleaving between
 * OfflineSyncQueue (e-document dispatch) and BackgroundSyncWorker (outbox event push).
 */

export class GlobalSyncMutex {
  private static instance: GlobalSyncMutex | null = null;

  private locked = false;
  private holder: string | null = null;
  private acquiredAt: number | null = null;

  public static getInstance(): GlobalSyncMutex {
    if (!GlobalSyncMutex.instance) {
      GlobalSyncMutex.instance = new GlobalSyncMutex();
    }
    return GlobalSyncMutex.instance;
  }

  public static resetInstance(): void {
    if (GlobalSyncMutex.instance) {
      GlobalSyncMutex.instance.reset();
      GlobalSyncMutex.instance = null;
    }
  }

  /**
   * Attempts to synchronously acquire the global sync mutex lock.
   * Returns true if lock was acquired, false if already locked.
   */
  public static tryAcquire(holderId = 'default'): boolean {
    return GlobalSyncMutex.getInstance().tryAcquire(holderId);
  }

  /**
   * Releases the lock. If holderId is supplied, only the current holder can release it.
   */
  public static release(holderId?: string): void {
    GlobalSyncMutex.getInstance().release(holderId);
  }

  /**
   * Returns whether the mutex is currently locked.
   */
  public static isLocked(): boolean {
    return GlobalSyncMutex.getInstance().isLocked();
  }

  /**
   * Returns current lock holder identifier, or null if unlocked.
   */
  public static getHolder(): string | null {
    return GlobalSyncMutex.getInstance().getHolder();
  }

  // ==========================================
  // Instance Methods
  // ==========================================

  public tryAcquire(holderId = 'default'): boolean {
    if (this.locked) {
      return false;
    }
    this.locked = true;
    this.holder = holderId;
    this.acquiredAt = Date.now();
    return true;
  }

  public release(holderId?: string): void {
    if (!this.locked) {
      return;
    }
    if (holderId !== undefined && this.holder !== null && this.holder !== holderId) {
      // Yabancı serbest bırakmalara karşı koru
      return;
    }
    this.locked = false;
    this.holder = null;
    this.acquiredAt = null;
  }

  public isLocked(): boolean {
    return this.locked;
  }

  public getHolder(): string | null {
    return this.holder;
  }

  public getAcquiredAt(): number | null {
    return this.acquiredAt;
  }

  public reset(): void {
    this.locked = false;
    this.holder = null;
    this.acquiredAt = null;
  }
}
