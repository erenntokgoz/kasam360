import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

// ULID: zaman önde durur; kayıtlar oluşturulma sırasıyla dizilir.
export function ulid(now = Date.now()): string {
  let time = '';
  for (let value = now, index = 0; index < 10; index += 1) {
    time = CROCKFORD[value % 32] + time;
    value = Math.floor(value / 32);
  }
  const random = [...randomBytes(16)].map((byte) => CROCKFORD[byte % 32]).join('');
  return time + random;
}

const PREFIXES: Record<string, string> = {
  user: 'usr', session: 'ses', account: 'acc', verification: 'ver', tenant: 'tnt', membership: 'mem',
  qr_menu_slug: 'qms', qr_menu_publication: 'qmp', qr_menu_image: 'qmi',
};

export const prefixedId = (model: string) => `${PREFIXES[model] ?? 'rec'}_${ulid()}`;
