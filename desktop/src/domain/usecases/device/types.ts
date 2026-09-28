/**
 * Kasam360 Device Health Telemetry & Diagnostics Domain Types
 * Layer: Domain / Device
 */

export type HealthStatus = 'OPERATIONAL' | 'DEGRADED' | 'CRITICAL' | 'OFFLINE';

export type MetricStatus = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

export type PeripheralType =
  | 'ESC_POS_PRINTER'
  | 'CASH_DRAWER'
  | 'KDS_ENGINE'
  | 'OFFLINE_SYNC_QUEUE'
  | 'BARCODE_SCANNER'
  | 'PAYMENT_TERMINAL';

export type PeripheralConnectionState =
  'CONNECTED' | 'DISCONNECTED' | 'DEGRADED' | 'BUSY' | 'ERROR' | 'UNKNOWN';

/**
 * Atomic diagnostic metric representing a vital system benchmark.
 */
export interface DiagnosticMetric {
  name: string;
  value: number;
  unit: 'ms' | 'MB' | 'percent' | 'count' | 'status';
  timestamp: string;
  status: MetricStatus;
  thresholdWarn?: number;
  thresholdCrit?: number;
  details?: Record<string, unknown>;
}

/**
 * Individual peripheral hardware/subsystem diagnostic report.
 */
export interface PeripheralStatus {
  id: string;
  name: string;
  type: PeripheralType;
  state: PeripheralConnectionState;
  isOnline: boolean;
  lastCheckedAt: string;
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * System vitals structure synthesized on each heartbeat cycle.
 */
export interface SystemVitals {
  cpuUsagePercent: number;
  memoryUsageMb: number;
  memoryTotalMb: number;
  memoryFreeMb: number;
  memoryUsagePercent: number;
  sqliteLatencyMs: number;
  outboxBacklogCount: number;
  timestamp: string;
}

/**
 * Network state metadata captured in the heartbeat.
 */
export interface NetworkVitals {
  isOnline: boolean;
  type?: 'WIFI' | 'ETHERNET' | 'CELLULAR' | 'UNKNOWN';
  latencyMs?: number;
}

/**
 * Strict immutable telemetry payload synthesized by the Heartbeat Engine.
 */
export interface DeviceHealthPayload {
  deviceId: string;
  terminalId: string;
  branchId: string;
  timestamp: string;
  status: HealthStatus;
  vitals: SystemVitals;
  peripherals: PeripheralStatus[];
  metrics: DiagnosticMetric[];
  network: NetworkVitals;
  appVersion: string;
  uptimeSeconds: number;
}

/**
 * Configuration options for the Heartbeat Telemetry Service.
 */
export interface HeartbeatConfig {
  deviceId: string;
  terminalId: string;
  branchId: string;
  appVersion: string;
  intervalMs: number;
  enabled: boolean;
  cpuWarningThresholdPercent: number;
  cpuCriticalThresholdPercent: number;
  memoryWarningThresholdMb: number;
  memoryCriticalThresholdMb: number;
  sqliteLatencyWarningThresholdMs: number;
  sqliteLatencyCriticalThresholdMs: number;
  outboxBacklogWarningThreshold: number;
  outboxBacklogCriticalThreshold: number;
}

/**
 * Persisted snapshot representing a point-in-time device health evaluation.
 */
export interface DiagnosticSnapshot {
  id: string;
  capturedAt: string;
  payload: DeviceHealthPayload;
  summary: {
    overallStatus: HealthStatus;
    healthyPeripheralsCount: number;
    totalPeripheralsCount: number;
    unresolvedWarnings: string[];
  };
}

/**
 * Real-time status matrix optimized for low-bandwidth remote monitoring
 * by store managers and owners.
 */
export interface RealtimeStatusMatrix {
  deviceId: string;
  terminalId: string;
  branchId: string;
  lastHeartbeat: string;
  overallHealth: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  system: {
    cpuStatus: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    cpuUsage: string;
    ramStatus: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    ramUsage: string;
    dbLatencyStatus: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    dbLatency: string;
    outboxStatus: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    outboxBacklog: number;
  };
  peripherals: {
    printer: {
      state: PeripheralConnectionState;
      isOnline: boolean;
      message?: string;
    };
    cashDrawer: {
      state: PeripheralConnectionState;
      isOpen: boolean;
      message?: string;
    };
    kds: {
      state: PeripheralConnectionState;
      isOnline: boolean;
      latencyMs?: number;
      message?: string;
    };
    offlineSync: {
      state: PeripheralConnectionState;
      isOnline: boolean;
      pendingCount: number;
      message?: string;
    };
  };
  activeAlerts: string[];
}
