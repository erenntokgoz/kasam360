import {
  EDocumentPayload,
  EDocumentSendResult,
  EDocumentStatusResult,
  EDocumentType,
  IEInvoiceIntegrator,
} from '../ebilge/EInvoiceIntegrator.interface';
import { EInvoiceManager } from '../ebilge/EInvoiceManager';
import { GlobalSyncMutex } from './sync-mutex';

export type QueueItemStatus = 'PENDING' | 'IN_FLIGHT' | 'COMPLETED' | 'FAILED';

export interface OfflineQueueItem {
  id: string;
  documentUuid: string;
  documentType: EDocumentType;
  payload: EDocumentPayload;
  status: QueueItemStatus;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  createdAt: string;
  lastAttemptAt?: string;
  nextRetryAt: string;
  completedAt?: string;
  dispatchResult?: EDocumentSendResult;
}

export interface IQueueStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface INetworkMonitor {
  isOnline(): boolean;
  subscribe(listener: (isOnline: boolean) => void): () => void;
}

/**
 * Default persistent storage utilizing LocalStorage with in-memory fallback.
 */
export class LocalStorageQueueStorage implements IQueueStorage {
  private inMemoryFallback: Map<string, string> = new Map();

  public getItem(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {
      // Güvenlik/kota hatalarında bellek içi geri dönüş yap
    }
    return this.inMemoryFallback.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
        return;
      }
    } catch {
      // Bellek içi geri dönüş yap
    }
    this.inMemoryFallback.set(key, value);
  }

  public removeItem(key: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
        return;
      }
    } catch {
      // Bellek içi geri dönüş yap
    }
    this.inMemoryFallback.delete(key);
  }
}

/**
 * Default network monitor listening to browser/webview online events.
 */
export class BrowserNetworkMonitor implements INetworkMonitor {
  private manualOnlineOverride: boolean | null = null;

