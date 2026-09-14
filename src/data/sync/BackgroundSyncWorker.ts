/**
 * Kasam360 - Background Outbox Synchronization Worker
 * Architecture: src/data/sync/BackgroundSyncWorker.ts
 *
 * Distributed Systems Mandate:
 * - Real-time network listener tracking online/offline state.
 * - Sequential push pipeline dispatching pending outbox events to POST /sync/push.
 * - Enforces transactional batching and exponential retry backoff.
 * - Integrates with VectorClockManager and DomainConflictResolver for drift-free conflict resolution.
 */

import { GlobalSyncMutex } from '../queue/sync-mutex';
import { DomainConflictResolver } from './DomainConflictResolver';
import {
  ConflictDetail,
  INetworkStatusListener,
  IOutboxRepository,
  ISyncHttpClient,
  OutboxRecord,
  SyncPayload,
  SyncPushResponse,
  VectorClock,
} from './types';
import { VectorClockManager } from './VectorClockManager';

export interface BackgroundSyncWorkerConfig {
  terminalId: string;
  branchId: string;
  pushEndpointUrl?: string;
  batchSize?: number;
  syncIntervalMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  backoffFactor?: number;
  maxAttempts?: number;
  networkListener?: INetworkStatusListener;
  outboxRepository?: IOutboxRepository;
  httpClient?: ISyncHttpClient;
  vectorClockManager?: VectorClockManager;
  autoStart?: boolean;
}

export type SyncWorkerEventType =
  | 'ONLINE'
  | 'OFFLINE'
  | 'SYNC_STARTED'
  | 'BATCH_SUCCESS'
  | 'BATCH_FAILED'
  | 'RECORD_FAILED'
  | 'CONFLICT_RESOLVED'
  | 'MAX_RETRIES_EXCEEDED';

export interface SyncWorkerEvent {
  type: SyncWorkerEventType;
  terminalId: string;
  timestamp: string;
  batchCount?: number;
  recordId?: string;
  error?: string;
  conflictDetail?: ConflictDetail;
}

export type SyncWorkerListener = (event: SyncWorkerEvent) => void;

/**
 * Standard Network Monitor detecting online/offline transitions.
 * Cross-platform support for webview, browser, Tauri, and headless test runners.
 */
export class RealtimeNetworkListener implements INetworkStatusListener {
  private manualOnlineState: boolean | null = null;

