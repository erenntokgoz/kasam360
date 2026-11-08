import type { Db } from 'mongodb';
import { GRACE_HOURS } from '../license.js';

export interface DeviceLicenseState {
  /** `active`, `revoked`, `blocked`, `limit` veya `unlicensed` kaydı. */
  state: string;
  validUntil: string | null;
  version?: 1 | 2;
  paidUntil?: string | null;
  offlineUntil?: string | null;
  blocked: boolean;
  hasPlan: boolean;
}

/** İptal ve bitiş ayrı durumdur; yalnız bitişte önceden üretilmiş kuyruk istisnası uygulanır. */
export type DeviceStanding = 'active' | 'expired' | 'revoked' | 'blocked' | 'inactive' | 'unknown';

export interface DeviceLicenses {
  record(userId: string, deviceId: string, state: DeviceLicenseState): Promise<void>;
  standing(userId: string, deviceId: string): Promise<DeviceStanding>;
  assess(userId: string, deviceId: string): Promise<DeviceLicenseAssessment>;
  recordTenant(userId: string, tenantId: string, deviceId: string, state: DeviceLicenseState): Promise<void>;
  standingForTenant(userId: string, tenantId: string, deviceId: string): Promise<DeviceStanding>;
  assessForTenant(userId: string, tenantId: string, deviceId: string): Promise<DeviceLicenseAssessment>;
  lockForReview(userId: string, tenantId: string, deviceId: string, operationId: string): Promise<'locked' | 'revoked' | 'blocked' | 'inactive' | 'busy'>;
  releaseReviewLock(userId: string, tenantId: string, deviceId: string, operationId: string): Promise<void>;
}

export interface DeviceLicenseAssessment {
  standing: DeviceStanding;
  expiresAt: number | null;
}

