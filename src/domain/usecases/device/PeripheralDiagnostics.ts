import { FiscalDeviceManager } from '../../../data/fiscal/FiscalDeviceManager';
import { OfflineSyncQueue } from '../../../data/queue/OfflineSyncQueue';
import { StationRouter } from '../kds/StationRouter';
import { PeripheralConnectionState, PeripheralStatus, PeripheralType } from './types';

export type CustomPeripheralChecker = () => Promise<PeripheralStatus>;

export interface IPeripheralDiagnostics {
  diagnoseAll(): Promise<PeripheralStatus[]>;
  checkPrinterStatus(): Promise<PeripheralStatus>;
  checkCashDrawerStatus(): Promise<PeripheralStatus>;
  checkKdsStatus(): Promise<PeripheralStatus>;
  checkOfflineSyncStatus(): Promise<PeripheralStatus>;
  registerCustomChecker(type: PeripheralType, checker: CustomPeripheralChecker): void;
}

/**
 * Kurumsal Çevresel Aygıt Tanılamaları Motoru
 *
 * POS çevresel aygıtlarının operasyonel hazırlığını tarar, doğrular ve raporlar:
 * 1. ESC/POS ve Mali Yazıcı Bağlantısı ve Kağıt/Kapak Durumu
 * 2. Yazar Kasa Çekmecesi Solenoid ve Temas Sensörü Durumu
 * 3. KDS İstasyon Yönlendirme Motoru Yanıt Verebilirliği ve Gönderim Gecikmesi
 * 4. Çevrimdışı Esnek Senkronizasyon Kuyruğu Birikimi ve Kurtarma Durumu
 */
export class PeripheralDiagnostics implements IPeripheralDiagnostics {
  private static instance: PeripheralDiagnostics | null = null;
  private readonly fiscalManager: FiscalDeviceManager;
  private readonly offlineQueue: OfflineSyncQueue;
  private readonly customCheckers: Map<PeripheralType, CustomPeripheralChecker> = new Map();

  public constructor(fiscalManager?: FiscalDeviceManager, offlineQueue?: OfflineSyncQueue) {
    this.fiscalManager = fiscalManager ?? FiscalDeviceManager.getInstance();
    this.offlineQueue = offlineQueue ?? OfflineSyncQueue.getInstance();
  }

  public static getInstance(): PeripheralDiagnostics {
    if (!PeripheralDiagnostics.instance) {
      PeripheralDiagnostics.instance = new PeripheralDiagnostics();
    }
    return PeripheralDiagnostics.instance;
  }

  public static resetInstance(): void {
    PeripheralDiagnostics.instance = null;
  }

  /**
   * Gelişigüzel bir çevresel aygıt türü için bir tanılama değerlendirme kontrolünü kaydeder veya geçersiz kılar.
   */
  public registerCustomChecker(type: PeripheralType, checker: CustomPeripheralChecker): void {
    this.customCheckers.set(type, checker);
  }

  /**
   * Tüm bağlı donanım çevresel aygıtlarını eşzamanlı olarak değerlendirir ve birleşik bir rapor derler.
   */
  public async diagnoseAll(): Promise<PeripheralStatus[]> {
    const coreTasks: Promise<PeripheralStatus>[] = [
      this.checkPrinterStatus(),
      this.checkCashDrawerStatus(),
      this.checkKdsStatus(),
      this.checkOfflineSyncStatus(),
    ];

    const customTasks: Promise<PeripheralStatus>[] = Array.from(this.customCheckers.values()).map(
      (checker) =>
        checker().catch((err: unknown): PeripheralStatus => ({
          id: 'CUSTOM_PERIPHERAL',
          name: 'Custom Peripheral',
          type: 'BARCODE_SCANNER',
          state: 'ERROR',
          isOnline: false,
          lastCheckedAt: new Date().toISOString(),
          message: err instanceof Error ? err.message : String(err),
        }))
    );

    return Promise.all([...coreTasks, ...customTasks]);
  }