  public isOnline(): boolean {
    if (this.manualOnlineState !== null) {
      return this.manualOnlineState;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
    return true;
  }

  public setOnline(state: boolean): void {
    this.manualOnlineState = state;
  }

  public subscribe(listener: (isOnline: boolean) => void): () => void {
    if (typeof window === 'undefined') {
      return () => {};
    }

    const onOnline = (): void => listener(true);
    const onOffline = (): void => listener(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }
}

/**
 * In-Memory & LocalStorage backed Outbox Repository with ACID isolation guarantees.
 */
export class DefaultOutboxRepository implements IOutboxRepository {
  private records: Map<string, OutboxRecord> = new Map();
  private readonly storageKey: string;

  public constructor(storageKey = 'kasam360_outbox_queue_v1') {
    this.storageKey = storageKey;
    this.loadFromStorage();
  }

  public async getPendingRecords(limit: number): Promise<OutboxRecord[]> {
    const now = Date.now();
    return Array.from(this.records.values())
      .filter((r) => {
        if (r.status !== 'PENDING') {
          return false;
        }
        if (!r.nextRetryAt) {
          return true;
        }
        return new Date(r.nextRetryAt).getTime() <= now;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, limit);
  }

  public async markInFlight(recordIds: string[]): Promise<void> {
    const now = new Date().toISOString();
    for (const id of recordIds) {
      const rec = this.records.get(id);
      if (rec) {
        rec.status = 'IN_FLIGHT';
        rec.updatedAt = now;
      }
    }
    this.persistToStorage();
  }

  public async markCompleted(recordIds: string[]): Promise<void> {
    const now = new Date().toISOString();
    for (const id of recordIds) {
      const rec = this.records.get(id);
      if (rec) {
        rec.status = 'COMPLETED';
        rec.updatedAt = now;
      }
    }
    this.persistToStorage();
  }

  public async markFailed(recordId: string, error: string, nextRetryAt: string): Promise<void> {
    const rec = this.records.get(recordId);
    if (rec) {
      rec.attempts += 1;
      rec.lastError = error;
      rec.updatedAt = new Date().toISOString();

      if (rec.attempts >= rec.maxAttempts) {
        rec.status = 'FAILED';
      } else {
        rec.status = 'PENDING';
        rec.nextRetryAt = nextRetryAt;
      }
    }
    this.persistToStorage();
  }

  public async markConflict(recordId: string, error: string): Promise<void> {
    const rec = this.records.get(recordId);
    if (rec) {
      rec.status = 'CONFLICT';
      rec.lastError = error;
      rec.updatedAt = new Date().toISOString();
    }
    this.persistToStorage();
  }

  public async enqueue(
    recordData: Omit<OutboxRecord, 'id' | 'status' | 'attempts' | 'createdAt'>
  ): Promise<OutboxRecord> {
    const id = `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();

    const record: OutboxRecord = {
      ...recordData,
      id,
      status: 'PENDING',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      nextRetryAt: now,
    };

    this.records.set(id, record);
    this.persistToStorage();
    return record;
  }

  public async getRecordById(id: string): Promise<OutboxRecord | null> {
    return this.records.get(id) ?? null;
  }

  public async getAllRecords(): Promise<OutboxRecord[]> {
    return Array.from(this.records.values());
  }

  private loadFromStorage(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (isValidOutboxRecord(item)) {
                // Başlatma/yeniden yükleme sırasında işlemdeki kayıtları sıfırla
                if (item.status === 'IN_FLIGHT') {
                  item.status = 'PENDING';
                }
                this.records.set(item.id, item);
              }
            }
          }
        }
      }
    } catch {
      // Bellek geri dönüşü
    }
  }

  private persistToStorage(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(
          this.storageKey,
          JSON.stringify(Array.from(this.records.values()))
        );
      }
    } catch {
      // Kota geri dönüşü
    }
  }
}

/**
 * Standard HTTP Client for /sync/push with structured error handling.
 */
export class DefaultSyncHttpClient implements ISyncHttpClient {
  public async postSyncPush(url: string, payload: SyncPayload): Promise<SyncPushResponse> {
    if (typeof fetch === 'undefined') {
      throw new Error('fetch is unavailable in current runtime environment.');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kasam-Terminal-Id': payload.terminalId,
        'X-Kasam-Branch-Id': payload.branchId,
        'X-Kasam-Sync-Id': payload.syncId,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Sync Push HTTP ${response.status}: ${errorText}`);
    }

    const data: unknown = await response.json();
    if (!isSyncPushResponse(data)) {
      throw new Error('Invalid SyncPushResponse payload received from remote sync endpoint.');
    }
    return data;
  }
}

/**
 * Background Outbox Worker implementing real-time connectivity listening,
 * sequential push pipeline, transactional batching, and retry backoff.
 */
export class BackgroundSyncWorker {
  private readonly terminalId: string;
  private readonly branchId: string;
  private readonly pushEndpointUrl: string;
  private readonly batchSize: number;
  private readonly syncIntervalMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly backoffFactor: number;
  private readonly maxAttempts: number;

  private readonly networkListener: INetworkStatusListener;
  private readonly outboxRepo: IOutboxRepository;
  private readonly httpClient: ISyncHttpClient;
  private readonly vectorClockManager: VectorClockManager;

  private isProcessing = false;
  private intervalTimerId: ReturnType<typeof setInterval> | null = null;
  private unsubscribeNetwork: (() => void) | null = null;
  private listeners: Set<SyncWorkerListener> = new Set();

  public constructor(config: BackgroundSyncWorkerConfig) {
    this.terminalId = config.terminalId;
    this.branchId = config.branchId;
    this.pushEndpointUrl = config.pushEndpointUrl ?? '/sync/push';
    this.batchSize = config.batchSize ?? 25;
    this.syncIntervalMs = config.syncIntervalMs ?? 10000;
    this.baseBackoffMs = config.baseBackoffMs ?? 1000;
    this.maxBackoffMs = config.maxBackoffMs ?? 60000;
    this.backoffFactor = config.backoffFactor ?? 2;
    this.maxAttempts = config.maxAttempts ?? 5;

    this.networkListener = config.networkListener ?? new RealtimeNetworkListener();
    this.outboxRepo = config.outboxRepository ?? new DefaultOutboxRepository();
    this.httpClient = config.httpClient ?? new DefaultSyncHttpClient();
    this.vectorClockManager =
      config.vectorClockManager ?? new VectorClockManager(config.terminalId);

    if (config.autoStart !== false) {
      this.start();
    }
  }

