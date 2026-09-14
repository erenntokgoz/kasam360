import {
  DeviceHealthPayload,
  DiagnosticSnapshot,
  RealtimeStatusMatrix,
} from '../../../domain/usecases/device/types';

export interface IDeviceStatusRepository {
  saveSnapshot(payload: DeviceHealthPayload): Promise<DiagnosticSnapshot>;
  getLatestSnapshot(): Promise<DiagnosticSnapshot | null>;
  getSnapshotHistory(limit?: number): Promise<DiagnosticSnapshot[]>;
  getRealtimeStatusMatrix(): Promise<RealtimeStatusMatrix>;
  clearHistory(): Promise<void>;
  subscribe(listener: (matrix: RealtimeStatusMatrix) => void): () => void;
}

export interface DeviceStatusRepositoryConfig {
  storageKeyPrefix?: string;
  maxHistoryRecords?: number;
}

/**
 * Local Data Repository for Device Diagnostic Status & Real-time Matrix Exposure.
 * Resides in data/local/device.
 */
export class DeviceStatusRepository implements IDeviceStatusRepository {
  private static instance: DeviceStatusRepository | null = null;

  private readonly storageKeyLatest: string;
  private readonly storageKeyHistory: string;
  private readonly storageKeyMatrix: string;
  private readonly maxHistory: number;

  private inMemoryLatest: DiagnosticSnapshot | null = null;
  private inMemoryHistory: DiagnosticSnapshot[] = [];
  private inMemoryMatrix: RealtimeStatusMatrix | null = null;
  private readonly listeners: Set<(matrix: RealtimeStatusMatrix) => void> = new Set();

  public constructor(config?: DeviceStatusRepositoryConfig) {
    const prefix = config?.storageKeyPrefix ?? 'kasam360_device_telemetry';
    this.storageKeyLatest = `${prefix}_latest_snapshot_v1`;
    this.storageKeyHistory = `${prefix}_history_snapshots_v1`;
    this.storageKeyMatrix = `${prefix}_realtime_matrix_v1`;
    this.maxHistory = config?.maxHistoryRecords ?? 100;
  }

  public static getInstance(config?: DeviceStatusRepositoryConfig): DeviceStatusRepository {
    if (!DeviceStatusRepository.instance) {
      DeviceStatusRepository.instance = new DeviceStatusRepository(config);
    }
    return DeviceStatusRepository.instance;
  }

  public static resetInstance(): void {
    DeviceStatusRepository.instance = null;
  }

  /**
   * Persists a device telemetry snapshot locally and updates the aggregated real-time matrix.
   */
  public async saveSnapshot(payload: DeviceHealthPayload): Promise<DiagnosticSnapshot> {
    const unresolvedWarnings: string[] = [];

    const healthyPeripherals = payload.peripherals.filter(
      (p) => p.state === 'CONNECTED' && p.isOnline
    );

    for (const metric of payload.metrics) {
      if (metric.status === 'DEGRADED') {
        unresolvedWarnings.push(`Metric degraded: ${metric.name} is ${metric.value}${metric.unit}`);
      } else if (metric.status === 'CRITICAL') {
        unresolvedWarnings.push(`Metric critical: ${metric.name} is ${metric.value}${metric.unit}`);
      }
    }

    for (const p of payload.peripherals) {
      if (p.state !== 'CONNECTED' || !p.isOnline) {
        unresolvedWarnings.push(
          `Peripheral ${p.name} (${p.type}) is ${p.state}: ${p.message ?? 'Unknown'}`
        );
      }
    }

    const snapshot: DiagnosticSnapshot = {
      id: `SNAP_${Date.now()}_${payload.terminalId.slice(0, 6)}`,
      capturedAt: payload.timestamp,
      payload,
      summary: {
        overallStatus: payload.status,
        healthyPeripheralsCount: healthyPeripherals.length,
        totalPeripheralsCount: payload.peripherals.length,
        unresolvedWarnings,
      },
    };

    // Bellekte sakla
    this.inMemoryLatest = snapshot;
    this.inMemoryHistory.unshift(snapshot);
    if (this.inMemoryHistory.length > this.maxHistory) {
      this.inMemoryHistory = this.inMemoryHistory.slice(0, this.maxHistory);
    }

    // Anlık görüntüyü LocalStorage'a kaydet
    this.persistToLocalStorage(this.storageKeyLatest, JSON.stringify(snapshot));
    this.persistToLocalStorage(this.storageKeyHistory, JSON.stringify(this.inMemoryHistory));

    // Gerçek zamanlı durum matrisini sentezle ve kaydet
    const matrix = this.buildStatusMatrix(payload, unresolvedWarnings);
    this.inMemoryMatrix = matrix;
    this.persistToLocalStorage(this.storageKeyMatrix, JSON.stringify(matrix));

    // Aktif dinleyicilere bildir (örn. kullanıcı arayüzü veya uzaktan izleme havuzları)
    this.notifySubscribers(matrix);

    return snapshot;
  }

