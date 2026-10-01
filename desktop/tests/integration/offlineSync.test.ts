/**
 * Kasam360 - Offline-to-Online Outbox Queue Synchronization Test Suite
 * Path: tests/integration/offlineSync.test.ts
 */


import {
  BackgroundSyncWorker,
  RealtimeNetworkListener,
} from '../../src/data/sync/BackgroundSyncWorker';
import { DomainConflictResolver } from '../../src/data/sync/DomainConflictResolver';
import {
  IOutboxRepository,
  ISyncHttpClient,
  OrderSyncPayload,
  OutboxRecord,
  SyncPayload,
  SyncPushResponse,
} from '../../src/data/sync/types';
import { VectorClockManager } from '../../src/data/sync/VectorClockManager';
import {
  BrowserNetworkMonitor,
  LocalStorageQueueStorage,
  OfflineSyncQueue,
  isOfflineQueueItem,
} from '../../src/data/queue/OfflineSyncQueue';
import { GlobalSyncMutex } from '../../src/data/queue/sync-mutex';
import {
  isOrderSyncPayload,
  isInventoryDeltaPayload,
} from '../../src/data/sync/DomainConflictResolver';
import {
  isSyncPushResponse,
  isValidOutboxRecord,
} from '../../src/data/sync/BackgroundSyncWorker';
import {
  calculateSha256,
  canonicalJsonStringify,
} from '../../src/domain/entities/ledger/HashChainBuilder';
import {
  EDocumentPayload,
  EDocumentSendResult,
  EDocumentStatusResult,
  IEInvoiceIntegrator,
} from '../../src/data/ebilge/EInvoiceIntegrator.interface';
import { MockSqliteWalDatabase } from '../fixtures/eventStream.fixture';

// =========================================================================
// Mocks & Test Doubles
// =========================================================================

class MockSyncHttpClient implements ISyncHttpClient {
  public dispatchedPayloads: SyncPayload[] = [];
  public shouldFail = false;
  public failureStatusCode = 503;
  public failureMessage = 'Service Unavailable';

  public async postSyncPush(_url: string, payload: SyncPayload): Promise<SyncPushResponse> {
    if (this.shouldFail) {
      throw new Error(`Sync Push HTTP ${this.failureStatusCode}: ${this.failureMessage}`);
    }

    this.dispatchedPayloads.push(JSON.parse(JSON.stringify(payload)));

    const processedIds = payload.records.map((r) => r.id);
    const serverClock = {
      ...payload.vectorClock,
      'cloud-central': (payload.vectorClock['cloud-central'] ?? 0) + 1,
    };

    return {
      success: true,
      processedRecordIds: processedIds,
      serverVectorClock: serverClock,
      message: `Successfully synchronized ${processedIds.length} records.`,
    };
  }

  public reset(): void {
    this.dispatchedPayloads = [];
    this.shouldFail = false;
  }
}

class MockEInvoiceIntegrator implements IEInvoiceIntegrator {
  public readonly providerId = 'MOCK_EBILGE';
  public readonly providerName = 'Mock e-Bilge Provider';
  public sentInvoices: EDocumentPayload[] = [];
  public shouldFail = false;

  public async sendEArchiveInvoice(doc: EDocumentPayload): Promise<EDocumentSendResult> {
    if (this.shouldFail) {
      throw new Error('GIB Gateway Connection Timeout');
    }
    this.sentInvoices.push(doc);
    return {
      success: true,
      uuid: doc.uuid,
      documentNumber: doc.invoiceNumber ?? 'EAR2026000000001',
      gibStatusCode: '1000',
      gibStatusDescription: 'İşlem Başarılı',
      deliveredAt: new Date().toISOString(),
    };
  }

  public async sendEInvoice(doc: EDocumentPayload): Promise<EDocumentSendResult> {
    if (this.shouldFail) {
      throw new Error('GIB Gateway Connection Timeout');
    }
    this.sentInvoices.push(doc);
    return {
      success: true,
      uuid: doc.uuid,
      documentNumber: doc.invoiceNumber ?? 'GIB2026000000001',
      gibStatusCode: '1000',
      gibStatusDescription: 'İşlem Başarılı',
      deliveredAt: new Date().toISOString(),
    };
  }