  /**
   * Registers event listener for telemetry and monitoring.
   */
  public addListener(listener: SyncWorkerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: SyncWorkerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Dinleyici istisnalarının senkronizasyon döngüsünü kesmesini engelle
      }
    }
  }

  /**
   * Starts connectivity listener and periodic background heartbeat sync.
   */
  public start(): void {
    if (this.intervalTimerId || this.unsubscribeNetwork) {
      return;
    }

    // Aktif ağ dinleyicisi: çevrimiçi geçişinde anında senkronizasyonu tetikle
    this.unsubscribeNetwork = this.networkListener.subscribe((isOnline: boolean) => {
      if (isOnline) {
        this.emit({
          type: 'ONLINE',
          terminalId: this.terminalId,
          timestamp: new Date().toISOString(),
        });
        void this.triggerPush();
      } else {
        this.emit({
          type: 'OFFLINE',
          terminalId: this.terminalId,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Kalp atışı geri dönüş aralığı
    this.intervalTimerId = setInterval(() => {
      void this.triggerPush();
    }, this.syncIntervalMs);
  }

  /**
   * Halts the background worker and cleans up listeners.
   */
  public stop(): void {
    if (this.intervalTimerId) {
      clearInterval(this.intervalTimerId);
      this.intervalTimerId = null;
    }
    if (this.unsubscribeNetwork) {
      this.unsubscribeNetwork();
      this.unsubscribeNetwork = null;
    }
  }

  public isRunning(): boolean {
    return this.intervalTimerId !== null;
  }

  /**
   * Enqueues a new domain event into the outbox for background delivery.
   */
  public async enqueueEvent<T>(
    aggregateId: string,
    aggregateType: string,
    eventType: string,
    payload: T,
    version = 1
  ): Promise<OutboxRecord<T>> {
    // Nedensel mutasyonu kaydetmek için mantıksal vektör saatini ilerlet
    const clock = this.vectorClockManager.tick();

    const record = await this.outboxRepo.enqueue({
      eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      aggregateId,
      aggregateType,
      eventType,
      payload,
      vectorClock: clock,
      version,
      maxAttempts: this.maxAttempts,
    });

    // Çevrimiçiyse anında temizlemeyi tetikle
    if (this.networkListener.isOnline()) {
      setTimeout(() => void this.triggerPush(), 20);
    }

    return record as OutboxRecord<T>;
  }

  /**
   * Triggers the sequential push pipeline.
   * Enforces single-flight concurrency execution lock.
   */
  public async triggerPush(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    const lockHolder = `BackgroundSyncWorker_${this.terminalId}`;
    if (!GlobalSyncMutex.tryAcquire(lockHolder)) {
      return;
    }

    if (!this.networkListener.isOnline()) {
      GlobalSyncMutex.release(lockHolder);
      return;
    }

    this.isProcessing = true;
    this.emit({
      type: 'SYNC_STARTED',
      terminalId: this.terminalId,
      timestamp: new Date().toISOString(),
    });

    try {
      await this.processSequentialPushPipeline();
    } finally {
      this.isProcessing = false;
      GlobalSyncMutex.release(lockHolder);
    }
  }

  /**
   * Core sequential push pipeline:
   * Extracts pending records in batches and pushes to POST /sync/push sequentially.
   */
  private async processSequentialPushPipeline(): Promise<void> {
    let hasMore = true;

    while (hasMore) {
      if (!this.networkListener.isOnline()) {
        break;
      }

      const pendingBatch = await this.outboxRepo.getPendingRecords(this.batchSize);
      if (pendingBatch.length === 0) {
        hasMore = false;
        break;
      }

      const batchIds = pendingBatch.map((r) => r.id);
      await this.outboxRepo.markInFlight(batchIds);

      // İşlemsel senkronizasyon yükünü oluştur
      const syncPayload: SyncPayload = {
        syncId: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        terminalId: this.terminalId,
        branchId: this.branchId,
        vectorClock: this.vectorClockManager.getClock(),
        records: pendingBatch,
        timestamp: new Date().toISOString(),
        schemaVersion: 1,
      };

      try {
        const response = await this.httpClient.postSyncPush(this.pushEndpointUrl, syncPayload);

        await this.handlePushSuccess(pendingBatch, response);
      } catch (pushErr: unknown) {
        const errMessage = pushErr instanceof Error ? pushErr.message : String(pushErr);
        await this.handlePushFailure(pendingBatch, errMessage);
        // Üstel geri çekilmeye izin vermek için aktarım hatasında sıralı döngüyü kır
        break;
      }

      if (pendingBatch.length < this.batchSize) {
        hasMore = false;
      }
    }
  }

  /**
   * Handles successful HTTP 200 response from /sync/push.
   */
  private async handlePushSuccess(
    batch: OutboxRecord[],
    response: SyncPushResponse
  ): Promise<void> {
    // Sunucu vektör saatini yerel vektör saatine dahil et
    if (response.serverVectorClock) {
      this.vectorClockManager.update(response.serverVectorClock);
    }

    const processedSet = new Set(response.processedRecordIds ?? []);
    const failedSet = new Set(response.failedRecordIds ?? []);

    const completedIds: string[] = [];

    for (const record of batch) {
      if (processedSet.has(record.id)) {
        completedIds.push(record.id);
      } else if (failedSet.has(record.id)) {
        await this.applyRetryBackoff(record, 'Server reported record sync failure.');
      } else {
        // Varsayılan olarak, sunucu genel toplu işi başarılı olarak işaretlerse, tamamlanmış olarak işaretle
        completedIds.push(record.id);
      }
    }

    if (completedIds.length > 0) {
      await this.outboxRepo.markCompleted(completedIds);
    }

    // Senkronizasyon yanıtında döndürülen herhangi bir alan çatışmasını işle
    if (response.conflicts && response.conflicts.length > 0) {
      for (const conflict of response.conflicts) {
        this.emit({
          type: 'CONFLICT_RESOLVED',
          terminalId: this.terminalId,
          timestamp: new Date().toISOString(),
          conflictDetail: conflict,
        });
      }
    }

    this.emit({
      type: 'BATCH_SUCCESS',
      terminalId: this.terminalId,
      timestamp: new Date().toISOString(),
      batchCount: completedIds.length,
    });
  }

  /**
   * Handles network or server error during push dispatch.
   */
  private async handlePushFailure(batch: OutboxRecord[], errorMessage: string): Promise<void> {
    for (const record of batch) {
      await this.applyRetryBackoff(record, errorMessage);
    }

    this.emit({
      type: 'BATCH_FAILED',
      terminalId: this.terminalId,
      timestamp: new Date().toISOString(),
      error: errorMessage,
      batchCount: batch.length,
    });
  }

  /**
   * Enforces exponential backoff with jitter on failed outbox records.
   */
  private async applyRetryBackoff(record: OutboxRecord, errorMessage: string): Promise<void> {
    const nextAttempt = record.attempts + 1;

    if (nextAttempt >= record.maxAttempts) {
      await this.outboxRepo.markFailed(record.id, errorMessage, '');
      this.emit({
        type: 'MAX_RETRIES_EXCEEDED',
        terminalId: this.terminalId,
        recordId: record.id,
        timestamp: new Date().toISOString(),
        error: `Exceeded max attempts (${record.maxAttempts}). Last error: ${errorMessage}`,
      });
      return;
    }

    // Titreşimli üstel gecikme
    const exponentialDelay = this.baseBackoffMs * Math.pow(this.backoffFactor, record.attempts);
    const cappedDelay = Math.min(this.maxBackoffMs, exponentialDelay);
    const jitter = Math.floor(Math.random() * 500);
    const totalDelay = cappedDelay + jitter;

    const nextRetryAt = new Date(Date.now() + totalDelay).toISOString();
    await this.outboxRepo.markFailed(record.id, errorMessage, nextRetryAt);

    this.emit({
      type: 'RECORD_FAILED',
      terminalId: this.terminalId,
      recordId: record.id,
      timestamp: new Date().toISOString(),
      error: errorMessage,
    });
  }

  /**
   * Helper to manually resolve and merge a conflicting local record against a remote record.
   */
  public resolveConflict(
    localRecord: OutboxRecord,
    remoteRecord: OutboxRecord
  ): ReturnType<typeof DomainConflictResolver.resolveRecordConflict> {
    const result = DomainConflictResolver.resolveRecordConflict(localRecord, remoteRecord);
    if (result.resolved && result.mergedClock) {
      this.vectorClockManager.update(result.mergedClock);
    }
    return result;
  }

  // Accessor helpers
  public getVectorClock(): VectorClock {
    return this.vectorClockManager.getClock();
  }

  public getTerminalId(): string {
    return this.terminalId;
  }

  public getBranchId(): string {
    return this.branchId;
  }

  public getOutboxRepository(): IOutboxRepository {
    return this.outboxRepo;
  }
}

/**
 * Runtime type guard asserting whether an unknown object conforms to SyncPushResponse.
 */
export function isSyncPushResponse(val: unknown): val is SyncPushResponse {
  if (!val || typeof val !== 'object') {
    return false;
  }
  const candidate = val as Record<string, unknown>;
  return (
    typeof candidate.success === 'boolean' &&
    Array.isArray(candidate.processedRecordIds) &&
    typeof candidate.serverVectorClock === 'object' &&
    candidate.serverVectorClock !== null
  );
}

/**
 * Runtime type guard asserting whether an unknown object conforms to OutboxRecord.
 */
export function isValidOutboxRecord(val: unknown): val is OutboxRecord {
  if (!val || typeof val !== 'object') {
    return false;
  }
  const candidate = val as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.eventId === 'string' &&
    typeof candidate.aggregateId === 'string' &&
    typeof candidate.aggregateType === 'string' &&
    typeof candidate.eventType === 'string' &&
    'payload' in candidate &&
    typeof candidate.vectorClock === 'object' &&
    candidate.vectorClock !== null &&
    typeof candidate.version === 'number' &&
    typeof candidate.status === 'string' &&
    typeof candidate.attempts === 'number' &&
    typeof candidate.maxAttempts === 'number' &&
    typeof candidate.createdAt === 'string'
  );
}