  /**
   * ESC/POS Mali Yazıcı bağlantısını, kağıt beslemesini, kapak durumunu ve belleği değerlendirir.
   */
  public async checkPrinterStatus(): Promise<PeripheralStatus> {
    const now = new Date().toISOString();
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    try {
      const status = await this.fiscalManager.getDeviceStatus();
      const latencyMs = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
      );

      let state: PeripheralConnectionState = 'CONNECTED';
      let message = 'Printer ready and operational';

      if (!status.isConnected) {
        state = 'DISCONNECTED';
        message = 'Printer is disconnected or powered off';
      } else if (status.isCoverOpen) {
        state = 'DEGRADED';
        message = 'Printer cover is open';
      } else if (!status.hasPaper) {
        state = 'DEGRADED';
        message = 'Printer is out of paper';
      } else if (status.isFiscalMemoryFull || status.isEJMemoryFull) {
        state = 'ERROR';
        message = 'Printer fiscal memory or EJ is full';
      }

      return {
        id: 'PRINTER_ESC_POS_01',
        name: `Printer (${status.brand} ${status.model})`,
        type: 'ESC_POS_PRINTER',
        state,
        isOnline: status.isConnected,
        lastCheckedAt: now,
        latencyMs,
        message,
        details: {
          brand: status.brand,
          model: status.model,
          serial: status.deviceSerial,
          hasPaper: status.hasPaper,
          isCoverOpen: status.isCoverOpen,
          firmwareVersion: status.firmwareVersion,
        },
      };
    } catch (err: unknown) {
      const latencyMs = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
      );
      return {
        id: 'PRINTER_ESC_POS_01',
        name: 'ESC/POS Fiscal Printer',
        type: 'ESC_POS_PRINTER',
        state: 'ERROR',
        isOnline: false,
        lastCheckedAt: now,
        latencyMs,
        message: err instanceof Error ? err.message : 'Failed to query printer status',
      };
    }
  }

  /**
   * Yazar Kasa Çekmecesi fiziksel sensör temas durumunu ve solenoid kullanılabilirliğini değerlendirir.
   */
  public async checkCashDrawerStatus(): Promise<PeripheralStatus> {
    const now = new Date().toISOString();
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    try {
      const drawerStatus = await this.fiscalManager.getCashDrawerStatus();
      const latencyMs = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
      );

      let state: PeripheralConnectionState = 'CONNECTED';
      let message = drawerStatus.isOpen ? 'Drawer is open' : 'Drawer is closed';

      if (drawerStatus.status === 'UNKNOWN') {
        state = 'UNKNOWN';
        message = 'Drawer sensor status unknown';
      }

      return {
        id: 'CASH_DRAWER_01',
        name: 'Physical Cash Drawer',
        type: 'CASH_DRAWER',
        state,
        isOnline: true,
        lastCheckedAt: now,
        latencyMs,
        message,
        details: {
          isOpen: drawerStatus.isOpen,
          drawerState: drawerStatus.status,
          lastOpenedAt: drawerStatus.lastOpenedAt,
        },
      };
    } catch (err: unknown) {
      const latencyMs = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
      );
      return {
        id: 'CASH_DRAWER_01',
        name: 'Physical Cash Drawer',
        type: 'CASH_DRAWER',
        state: 'ERROR',
        isOnline: false,
        lastCheckedAt: now,
        latencyMs,
        message: err instanceof Error ? err.message : 'Failed to read cash drawer status',
      };
    }
  }

  /**
   * KDS istasyon yönlendirme motoru yanıt verebilirliğini ve gönderim gecikmesini kıyaslar.
   */
  public async checkKdsStatus(): Promise<PeripheralStatus> {
    const now = new Date().toISOString();
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    try {
      // Tanısal yönlendirme doğrulamasını yürüt
      const router = new StationRouter();
      const sampleItem = {
        id: 'kds_diag_probe',
        name: 'Diagnostic Burger',
        quantity: 1,
      };

      const resolvedStation = router.resolveStation(sampleItem);
      const latencyMs = Math.max(
        0.1,
        Number(
          (
            (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
          ).toFixed(2)
        )
      );

      const isHealthy = resolvedStation === 'Grill';
      const state: PeripheralConnectionState = isHealthy ? 'CONNECTED' : 'DEGRADED';

      return {
        id: 'KDS_ENGINE_ROUTER',
        name: 'KDS Station Routing Engine',
        type: 'KDS_ENGINE',
        state,
        isOnline: isHealthy,
        lastCheckedAt: now,
        latencyMs,
        message: isHealthy
          ? 'KDS station router is active and responsive'
          : 'KDS routing rule mismatch detected',
        details: {
          probeStation: resolvedStation,
          benchmarkLatencyMs: latencyMs,
        },
      };
    } catch (err: unknown) {
      const latencyMs = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
      );
      return {
        id: 'KDS_ENGINE_ROUTER',
        name: 'KDS Station Routing Engine',
        type: 'KDS_ENGINE',
        state: 'ERROR',
        isOnline: false,
        lastCheckedAt: now,
        latencyMs,
        message: err instanceof Error ? err.message : 'KDS Engine diagnostic failure',
      };
    }
  }

  /**
   * Çevrimdışı kuyruk senkronizasyon birikimini ve çalışan yürütme sağlığını değerlendirir.
   */
  public async checkOfflineSyncStatus(): Promise<PeripheralStatus> {
    const now = new Date().toISOString();
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    try {
      const pendingCount = await this.offlineQueue.getPendingCount();
      const isWorkerRunning = this.offlineQueue.isWorkerRunning();
      const latencyMs = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
      );

      let state: PeripheralConnectionState = 'CONNECTED';
      let message = `Offline sync queue healthy (${pendingCount} pending items)`;

      if (!isWorkerRunning) {
        state = 'DEGRADED';
        message = 'Offline sync background worker is halted';
      } else if (pendingCount > 100) {
        state = 'DEGRADED';
        message = `High offline queue backlog: ${pendingCount} items awaiting synchronization`;
      }

      return {
        id: 'OFFLINE_SYNC_QUEUE_01',
        name: 'Offline Resilient Sync Queue',
        type: 'OFFLINE_SYNC_QUEUE',
        state,
        isOnline: isWorkerRunning,
        lastCheckedAt: now,
        latencyMs,
        message,
        details: {
          pendingCount,
          isWorkerRunning,
          providerId: this.offlineQueue.providerId,
        },
      };
    } catch (err: unknown) {
      const latencyMs = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
      );
      return {
        id: 'OFFLINE_SYNC_QUEUE_01',
        name: 'Offline Resilient Sync Queue',
        type: 'OFFLINE_SYNC_QUEUE',
        state: 'ERROR',
        isOnline: false,
        lastCheckedAt: now,
        latencyMs,
        message: err instanceof Error ? err.message : 'Offline queue inspection failed',
      };
    }
  }
}
