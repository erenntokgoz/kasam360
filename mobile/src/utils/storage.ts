import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Keys ────────────────────────────────────────────────────────────────────

export const StorageKeys = {
  TOKEN: 'auth.token',
  REFRESH_TOKEN: 'auth.refreshToken',
  USER: 'auth.user',
  THEME: 'theme.mode',
  NOTIFICATIONS: 'notifications.settings',
  SETUP_COMPLETE: 'setup.complete',
  LANGUAGE: 'app.language',
  REMEMBER_ME: 'auth.rememberMe',
  PHONE_NUMBER: 'auth.phoneNumber',
  CONTACTS: 'app.contacts',
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Persist a string value. */
export const setItem = async (key: StorageKey, value: string): Promise<void> => {
  if (!key) {
    console.error('[Storage] setItem: key is undefined or null');
    return;
  }
  try {
    await AsyncStorage.setItem(key, value);
  } catch (e) {
    console.error(`[Storage] setItem error for key ${key}:`, e);
  }
};

/** Retrieve a string value, or null if not set. */
export const getItem = async (key: StorageKey): Promise<string | null> => {
  if (!key) {
    console.error('[Storage] getItem: key is undefined or null');
    return null;
  }
  try {
    const val = await AsyncStorage.getItem(key);
    return val;
  } catch (e) {
    console.error(`[Storage] getItem error for key ${key}:`, e);
    return null;
  }
};

/** Remove a key. */
export const removeItem = async (key: StorageKey): Promise<void> => {
  if (!key) {
    console.error('[Storage] removeItem: key is undefined or null');
    return;
  }
  try {
    await AsyncStorage.removeItem(key);
  } catch (e) {
    console.error(`[Storage] removeItem error for key ${key}:`, e);
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
