import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Keys ────────────────────────────────────────────────────────────────────

export const StorageKeys = {
  TOKEN: 'auth.token',
  REFRESH_TOKEN: 'auth.refreshToken',
  USER: 'auth.user',
  THEME: 'theme.mode',
  NOTIFICATIONS: 'notifications.settings',
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Persist a string value. */
export const setItem = async (key: StorageKey, value: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(key, value);
  } catch (e) {
    console.error('[Storage] setItem error', e);
  }
};

/** Retrieve a string value, or null if not set. */
export const getItem = async (key: StorageKey): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(key);
  } catch (e) {
    console.error('[Storage] getItem error', e);
    return null;
  }
};

/** Remove a key. */
export const removeItem = async (key: StorageKey): Promise<void> => {
  try {
    await AsyncStorage.removeItem(key);
  } catch (e) {
    console.error('[Storage] removeItem error', e);
  }
};

/** Clear all stored data. */
export const clearStorage = async (): Promise<void> => {
  try {
    await AsyncStorage.clear();
  } catch (e) {
    console.error('[Storage] clearStorage error', e);
  }
};
