import { MMKV } from 'react-native-mmkv';

/**
 * Singleton MMKV instance for the app.
 * Used for fast synchronous key-value persistence (JWT token, user data, etc.)
 * A unique ID scopes the storage so it can co-exist with other MMKV instances
 * in the future (e.g. per-tenant encrypted storage).
 */
export const storage = new MMKV({ id: 'kasam360-storage' });

// ─── Typed helpers ────────────────────────────────────────────────────────────

export const StorageKeys = {
  TOKEN: 'auth.token',
  REFRESH_TOKEN: 'auth.refreshToken',
  USER: 'auth.user',
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];

/** Persist a string value. */
export const setItem = (key: StorageKey, value: string): void => {
  storage.set(key, value);
};

/** Retrieve a string value, or null if not set. */
export const getItem = (key: StorageKey): string | null => {
  return storage.getString(key) ?? null;
};

/** Remove a key from storage. */
export const removeItem = (key: StorageKey): void => {
  storage.remove(key);
};

/** Clear all keys scoped to this MMKV instance. */
export const clearStorage = (): void => {
  storage.clearAll();
};
