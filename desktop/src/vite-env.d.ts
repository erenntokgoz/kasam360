/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** `true` olunca kasa geçerli lisans ister ve modüller pakete göre açılır. */
  readonly VITE_LICENSE_ENFORCED?: string;
}