interface StoredDeviceLicense {
  user_id: string;
  device_id: string;
  state: string;
  tenant_id?: string;
  valid_until: string | null;
  license_version?: 1 | 2;
  paid_until?: string | null;
  offline_until?: string | null;
  blocked: boolean;
  has_plan: boolean;
  checked_at: Date;
  review_lock?: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function v1Expiry(validUntil: string | null): number | null {
  if (!validUntil || !DAY.test(validUntil)) return null;
  const dayStart = Date.parse(`${validUntil}T00:00:00+03:00`);
  return Number.isFinite(dayStart) ? dayStart + 24 * HOUR_MS + GRACE_HOURS * HOUR_MS : null;
}

function v2Expiry(stored: Pick<StoredDeviceLicense, 'paid_until' | 'offline_until'>): number | null {
  if (!stored.paid_until || !stored.offline_until) return null;
  const paidUntil = Date.parse(stored.paid_until);
  const offlineUntil = Date.parse(stored.offline_until);
  if (!Number.isFinite(paidUntil) || !Number.isFinite(offlineUntil) || offlineUntil > paidUntil) return null;
  return Math.min(paidUntil, offlineUntil);
}

export function assessDeviceLicense(
  stored: Pick<StoredDeviceLicense, 'state' | 'tenant_id' | 'valid_until' | 'license_version' | 'paid_until' | 'offline_until' | 'blocked' | 'has_plan'>,
  now: number,
): DeviceLicenseAssessment {
  if (stored.state === 'revoked') return { standing: 'revoked', expiresAt: null };
  if (stored.blocked || stored.state === 'blocked') return { standing: 'blocked', expiresAt: null };
  if (stored.state !== 'active' || !stored.has_plan) return { standing: 'inactive', expiresAt: null };
  // Eski tenant lisans aynasında yalnız tarih saklanıyordu; V2 tam zaman alanları gelene kadar kapalı kalır.
  if (stored.tenant_id && stored.license_version !== 2) return { standing: 'inactive', expiresAt: null };
  const expiresAt = stored.license_version === 2
    ? v2Expiry(stored)
    : v1Expiry(stored.valid_until);
  if (expiresAt === null) return { standing: 'inactive', expiresAt: null };
  return { standing: expiresAt > now ? 'active' : 'expired', expiresAt };
}

/** V1 gün sonu +72 saat toleransı korunur; V2 imzalı anlık sınırları kullanır. */
export function licenseActive(
  stored: Pick<StoredDeviceLicense, 'state' | 'tenant_id' | 'valid_until' | 'license_version' | 'paid_until' | 'offline_until' | 'blocked' | 'has_plan'>,
  now: number,
) {
  return assessDeviceLicense(stored, now).standing === 'active';
}

export function mongoDeviceLicenses(db: Db): DeviceLicenses {
  const licenses = db.collection<StoredDeviceLicense>('desktop_device_license');
  return {
    async record(userId, deviceId, { state, validUntil, blocked, hasPlan }) {
      await licenses.updateOne(
        { user_id: userId, device_id: deviceId },
        { $set: { state, valid_until: validUntil, license_version: 1, paid_until: null, offline_until: null, blocked, has_plan: hasPlan, checked_at: new Date() } },
        { upsert: true },
      );
    },
    async standing(userId, deviceId) {
      return (await this.assess(userId, deviceId)).standing;
    },
    async assess(userId, deviceId) {
      const stored = await licenses.findOne({ user_id: userId, device_id: deviceId });
      // Tenant-bound V2 cihazı legacy yol üzerinden kiracı seçemez.
      if (!stored || stored.tenant_id) return { standing: 'unknown', expiresAt: null };
      return assessDeviceLicense(stored, Date.now());
    },
    async recordTenant(userId, tenantId, deviceId, { state, validUntil, paidUntil = null, offlineUntil = null, blocked, hasPlan }) {
      const filter = { user_id: userId, device_id: deviceId, ...(state === 'revoked' || blocked ? { review_lock: { $exists: false } } : {}) };
      let result;
      try {
        result = await licenses.updateOne(
          filter,
          { $set: { tenant_id: tenantId, state, valid_until: validUntil, license_version: 2, paid_until: paidUntil, offline_until: offlineUntil, blocked, has_plan: hasPlan, checked_at: new Date() } },
          { upsert: true },
        );
      } catch (error) {
        if ((state === 'revoked' || blocked) && error && typeof error === 'object' && 'code' in error && error.code === 11000) {
          throw new Error('DEVICE_REVIEW_IN_PROGRESS');
        }
        throw error;
      }
      if ((state === 'revoked' || blocked) && result.matchedCount === 0 && result.upsertedCount === 0) throw new Error('DEVICE_REVIEW_IN_PROGRESS');
    },
    async standingForTenant(userId, tenantId, deviceId) {
      return (await this.assessForTenant(userId, tenantId, deviceId)).standing;
    },
    async assessForTenant(userId, tenantId, deviceId) {
      const stored = await licenses.findOne({ user_id: userId, tenant_id: tenantId, device_id: deviceId });
      if (!stored) return { standing: 'unknown', expiresAt: null };
      return assessDeviceLicense(stored, Date.now());
    },
    async lockForReview(userId, tenantId, deviceId, operationId) {
      const scope = { user_id: userId, tenant_id: tenantId, device_id: deviceId };
      const stored = await licenses.findOne(scope);
      if (!stored) return 'inactive';
      const standing = assessDeviceLicense(stored, Date.now()).standing;
      if (standing === 'revoked') return 'revoked';
      if (standing === 'blocked') return 'blocked';
      if (standing !== 'active' && standing !== 'expired') return 'inactive';
      if (stored.review_lock && stored.review_lock !== operationId) return 'busy';
      const result = await licenses.updateOne(
        { ...scope, state: { $nin: ['revoked', 'blocked'] }, blocked: { $ne: true }, $or: [{ review_lock: { $exists: false } }, { review_lock: operationId }] },
        { $set: { review_lock: operationId } },
      );
      if (result.matchedCount === 1) return 'locked';
      const latest = await licenses.findOne(scope);
      if (!latest || latest.state === 'revoked') return 'revoked';
      if (latest.state === 'blocked' || latest.blocked) return 'blocked';
      return latest.review_lock === operationId ? 'locked' : 'busy';
    },
    async releaseReviewLock(userId, tenantId, deviceId, operationId) {
      await licenses.updateOne(
        { user_id: userId, tenant_id: tenantId, device_id: deviceId, review_lock: operationId },
        { $unset: { review_lock: '' } },
      );
    },
  };
}