  /**
   * Retrieves the most recent diagnostic snapshot.
   */
  public async getLatestSnapshot(): Promise<DiagnosticSnapshot | null> {
    if (this.inMemoryLatest) {
      return this.inMemoryLatest;
    }
    const raw = this.readFromLocalStorage(this.storageKeyLatest);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as DiagnosticSnapshot;
        this.inMemoryLatest = parsed;
        return parsed;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Retrieves historical snapshots within the configured retention limit.
   */
  public async getSnapshotHistory(limit?: number): Promise<DiagnosticSnapshot[]> {
    if (this.inMemoryHistory.length === 0) {
      const raw = this.readFromLocalStorage(this.storageKeyHistory);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as DiagnosticSnapshot[];
          if (Array.isArray(parsed)) {
            this.inMemoryHistory = parsed;
          }
        } catch {
          this.inMemoryHistory = [];
        }
      }
    }
    const max = limit ?? this.maxHistory;
    return this.inMemoryHistory.slice(0, max);
  }

  /**
   * Exposes the unified real-time status matrix optimized for remote monitoring
   * by store managers and owners.
   */
  public async getRealtimeStatusMatrix(): Promise<RealtimeStatusMatrix> {
    if (this.inMemoryMatrix) {
      return this.inMemoryMatrix;
    }

    const raw = this.readFromLocalStorage(this.storageKeyMatrix);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as RealtimeStatusMatrix;
        this.inMemoryMatrix = parsed;
        return parsed;
      } catch {
        // Aşağıda geri dönüş
      }
    }

    const latest = await this.getLatestSnapshot();
    if (latest) {
      const matrix = this.buildStatusMatrix(latest.payload, latest.summary.unresolvedWarnings);
      this.inMemoryMatrix = matrix;
      return matrix;
    }

    return this.getDefaultEmptyMatrix();
  }

  /**
   * Subscribes to real-time status matrix updates.
   */
  public subscribe(listener: (matrix: RealtimeStatusMatrix) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Clears historical snapshots from local cache and storage.
   */
  public async clearHistory(): Promise<void> {
    this.inMemoryHistory = [];
    this.removeFromLocalStorage(this.storageKeyHistory);
  }

  /**
   * Synthesizes the low-bandwidth RealtimeStatusMatrix from raw health telemetry.
   */
  public buildStatusMatrix(
    payload: DeviceHealthPayload,
    activeAlerts: string[]
  ): RealtimeStatusMatrix {
    const printer = payload.peripherals.find((p) => p.type === 'ESC_POS_PRINTER');
    const cashDrawer = payload.peripherals.find((p) => p.type === 'CASH_DRAWER');
    const kds = payload.peripherals.find((p) => p.type === 'KDS_ENGINE');
    const offlineSync = payload.peripherals.find((p) => p.type === 'OFFLINE_SYNC_QUEUE');

    const cpuMetric = payload.metrics.find((m) => m.name === 'CPU_UTILIZATION');
    const ramMetric = payload.metrics.find((m) => m.name === 'RAM_ALLOCATION');
    const dbMetric = payload.metrics.find((m) => m.name === 'SQLITE_LATENCY');
    const outboxMetric = payload.metrics.find((m) => m.name === 'OUTBOX_BACKLOG');

    const mapMetricToLevel = (status?: string): 'HEALTHY' | 'WARNING' | 'CRITICAL' => {
      if (status === 'CRITICAL') return 'CRITICAL';
      if (status === 'DEGRADED') return 'WARNING';
      return 'HEALTHY';
    };

    const overallHealth: 'HEALTHY' | 'WARNING' | 'CRITICAL' =
      payload.status === 'CRITICAL' || payload.status === 'OFFLINE'
        ? 'CRITICAL'
        : payload.status === 'DEGRADED'
          ? 'WARNING'
          : 'HEALTHY';

    const drawerIsOpen = Boolean(cashDrawer?.details?.isOpen ?? false);

    return {
      deviceId: payload.deviceId,
      terminalId: payload.terminalId,
      branchId: payload.branchId,
      lastHeartbeat: payload.timestamp,
      overallHealth,
      system: {
        cpuStatus: mapMetricToLevel(cpuMetric?.status),
        cpuUsage: `${payload.vitals.cpuUsagePercent.toFixed(1)}%`,
        ramStatus: mapMetricToLevel(ramMetric?.status),
        ramUsage: `${payload.vitals.memoryUsageMb.toFixed(0)} MB (${payload.vitals.memoryUsagePercent.toFixed(0)}%)`,
        dbLatencyStatus: mapMetricToLevel(dbMetric?.status),
        dbLatency: `${payload.vitals.sqliteLatencyMs.toFixed(1)} ms`,
        outboxStatus: mapMetricToLevel(outboxMetric?.status),
        outboxBacklog: payload.vitals.outboxBacklogCount,
      },
      peripherals: {
        printer: {
          state: printer?.state ?? 'UNKNOWN',
          isOnline: printer?.isOnline ?? false,
          message: printer?.message,
        },
        cashDrawer: {
          state: cashDrawer?.state ?? 'UNKNOWN',
          isOpen: drawerIsOpen,
          message: cashDrawer?.message,
        },
        kds: {
          state: kds?.state ?? 'UNKNOWN',
          isOnline: kds?.isOnline ?? false,
          latencyMs: kds?.latencyMs,
          message: kds?.message,
        },
        offlineSync: {
          state: offlineSync?.state ?? 'UNKNOWN',
          isOnline: offlineSync?.isOnline ?? false,
          pendingCount: payload.vitals.outboxBacklogCount,
          message: offlineSync?.message,
        },
      },
      activeAlerts,
    };
  }

  private getDefaultEmptyMatrix(): RealtimeStatusMatrix {
    return {
      deviceId: 'UNKNOWN_DEVICE',
      terminalId: 'POS_TERMINAL_01',
      branchId: 'MAIN_BRANCH',
      lastHeartbeat: new Date().toISOString(),
      overallHealth: 'WARNING',
      system: {
        cpuStatus: 'HEALTHY',
        cpuUsage: '0.0%',
        ramStatus: 'HEALTHY',
        ramUsage: '0 MB (0%)',
        dbLatencyStatus: 'HEALTHY',
        dbLatency: '0.0 ms',
        outboxStatus: 'HEALTHY',
        outboxBacklog: 0,
      },
      peripherals: {
        printer: { state: 'UNKNOWN', isOnline: false, message: 'No heartbeat recorded' },
        cashDrawer: { state: 'UNKNOWN', isOpen: false, message: 'No heartbeat recorded' },
        kds: { state: 'UNKNOWN', isOnline: false, message: 'No heartbeat recorded' },
        offlineSync: {
          state: 'UNKNOWN',
          isOnline: false,
          pendingCount: 0,
          message: 'No heartbeat recorded',
        },
      },
      activeAlerts: ['No diagnostic heartbeat recorded yet.'],
    };
  }

  private notifySubscribers(matrix: RealtimeStatusMatrix): void {
    for (const listener of this.listeners) {
      try {
        listener(matrix);
      } catch {
        // Abone hatalarının yürütmeyi durdurmasını önle
      }
    }
  }

  private persistToLocalStorage(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch {
      // Bellek içi geri dönüş zaten korunuyor
    }
  }

  private readFromLocalStorage(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {
      // Bellek içi geri dönüşü kullanmak için null döndür
    }
    return null;
  }

  private removeFromLocalStorage(key: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // LocalStorage unavailable or restricted
    }
  }
}