  public isOnline(): boolean {
    if (this.manualOnlineOverride !== null) {
      return this.manualOnlineOverride;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
    return true;
  }

  public setOnlineStatus(online: boolean): void {
    this.manualOnlineOverride = online;
  }

  public subscribe(listener: (isOnline: boolean) => void): () => void {
    if (typeof window === 'undefined') {
      return () => {};
    }

    const handleOnline = (): void => listener(true);
    const handleOffline = (): void => listener(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }
}

export interface OfflineSyncQueueConfig {
  integrator?: IEInvoiceIntegrator;
  storage?: IQueueStorage;
  networkMonitor?: INetworkMonitor;
  storageKey?: string;
  workerIntervalMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  autoStartWorker?: boolean;
}

export type QueueEventListener = (event: {
  type: 'QUEUED' | 'DISPATCHED' | 'FAILED' | 'STATUS_CHANGED';
  item: OfflineQueueItem;
  error?: string;
}) => void;

/**
 * Persistent Offline Queue Manager with Automatic Fallback & Background Worker.
 *
 * Resilience Mandate:
 * - Intercepts outbound e-document transmissions.
 * - If network connectivity drops or transmission fails, document is securely committed
 *   to local persistent offline storage.
 * - Background recovery worker continuously monitors network state and dispatches
 *   queued documents automatically upon connectivity restoration.
 */
export class OfflineSyncQueue implements IEInvoiceIntegrator {
  private static instance: OfflineSyncQueue | null = null;

  private readonly storage: IQueueStorage;
  private readonly networkMonitor: INetworkMonitor;
  private readonly storageKey: string;
  private readonly workerIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  private integrator: IEInvoiceIntegrator;
  private workerTimerId: ReturnType<typeof setInterval> | null = null;
  private unsubscribeNetwork: (() => void) | null = null;
  private isProcessing = false;
  private listeners: Set<QueueEventListener> = new Set();

  public constructor(config?: OfflineSyncQueueConfig) {
    this.integrator = config?.integrator ?? EInvoiceManager.getInstance();
    this.storage = config?.storage ?? new LocalStorageQueueStorage();
    this.networkMonitor = config?.networkMonitor ?? new BrowserNetworkMonitor();
    this.storageKey = config?.storageKey ?? 'kasam360_offline_edoc_queue_v1';
    this.workerIntervalMs = config?.workerIntervalMs ?? 5000;
    this.maxAttempts = config?.maxAttempts ?? 5;
    this.baseBackoffMs = config?.baseBackoffMs ?? 2000;
    this.maxBackoffMs = config?.maxBackoffMs ?? 60000;

    if (config?.autoStartWorker !== false) {
      this.startWorker();
    }
  }

  public static getInstance(config?: OfflineSyncQueueConfig): OfflineSyncQueue {
    if (!OfflineSyncQueue.instance) {
      OfflineSyncQueue.instance = new OfflineSyncQueue(config);
    }
    return OfflineSyncQueue.instance;
  }

  public static resetInstance(): void {
    if (OfflineSyncQueue.instance) {
      OfflineSyncQueue.instance.stopWorker();
      OfflineSyncQueue.instance = null;
    }
  }

  public get providerId(): string {
    return `RESILIENT_QUEUE_${this.integrator.providerId}`;
  }

  public get providerName(): string {
    return `Resilient Offline Queue (${this.integrator.providerName})`;
  }

  /**
   * Updates underlying target integrator.
   */
  public setIntegrator(integrator: IEInvoiceIntegrator): void {
    this.integrator = integrator;
  }

  public getIntegrator(): IEInvoiceIntegrator {
    return this.integrator;
  }

  /**
   * Registers an event listener for queue activity.
   */
  public addListener(listener: QueueEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(
    type: 'QUEUED' | 'DISPATCHED' | 'FAILED' | 'STATUS_CHANGED',
    item: OfflineQueueItem,
    error?: string
  ): void {
    for (const listener of this.listeners) {
      try {
        listener({ type, item, error });
      } catch {
        // Dinleyici istisnalarının kuyruk akışını bozmasını engelle
      }
    }
  }

  // ==========================================
  // E-Document Integrator Contract Implementation
  // ==========================================

  /**
   * Sends an e-Archive Invoice with automatic offline fallback.
   */
  public async sendEArchiveInvoice(document: EDocumentPayload): Promise<EDocumentSendResult> {
    return this.dispatchWithFallback(document, 'E_ARCHIVE');
  }

  /**
   * Sends an e-Invoice with automatic offline fallback.
   */
  public async sendEInvoice(document: EDocumentPayload): Promise<EDocumentSendResult> {
    return this.dispatchWithFallback(document, 'E_INVOICE');
  }

  /**
   * Checks status of document, inspecting both offline queue and remote integrator.
   */
  public async checkDocumentStatus(documentUuid: string): Promise<EDocumentStatusResult> {
    const queue = await this.readQueue();
    const queuedItem = queue.find((item) => item.documentUuid === documentUuid);

    if (queuedItem) {
      if (queuedItem.status === 'PENDING') {
        return {
          uuid: documentUuid,
          documentNumber: queuedItem.payload.invoiceNumber,
          status: 'QUEUED',
          statusCode: 'OFFLINE_PENDING',
          statusDescription: `Belge çevrimdışı kuyrukta bekliyor. Deneme: ${queuedItem.attempts}/${queuedItem.maxAttempts}.`,
          checkedAt: new Date().toISOString(),
          isFinal: false,
        };
      }
      if (queuedItem.status === 'IN_FLIGHT') {
        return {
          uuid: documentUuid,
          documentNumber: queuedItem.payload.invoiceNumber,
          status: 'PROCESSING',
          statusCode: 'OFFLINE_IN_FLIGHT',
          statusDescription: 'Belge şu anda entegratöre aktarılıyor.',
          checkedAt: new Date().toISOString(),
          isFinal: false,
        };
      }
      if (queuedItem.status === 'FAILED') {
        return {
          uuid: documentUuid,
          documentNumber: queuedItem.payload.invoiceNumber,
          status: 'FAILED',
          statusCode: 'OFFLINE_MAX_RETRIES_EXCEEDED',
          statusDescription: `Belge aktarımı deneme sınırına ulaştı (${queuedItem.lastError ?? 'Bilinmeyen hata'}).`,
          checkedAt: new Date().toISOString(),
          isFinal: false,
        };
      }
      if (queuedItem.status === 'COMPLETED' && queuedItem.dispatchResult) {
        return {
          uuid: documentUuid,
          documentNumber: queuedItem.dispatchResult.documentNumber,
          status: 'APPROVED',
          statusCode: queuedItem.dispatchResult.gibStatusCode ?? '1000',
          statusDescription:
            queuedItem.dispatchResult.gibStatusDescription ?? 'Başarıyla aktarıldı.',
          checkedAt: new Date().toISOString(),
          isFinal: true,
        };
      }
    }

    // Kuyrukta beklemiyor; doğrudan üst entegratörü sorgula
    return this.integrator.checkDocumentStatus(documentUuid);
  }

  // ==========================================
  // Resilient Fallback Logic
  // ==========================================

  private async dispatchWithFallback(
    payload: EDocumentPayload,
    documentType: EDocumentType
  ): Promise<EDocumentSendResult> {
    const isNetworkAvailable = this.networkMonitor.isOnline();

    if (isNetworkAvailable) {
      try {
        const result =
          documentType === 'E_ARCHIVE'
            ? await this.integrator.sendEArchiveInvoice(payload)
            : await this.integrator.sendEInvoice(payload);

        return result;
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        // Otomatik geri dönüş: iletim sırasında ağ kesintisi veya ağ geçidi istisnası yakalandı
        return this.enqueueDocument(payload, documentType, errorMessage);
      }
    }

    // Ağ çevrimdışı: işlemi başarısız yapmadan doğrudan kalıcı kuyruğa kaydet
    return this.enqueueDocument(
      payload,
      documentType,
      'Ağ bağlantısı kapalı: Belge çevrimdışı kuyruğa alındı.'
    );
  }

  /**
   * Securely commits document to local persistent offline queue.
   */
  public async enqueueDocument(
    payload: EDocumentPayload,
    documentType: EDocumentType,
    initialError?: string
  ): Promise<EDocumentSendResult> {
    const queue = await this.readQueue();
    const existingIndex = queue.findIndex((item) => item.documentUuid === payload.uuid);

    const now = new Date().toISOString();
    const queueItemId = `Q_${Date.now()}_${payload.uuid.slice(0, 8)}`;

    const newItem: OfflineQueueItem = {
      id: queueItemId,
      documentUuid: payload.uuid,
      documentType,
      payload,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: this.maxAttempts,
      lastError: initialError,
      createdAt: now,
      nextRetryAt: now,
    };

    if (existingIndex >= 0) {
      queue[existingIndex] = newItem;
    } else {
      queue.push(newItem);
    }

    await this.writeQueue(queue);
    this.notifyListeners('QUEUED', newItem, initialError);

    // Anında arka plan kurtarma değerlendirmesini tetikle
    this.triggerImmediateFlush();

    const fallbackDocNo = payload.invoiceNumber ?? `OFFLINE-${payload.uuid.slice(0, 8)}`;
    return {
      success: true,
      isQueuedOffline: true,
      uuid: payload.uuid,
      documentNumber: fallbackDocNo,
      gibStatusCode: 'OFFLINE_QUEUED',
      gibStatusDescription: `Belge yerel çevrimdışı kuyruğa alındı. ${initialError ?? ''}`,
      deliveredAt: now,
    };
  }

  // ==========================================
  // Recovery Background Worker
  // ==========================================

  /**
   * Starts the background recovery worker and network state monitors.
   */
  public startWorker(): void {
    if (this.workerTimerId) {
      return;
    }

    // Bağlantı geçişlerini izle
    this.unsubscribeNetwork = this.networkMonitor.subscribe((isOnline: boolean) => {
      if (isOnline) {
        this.triggerImmediateFlush();
      }
    });

    // Periyodik çalışan döngüsü
    this.workerTimerId = setInterval(() => {
      void this.flushQueue();
    }, this.workerIntervalMs);
  }

  /**
   * Stops the background worker and cleans up listeners.
   */
  public stopWorker(): void {
    if (this.workerTimerId) {
      clearInterval(this.workerTimerId);
      this.workerTimerId = null;
    }
    if (this.unsubscribeNetwork) {
      this.unsubscribeNetwork();
      this.unsubscribeNetwork = null;
    }
  }

  public isWorkerRunning(): boolean {
    return this.workerTimerId !== null;
  }

  /**
   * Triggers immediate queue dispatch outside interval ticks.
   */
  public triggerImmediateFlush(): void {
    setTimeout(() => {
      void this.flushQueue();
    }, 50);
  }

  /**
   * Processes pending items in the offline queue when online.
   */
  public async flushQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    if (!GlobalSyncMutex.tryAcquire('OfflineSyncQueue')) {
      return;
    }

    if (!this.networkMonitor.isOnline()) {
      GlobalSyncMutex.release('OfflineSyncQueue');
      return;
    }

    this.isProcessing = true;

    try {
      const queue = await this.readQueue();
      const now = Date.now();

      // Geri çekilme süresi dolmuş bekleyen öğeleri bul, FIFO olarak sıralı
      const eligibleItems = queue
        .filter((item) => item.status === 'PENDING' && new Date(item.nextRetryAt).getTime() <= now)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      if (eligibleItems.length === 0) {
        return;
      }

      for (const item of eligibleItems) {
        // Her iletimden önce bağlantıyı tekrar kontrol et
        if (!this.networkMonitor.isOnline()) {
          break;
        }

        item.status = 'IN_FLIGHT';
        item.lastAttemptAt = new Date().toISOString();
        item.attempts += 1;
        await this.writeQueue(queue);

        try {
          const sendResult =
            item.documentType === 'E_ARCHIVE'
              ? await this.integrator.sendEArchiveInvoice(item.payload)
              : await this.integrator.sendEInvoice(item.payload);

          item.status = 'COMPLETED';
          item.completedAt = new Date().toISOString();
          item.dispatchResult = sendResult;
          await this.writeQueue(queue);

          this.notifyListeners('DISPATCHED', item);
        } catch (dispatchErr: unknown) {
          const errString =
            dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr);
          item.lastError = errString;

          if (item.attempts >= item.maxAttempts) {
            item.status = 'FAILED';
            this.notifyListeners('FAILED', item, errString);
          } else {
            // Üstel geri çekilme
            const delay = Math.min(
              this.maxBackoffMs,
              this.baseBackoffMs * Math.pow(2, item.attempts - 1)
            );
            item.status = 'PENDING';
            item.nextRetryAt = new Date(Date.now() + delay).toISOString();
            this.notifyListeners('STATUS_CHANGED', item, errString);
          }

          await this.writeQueue(queue);
        }
      }
    } finally {
      this.isProcessing = false;
      GlobalSyncMutex.release('OfflineSyncQueue');
    }
  }

  // ==========================================
  // Queue Inspection & Management
  // ==========================================

  public async getQueue(): Promise<OfflineQueueItem[]> {
    return this.readQueue();
  }

  public async getPendingCount(): Promise<number> {
    const queue = await this.readQueue();
    return queue.filter((item) => item.status === 'PENDING' || item.status === 'IN_FLIGHT').length;
  }

  public async retryFailedItem(documentUuid: string): Promise<boolean> {
    const queue = await this.readQueue();
    const item = queue.find((q) => q.documentUuid === documentUuid);
    if (!item) {
      return false;
    }
    item.status = 'PENDING';
    item.attempts = 0;
    item.nextRetryAt = new Date().toISOString();
    await this.writeQueue(queue);
    this.triggerImmediateFlush();
    return true;
  }

  public async clearCompleted(): Promise<void> {
    const queue = await this.readQueue();
    const activeItems = queue.filter((item) => item.status !== 'COMPLETED');
    await this.writeQueue(activeItems);
  }

  public async purgeQueue(): Promise<void> {
    await this.writeQueue([]);
  }

  // ==========================================
  // Persistent Storage Helpers
  // ==========================================

  private async readQueue(): Promise<OfflineQueueItem[]> {
    try {
      const raw = await this.storage.getItem(this.storageKey);
      if (!raw) {
        return [];
      }
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(isOfflineQueueItem);
      }
      return [];
    } catch {
      return [];
    }
  }

  private async writeQueue(queue: OfflineQueueItem[]): Promise<void> {
    try {
      await this.storage.setItem(this.storageKey, JSON.stringify(queue));
    } catch {
      // Depolama kotası veya serileştirme korumaları
    }
  }
}

/**
 * Runtime type guard asserting whether an unknown object conforms to OfflineQueueItem.
 */
export function isOfflineQueueItem(val: unknown): val is OfflineQueueItem {
  if (!val || typeof val !== 'object') {
    return false;
  }
  const candidate = val as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.documentUuid === 'string' &&
    typeof candidate.documentType === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.attempts === 'number' &&
    typeof candidate.maxAttempts === 'number' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.nextRetryAt === 'string' &&
    typeof candidate.payload === 'object' &&
    candidate.payload !== null
  );
}