  public async checkDocumentStatus(documentUuid: string): Promise<EDocumentStatusResult> {
    return {
      uuid: documentUuid,
      status: 'APPROVED',
      statusCode: '1000',
      statusDescription: 'Onaylandı',
      checkedAt: new Date().toISOString(),
      isFinal: true,
    };
  }
}

/**
 * SQLite WAL backed outbox repository implementing IOutboxRepository
 * directly connected to our MockSqliteWalDatabase.
 */
class SqliteWalOutboxRepository implements IOutboxRepository {
  private readonly db: MockSqliteWalDatabase;

  constructor(db: MockSqliteWalDatabase) {
    this.db = db;
  }

  public async getPendingRecords(limit: number): Promise<OutboxRecord[]> {
    return this.db.getPendingOutbox(limit);
  }

  public async markInFlight(recordIds: string[]): Promise<void> {
    for (const id of recordIds) {
      await this.db.updateOutboxStatus(id, 'IN_FLIGHT');
    }
  }

  public async markCompleted(recordIds: string[]): Promise<void> {
    for (const id of recordIds) {
      await this.db.updateOutboxStatus(id, 'COMPLETED');
    }
  }

  public async markFailed(recordId: string, error: string, nextRetryAt: string): Promise<void> {
    const rec = await this.db.getOutboxById(recordId);
    const nextAttempts = (rec?.attempts ?? 0) + 1;
    const maxAttempts = rec?.maxAttempts ?? 5;
    const status = nextAttempts >= maxAttempts ? 'FAILED' : 'PENDING';
    await this.db.updateOutboxStatus(recordId, status, error, nextRetryAt, true);
  }

  public async markConflict(recordId: string, error: string): Promise<void> {
    await this.db.updateOutboxStatus(recordId, 'CONFLICT', error);
  }

