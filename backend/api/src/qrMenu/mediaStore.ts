import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

// Görsel depolama soyut arayüzün arkasındadır; ilk gerçekleme sunucu diskidir.
// Anahtar (tenant, sha256): içerik-adresli ve işletmeye bağlı.
export interface MenuMediaStore {
  put(tenantId: string, sha256: string, bytes: Uint8Array): Promise<void>;
  get(tenantId: string, sha256: string): Promise<Uint8Array | null>;
}

const SAFE_TENANT = /^tnt_[0-9A-Za-z]{1,40}$/;
const SAFE_HASH = /^[0-9a-f]{64}$/;

export function diskMenuMediaStore(root: string): MenuMediaStore {
  const location = (tenantId: string, sha256: string) => {
    // Yol bileşenleri doğrulanmadan diske inilmez; yol atlatma (../) mümkün değildir.
    if (!SAFE_TENANT.test(tenantId) || !SAFE_HASH.test(sha256)) throw new Error('Geçersiz görsel anahtarı.');
    return join(root, tenantId, sha256.slice(0, 2), `${sha256}.webp`);
  };
  return {
    async put(tenantId, sha256, bytes) {
      const target = location(tenantId, sha256);
      await mkdir(dirname(target), { recursive: true });
      // Yarım dosya hiç görünmesin: geçici dosyaya yazılıp atomik yeniden adlandırılır.
      const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`;
      await writeFile(temporary, bytes);
      await rename(temporary, target);
    },
    async get(tenantId, sha256) {
      try {
        return await readFile(location(tenantId, sha256));
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
        throw error;
      }
    },
  };
}
