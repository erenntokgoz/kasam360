import axios from 'axios';
import { getItem, setItem, clearStorage, StorageKeys } from '../utils/storage';

const BASE_URL = 'https://aesvora.com.tr';

const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

let isRefreshing = false;
let failedQueue: Array<{ resolve: (token: string) => void; reject: (error: any) => void }> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token as string);
  });
  failedQueue = [];
};

apiClient.interceptors.request.use(
  async (config) => {
    const token = await getItem(StorageKeys.TOKEN);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as any;

    if (
      error?.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      originalRequest.url !== '/api/auth/login' &&
      originalRequest.url !== '/api/auth/register'
    ) {

      // [DÜZELTME 2]: Race Condition & Token Invalidation Loop (Kuyruk Mantığı)
      // Eşzamanlı atılan birden fazla isteğin aynı anda 401 alıp, hepsinin backend'e
      // refresh token isteği göndermesini engelleyen Mutex Kilidi ve Kuyruk sistemi eklendi.
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return apiClient(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await getItem(StorageKeys.REFRESH_TOKEN);
        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        const response = await axios.post(`${BASE_URL}/api/auth/refresh-token`, {
          refreshToken,
        });

        if (response.data.success) {
          const newToken = response.data.token;
          await setItem(StorageKeys.TOKEN, newToken);
          if (response.data.refreshToken) {
            await setItem(StorageKeys.REFRESH_TOKEN, response.data.refreshToken);
          }

          processQueue(null, newToken);

          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
          } else {
            originalRequest.headers = { Authorization: `Bearer ${newToken}` };
          }
          return apiClient(originalRequest);
        }
      } catch (refreshError) {
        processQueue(refreshError, null);
        await clearStorage();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    const message: string =
      error?.response?.data?.message ??
      error?.message ??
      'An unexpected error occurred.';

    const normalised = new Error(message) as Error & { status?: number };
    normalised.status = error?.response?.status;

    return Promise.reject(normalised);
  },
);

export default apiClient;