  public async enqueue(
    recordData: Omit<OutboxRecord, 'id' | 'status' | 'attempts' | 'createdAt'>
  ): Promise<OutboxRecord> {
    const id = `outbox_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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

    // First insert matching event to satisfy foreign key in SQLite WAL
    await this.db.insertEvent({
      eventId: record.eventId,
      aggregateId: record.aggregateId,
      aggregateType: record.aggregateType,
      eventType: record.eventType,
      payload: record.payload as Record<string, unknown>,
      version: record.version,
      timestamp: now,
    });

    // Insert into outbox table
    await this.db.insertOutbox(record);
    return record;
  }

  public async getRecordById(id: string): Promise<OutboxRecord | null> {
    return this.db.getOutboxById(id);
  }

  public async getAllRecords(): Promise<OutboxRecord[]> {
    return this.db.getAllOutbox();
  }
}

// =========================================================================
// Main Test Suite
// =========================================================================

describe('OfflineSync & Outbox Simulation Test Suite', () => {
  let networkListener: RealtimeNetworkListener;
  let mockHttpClient: MockSyncHttpClient;
  let walDb: MockSqliteWalDatabase;
  let outboxRepo: SqliteWalOutboxRepository;
  let worker: BackgroundSyncWorker;

  const TERMINAL_ID = 'pos_term_01';
  const BRANCH_ID = 'branch_istanbul_kadikoy';

  beforeEach(() => {
    networkListener = new RealtimeNetworkListener();
    mockHttpClient = new MockSyncHttpClient();
    walDb = new MockSqliteWalDatabase();
    outboxRepo = new SqliteWalOutboxRepository(walDb);

    worker = new BackgroundSyncWorker({
      terminalId: TERMINAL_ID,
      branchId: BRANCH_ID,
      pushEndpointUrl: 'https://api.kasam360.internal/sync/push',
      batchSize: 10,
      syncIntervalMs: 1000,
      baseBackoffMs: 100,
      maxBackoffMs: 1000,
      networkListener,
      outboxRepository: outboxRepo,
      httpClient: mockHttpClient,
      autoStart: false, // Control trigger manually in tests
    });
  });

  // =========================================================================
  // 1. Network Disconnection Simulation & Outbox Accumulation
  // =========================================================================
  describe('Network Disconnection Simulation', () => {
    it('programmatically isolates network and commits transactions strictly to local WAL outbox queue', async () => {
      // 1. Simulate complete network cutoff
      networkListener.setOnline(false);
      expect(networkListener.isOnline()).toBe(false);

      // 2. Write 5 operational transactions during network outage
      const record1 = await worker.enqueueEvent('ord_101', 'ORDER', 'ORDER_CREATED', {
        orderId: 'ord_101',
        total: 45.0,
      });
      const record2 = await worker.enqueueEvent('ord_101', 'KDS_TICKET', 'STATION_ROUTED', {
        stations: ['Grill', 'Bar'],
      });
      const record3 = await worker.enqueueEvent('inv_001', 'INVENTORY', 'FIFO_DEDUCTION', {
        cogs: 18.5,
      });
      const record4 = await worker.enqueueEvent('inv_002', 'INVOICE', 'E_INVOICE_GENERATED', {
        uuid: 'inv-uuid-001',
      });
      const record5 = await worker.enqueueEvent('ord_101', 'PAYMENT', 'PAYMENT_SETTLED', {
        amount: 45.0,
        type: 'CREDIT_CARD',
      });

      // 3. Trigger push attempts while offline
      await worker.triggerPush();

      // 4. Assert zero network traffic dispatched during disconnection
      expect(mockHttpClient.dispatchedPayloads).toHaveLength(0);

      // 5. Assert all records reside in local WAL outbox queue with status PENDING
      const pending = await outboxRepo.getPendingRecords(50);
      expect(pending).toHaveLength(5);
      expect(pending.map((p) => p.id)).toEqual([
        record1.id,
        record2.id,
        record3.id,
        record4.id,
        record5.id,
      ]);

      for (const item of pending) {
        expect(item.status).toBe('PENDING');
        expect(item.attempts).toBe(0);
        expect(item.vectorClock[TERMINAL_ID]).toBeGreaterThan(0);
      }

      // 6. Verify SQLite WAL Write-Ahead-Log recorded all inserts
      expect(walDb.getJournalMode()).toBe('WAL');
      const walEntries = walDb.getWalLog();
      expect(walEntries.length).toBeGreaterThanOrEqual(10); // 5 events + 5 outbox rows
    });
  });

  // =========================================================================
  // 2. Reconnection Verification & Sequential Outbox Flush
  // =========================================================================
  describe('Reconnection & Sequential Reconciled Flush', () => {
    it('restores simulated network connectivity and synchronizes all records sequentially with zero data loss', async () => {
      // 1. Enqueue while offline
      networkListener.setOnline(false);

      const records: OutboxRecord[] = [];
      for (let i = 1; i <= 4; i++) {
        const rec = await worker.enqueueEvent(
          `agg_${i}`,
          'ORDER',
          'ORDER_CREATED',
          { index: i, note: `Tx #${i}` },
          i
        );
        records.push(rec);
      }

      expect(await outboxRepo.getPendingRecords(10)).toHaveLength(4);

      // 2. Restore simulated network connectivity
      networkListener.setOnline(true);
      expect(networkListener.isOnline()).toBe(true);

      // 3. Trigger sequential push pipeline
      await worker.triggerPush();

      // 4. Assert HTTP endpoint received the exact sequential batch
      expect(mockHttpClient.dispatchedPayloads).toHaveLength(1);
      const dispatched = mockHttpClient.dispatchedPayloads[0];

      expect(dispatched.terminalId).toBe(TERMINAL_ID);
      expect(dispatched.branchId).toBe(BRANCH_ID);
      expect(dispatched.records).toHaveLength(4);

      // Assert chronological ordering preserved in dispatched payload
      for (let i = 0; i < 4; i++) {
        expect(dispatched.records[i].id).toBe(records[i].id);
        expect((dispatched.records[i].payload as { index: number }).index).toBe(i + 1);
      }

      // 5. Assert outbox records in local database transitioned to COMPLETED with zero data loss
      const remainingPending = await outboxRepo.getPendingRecords(10);
      expect(remainingPending).toHaveLength(0);

      const allRecords = await outboxRepo.getAllRecords();
      expect(allRecords).toHaveLength(4);
      for (const rec of allRecords) {
        expect(rec.status).toBe('COMPLETED');
      }

      // 6. Assert server vector clock was incorporated into local terminal's clock without artificial tick
      const updatedClock = worker.getVectorClock();
      expect(updatedClock['cloud-central']).toBe(1);
      expect(updatedClock[TERMINAL_ID]).toBe(4);
    });
  });

  // =========================================================================
  // 3. Transient Failure & Exponential Backoff Handling
  // =========================================================================
  describe('Transient Network Failures & Retry Backoff', () => {
    it('enforces exponential backoff without corrupting the queue during remote transport failures', async () => {
      networkListener.setOnline(true);
      mockHttpClient.shouldFail = true; // Remote 503 error

      const record = await worker.enqueueEvent('ord_err_1', 'ORDER', 'ORDER_CREATED', {
        item: 'Cheeseburger',
      });

      // Attempt push while remote is failing
      await worker.triggerPush();

      // Assert record was NOT completed and remains tracked
      const allRecords = await outboxRepo.getAllRecords();
      const erroredRecord = allRecords.find((r) => r.id === record.id);

      expect(erroredRecord).toBeDefined();
      expect(erroredRecord?.attempts).toBe(1);
      expect(erroredRecord?.lastError).toContain('HTTP 503');

      // Now heal the network / remote service
      mockHttpClient.shouldFail = false;

      // Force retry eligibility by advancing time in mock database
      const past = new Date(Date.now() - 1000).toISOString();
      await walDb.updateOutboxStatus(record.id, 'PENDING', undefined, past);

      // Push succeeds
      await worker.triggerPush();

      const finalRecord = (await outboxRepo.getAllRecords()).find((r) => r.id === record.id);
      expect(finalRecord?.status).toBe('COMPLETED');
    });
  });

  // =========================================================================
  // 4. Vector Clock & Domain Conflict Resolution
  // =========================================================================
  describe('Vector Clock Tracking & Conflict Resolution', () => {
    it('detects concurrent line-item mutations across distributed terminals and resolves deterministically', () => {
      const clockA = new VectorClockManager('terminal-A');
      const clockB = new VectorClockManager('terminal-B');

      // Terminal A and B mutate concurrently without exchanging sync messages
      clockA.tick(); // A: { terminal-A: 1 }
      clockB.tick(); // B: { terminal-B: 1 }

      const relation = VectorClockManager.compare(clockA.getClock(), clockB.getClock());
      expect(relation).toBe('CONCURRENT');

      // Simulate concurrent Order updates
      const localOrder: OrderSyncPayload = {
        id: 'ord_conflict_01',
        branchId: BRANCH_ID,
        terminalId: 'terminal-A',
        orderNumber: 'ORD-500',
        status: 'OPEN',
        items: [
          {
            id: 'item_1',
            productId: 'prod_burger',
            name: 'Classic Burger',
            quantity: 2,
            unitPrice: 10,
            totalPrice: 20,
            taxRate: 10,
            status: 'ACTIVE',
            updatedAt: '2026-09-05T12:00:00Z',
          },
        ],
        subtotal: 20,
        taxTotal: 2,
        discountTotal: 0,
        grandTotal: 22,
        vectorClock: clockA.getClock(),
        createdAt: '2026-09-05T12:00:00Z',
        updatedAt: '2026-09-05T12:01:00Z',
      };

      const remoteOrder: OrderSyncPayload = {
        id: 'ord_conflict_01',
        branchId: BRANCH_ID,
        terminalId: 'terminal-B',
        orderNumber: 'ORD-500',
        status: 'OPEN',
        items: [
          {
            id: 'item_2',
            productId: 'prod_beer',
            name: 'Craft Beer',
            quantity: 1,
            unitPrice: 5,
            totalPrice: 5,
            taxRate: 20,
            status: 'ACTIVE',
            updatedAt: '2026-09-05T12:00:30Z',
          },
        ],
        subtotal: 5,
        taxTotal: 1,
        discountTotal: 0,
        grandTotal: 6,
        vectorClock: clockB.getClock(),
        createdAt: '2026-09-05T12:00:00Z',
        updatedAt: '2026-09-05T12:01:30Z',
      };

      const resolution = DomainConflictResolver.resolveOrderConflict(localOrder, remoteOrder);

      expect(resolution.resolved).toBe(true);
      expect(resolution.strategy).toBe('LINE_LEVEL_MERGE');
      expect(resolution.mergedPayload).toBeDefined();

      // Merged payload must combine distinct line items from both terminals
      expect(resolution.mergedPayload?.items).toHaveLength(2);
      expect(resolution.mergedPayload?.grandTotal).toBe(28); // 22 + 6 = 28

      // Merged vector clock must dominate both clocks
      expect(resolution.mergedClock['terminal-A']).toBe(1);
      expect(resolution.mergedClock['terminal-B']).toBe(1);
    });
  });

  // =========================================================================
  // 5. Offline Resilient E-Document Queue (OfflineSyncQueue)
  // =========================================================================
  describe('Resilient E-Document Offline Fallback Queue', () => {
    it('queues e-invoices during network isolation and dispatches them upon restoration', async () => {
      const mockIntegrator = new MockEInvoiceIntegrator();
      const mockStorage = new LocalStorageQueueStorage();
      const networkMonitor = new BrowserNetworkMonitor();

      // Disconnect
      networkMonitor.setOnlineStatus(false);

      const queue = new OfflineSyncQueue({
        integrator: mockIntegrator,
        storage: mockStorage,
        networkMonitor,
        autoStartWorker: false,
        maxAttempts: 3,
      });

      const invoicePayload: EDocumentPayload = {
        uuid: 'inv-offline-001',
        invoiceNumber: 'EAR2026000000099',
        issueDate: '2026-09-05',
        issueTime: '12:00:00',
        documentType: 'E_ARCHIVE',
        profile: 'EARSIVFATURA',
        currency: 'TRY',
        customer: {
          taxOrIdNumber: '1234567890',
          title: 'Acme Dining Corp',
        },
        items: [
          {
            lineId: 'line-1',
            name: 'Fine Dining Dinner',
            quantity: 1,
            unit: 'C62',
            unitPrice: 150.0,
            vatRate: 20,
            vatAmount: 30.0,
            totalAmount: 180.0,
          },
        ],
        subTotal: 150.0,
        totalVat: 30.0,
        totalDiscount: 0,
        grandTotal: 180.0,
      };

      // Send e-Archive invoice while offline
      const dispatchResult = await queue.sendEArchiveInvoice(invoicePayload);

      expect(dispatchResult.success).toBe(true);
      expect(dispatchResult.isQueuedOffline).toBe(true);
      expect(dispatchResult.gibStatusCode).toBe('OFFLINE_QUEUED');

      // Assert zero direct transmissions to remote integrator
      expect(mockIntegrator.sentInvoices).toHaveLength(0);

      // Verify status shows OFFLINE_PENDING
      const statusOffline = await queue.checkDocumentStatus('inv-offline-001');
      expect(statusOffline.status).toBe('QUEUED');
      expect(statusOffline.statusCode).toBe('OFFLINE_PENDING');

      // Reconnect network and flush queue
      networkMonitor.setOnlineStatus(true);
      await queue.flushQueue();

      // Assert remote integrator received the invoice
      expect(mockIntegrator.sentInvoices).toHaveLength(1);
      expect(mockIntegrator.sentInvoices[0].uuid).toBe('inv-offline-001');

      // Verify status now shows APPROVED / Completed
      const statusOnline = await queue.checkDocumentStatus('inv-offline-001');
      expect(statusOnline.status).toBe('APPROVED');
      expect(statusOnline.statusCode).toBe('1000');
    });
  });

  // =========================================================================
  // 6. Poison Event / DLQ Hardening
  // =========================================================================
  describe('Poison Event & DLQ Recovery Hardening', () => {
    it('prevents infinite retry loop for poison pill events, isolating them in persistent DLQ state', async () => {
      // 1. Enqueue a "poison" event
      networkListener.setOnline(true);
      mockHttpClient.shouldFail = true; // Simulating permanent rejection
      mockHttpClient.failureStatusCode = 400; // Bad request
      mockHttpClient.failureMessage = 'Validation Failed: Poison Payload';

      const poisonRecord = await worker.enqueueEvent('poison_01', 'ORDER', 'ORDER_CREATED', {
        malformed: true,
      });

      // 2. Trigger push loop up to maxAttempts
      for (let i = 0; i < poisonRecord.maxAttempts + 1; i++) {
        // Fast forward the nextRetryAt by updating the DB manually to bypass backoff
        const currentRec = await outboxRepo.getRecordById(poisonRecord.id);
        if (currentRec && currentRec.status === 'PENDING') {
          await walDb.updateOutboxStatus(poisonRecord.id, 'PENDING', undefined, new Date(Date.now() - 1000).toISOString());
        }
        await worker.triggerPush();
      }

      // 3. Verify it is marked as FAILED and persisted, NOT endlessly retrying
      const finalRec = await outboxRepo.getRecordById(poisonRecord.id);
      expect(finalRec?.status).toBe('FAILED');
      expect(finalRec?.attempts).toBe(poisonRecord.maxAttempts);
      expect(finalRec?.lastError).toContain('Validation Failed: Poison Payload');

      // Verify it is no longer picked up by the pending query
      const pendingNow = await outboxRepo.getPendingRecords(10);
      expect(pendingNow).toHaveLength(0);

      // Verify DLQ recovery capability (admin manually fixes and resets to PENDING)
      mockHttpClient.shouldFail = false; // Fix remote issue
      await walDb.updateOutboxStatus(poisonRecord.id, 'PENDING', undefined, new Date(Date.now() - 1000).toISOString()); // Reset for DLQ recovery
      
      // Force reload/retry
      await worker.triggerPush();

      // Verify successful DLQ recovery
      const recoveredRec = await outboxRepo.getRecordById(poisonRecord.id);
      expect(recoveredRec?.status).toBe('COMPLETED');
    });
  });

  // =========================================================================
  // 7. Restart Recovery
  // =========================================================================
  describe('Restart Recovery & Persistence Validation', () => {
    it('survives process restart without losing pending offline transactions', async () => {
      // 1. Isolate network and create pending transactions
      networkListener.setOnline(false);
      const record = await worker.enqueueEvent('restart_test', 'ORDER', 'ORDER_PLACED', {
        total: 100,
      });

      // Assert it's pending in the first worker instance
      const pending = await outboxRepo.getPendingRecords(10);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(record.id);

      // 2. Simulate process crash / restart
      worker.stop();
      
      // Create fresh instances mimicking a cold boot
      const newWalDb = walDb; // Assuming the disk/DB persists
      const newOutboxRepo = new SqliteWalOutboxRepository(newWalDb);
      const newHttpClient = new MockSyncHttpClient();
      const newNetworkListener = new RealtimeNetworkListener();
      newNetworkListener.setOnline(true); // Restarted with network available

      const newWorker = new BackgroundSyncWorker({
        terminalId: TERMINAL_ID,
        branchId: BRANCH_ID,
        pushEndpointUrl: 'https://api.kasam360.internal/sync/push',
        networkListener: newNetworkListener,
        outboxRepository: newOutboxRepo,
        httpClient: newHttpClient,
        autoStart: false,
      });

      // 3. Assert the new repository instance loaded the pending record from storage
      const reloadedPending = await newOutboxRepo.getPendingRecords(10);
      expect(reloadedPending).toHaveLength(1);
      expect(reloadedPending[0].id).toBe(record.id);

      // 4. Trigger push on new worker
      await newWorker.triggerPush();

      // Verify successful recovery sync
      const finalRec = await newOutboxRepo.getRecordById(record.id);
      expect(finalRec?.status).toBe('COMPLETED');
      expect(newHttpClient.dispatchedPayloads).toHaveLength(1);
    });
  });

  // =========================================================================
  // 8. Idempotency & Duplicate Delivery Tolerance
  // =========================================================================
  describe('Idempotency & Duplicate Delivery Tolerance', () => {
    it('safely handles duplicate event deliveries by relying on canonical UUID tracking', async () => {
      networkListener.setOnline(true);
      const record = await worker.enqueueEvent('dup_test', 'ORDER', 'ORDER_UPDATED', { ok: true });

      // Override mock client to simulate server returning the record as already processed (duplicate)
      const originalPost = mockHttpClient.postSyncPush.bind(mockHttpClient);
      mockHttpClient.postSyncPush = async (_url: string, payload: SyncPayload) => {
        // Return success with the record ID to simulate idempotent processing on server
        return {
          success: true,
          processedRecordIds: payload.records.map(r => r.id),
          serverVectorClock: payload.vectorClock,
        };
      };

      await worker.triggerPush();
      const finalRec = await outboxRepo.getRecordById(record.id);
      expect(finalRec?.status).toBe('COMPLETED');
      
      // Restore mock
      mockHttpClient.postSyncPush = originalPost;
    });
  });

  // =========================================================================
  // 9. Remediation & Hardening Verification Suite
  // =========================================================================
  describe('Architectural Remediation Hardening Tests', () => {
    it('enforces GlobalSyncMutex mutual exclusion preventing concurrent worker execution', () => {
      GlobalSyncMutex.resetInstance();
      expect(GlobalSyncMutex.isLocked()).toBe(false);

      const acquired = GlobalSyncMutex.tryAcquire('OfflineSyncQueue');
      expect(acquired).toBe(true);
      expect(GlobalSyncMutex.isLocked()).toBe(true);
      expect(GlobalSyncMutex.getHolder()).toBe('OfflineSyncQueue');

      // Second acquire while held must fail
      const concurrentAcquire = GlobalSyncMutex.tryAcquire('BackgroundSyncWorker');
      expect(concurrentAcquire).toBe(false);

      // Foreign release attempt must not unlock
      GlobalSyncMutex.release('DifferentWorker');
      expect(GlobalSyncMutex.isLocked()).toBe(true);

      // Holder release succeeds
      GlobalSyncMutex.release('OfflineSyncQueue');
      expect(GlobalSyncMutex.isLocked()).toBe(false);

      // Mutex is now re-acquirable
      expect(GlobalSyncMutex.tryAcquire('BackgroundSyncWorker')).toBe(true);
      GlobalSyncMutex.release('BackgroundSyncWorker');
      expect(GlobalSyncMutex.isLocked()).toBe(false);
    });

    it('validates VectorClockManager.update merges clocks without artificial local tick advancement', () => {
      const vcm = new VectorClockManager('terminal-X', { 'terminal-X': 2, 'terminal-Y': 1 });
      const remoteClock = { 'terminal-X': 2, 'terminal-Y': 5, 'cloud': 3 };

      const updated = vcm.update(remoteClock);

      // local terminal-X counter must remain 2 (max(2, 2)), NOT 3
      expect(updated['terminal-X']).toBe(2);
      expect(updated['terminal-Y']).toBe(5);
      expect(updated['cloud']).toBe(3);
    });

    it('validates runtime shape guards accept valid payloads and reject corrupted shapes', () => {
      expect(isOrderSyncPayload({
        id: 'ord_1',
        branchId: 'b1',
        terminalId: 't1',
        orderNumber: 'ON-1',
        status: 'OPEN',
        items: [],
        subtotal: 10,
        taxTotal: 1,
        grandTotal: 11,
        createdAt: '2026-09-06T00:00:00Z',
        updatedAt: '2026-09-06T00:00:00Z',
      })).toBe(true);

      expect(isOrderSyncPayload({ invalid: true })).toBe(false);
      expect(isOrderSyncPayload(null)).toBe(false);

      expect(isInventoryDeltaPayload({
        productId: 'p1',
        branchId: 'b1',
        quantityDelta: -5,
        reason: 'Sale',
        referenceId: 'ref_1',
        timestamp: '2026-09-06T00:00:00Z',
      })).toBe(true);
      expect(isInventoryDeltaPayload({ productId: 123 })).toBe(false);

      expect(isSyncPushResponse({
        success: true,
        processedRecordIds: ['r1', 'r2'],
        serverVectorClock: { server: 1 },
      })).toBe(true);
      expect(isSyncPushResponse({ success: 'not-a-bool' })).toBe(false);

      expect(isOfflineQueueItem({
        id: 'q1',
        documentUuid: 'u1',
        documentType: 'E_INVOICE',
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        createdAt: '2026-09-06T00:00:00Z',
        nextRetryAt: '2026-09-06T00:00:00Z',
        payload: {},
      })).toBe(true);
      expect(isOfflineQueueItem({ id: 123 })).toBe(false);

      expect(isValidOutboxRecord({
        id: 'out_1',
        eventId: 'evt_1',
        aggregateId: 'agg_1',
        aggregateType: 'ORDER',
        eventType: 'ORDER_CREATED',
        payload: { item: 'burger' },
        vectorClock: { t1: 1 },
        version: 1,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 5,
        createdAt: '2026-09-06T00:00:00Z',
      })).toBe(true);
      expect(isValidOutboxRecord({ id: 'out_1' })).toBe(false);
    });

    it('verifies deterministic canonicalJsonStringify and SHA-256 hash consistency', () => {
      // Reordered keys must produce identical byte streams and hashes
      const obj1 = { b: 2, a: 1, nested: { y: 'bar', x: 'foo' } };
      const obj2 = { nested: { x: 'foo', y: 'bar' }, a: 1, b: 2 };

      const canon1 = canonicalJsonStringify(obj1);
      const canon2 = canonicalJsonStringify(obj2);

      expect(canon1).toBe(canon2);
      expect(calculateSha256(canon1)).toBe(calculateSha256(canon2));
      expect(calculateSha256(canon1)).toHaveLength(64);
    });
  });
});
