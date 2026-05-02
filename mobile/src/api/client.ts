import axios from 'axios';
import { getItem, StorageKeys } from '../utils/storage';

/**
 * Base URL strategy:
 *  - Production  → Render.com deployment URL (set via REACT_APP_API_URL or build config)
 *  - Local dev   → Android emulator: 10.0.2.2  |  iOS simulator / physical: your LAN IP
 *
 * For React Native we read from a compile-time constant if available,
 * otherwise fall back to the Android emulator loopback.
 */
const BASE_URL =
  (global as any).__API_BASE_URL__ ??
  'http://172.20.10.5:5000'; // Android emulator → host machine localhost

const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000, // 15 s — reasonable for mobile on slow connections
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// ─── Request Interceptor ──────────────────────────────────────────────────────
// Attaches the stored JWT to every outgoing request automatically.
apiClient.interceptors.request.use(
  (config) => {
    const token = getItem(StorageKeys.TOKEN);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ─── Response Interceptor ─────────────────────────────────────────────────────
// Centralised error normalisation — unwrap Axios error into a plain Error
// so callers don't have to import axios just to check AxiosError.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const message: string =
      error?.response?.data?.message ?? // server error body
      error?.message ??                 // network-level message
      'An unexpected error occurred.';

    // Preserve HTTP status on the thrown error for conditional handling upstream
    const normalised = new Error(message) as Error & { status?: number };
    normalised.status = error?.response?.status;

    return Promise.reject(normalised);
  },
);

export default apiClient;
