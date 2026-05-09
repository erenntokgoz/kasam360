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

// Request Interceptor
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

// Response Interceptor
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
      originalRequest._retry = true;

      try {
        const refreshToken = getItem(StorageKeys.REFRESH_TOKEN);
        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        const response = await axios.post(`${BASE_URL}/api/auth/refresh-token`, {
          refreshToken,
        });

        if (response.data.success) {
          const newToken = response.data.token;
          setItem(StorageKeys.TOKEN, newToken);
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
          } else {
            originalRequest.headers = { Authorization: `Bearer ${newToken}` };
          }
          return apiClient(originalRequest);
        }
      } catch (refreshError) {
        clearStorage();
        return Promise.reject(refreshError);
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