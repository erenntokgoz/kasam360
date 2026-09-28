import {
  AuditEntry,
  CreateAuditEntryInput,
  HashChainValidationError,
  HashChainValidationResult,
} from './types';

/**
 * Deterministic standard FIPS 180-4 SHA-256 implementation.
 * Guarantees consistent cryptographic hashing across all platforms and runtimes without external dependencies.
 */
export function calculateSha256(input: string): string {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }

  const K: readonly number[] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const utf8: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let charcode = input.charCodeAt(i);
    if (charcode < 0x80) {
      utf8.push(charcode);
    } else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
    } else {
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (input.charCodeAt(i) & 0x3ff));
      utf8.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }

  const bitLength = utf8.length * 8;
  utf8.push(0x80);
  while ((utf8.length + 8) % 64 !== 0) {
    utf8.push(0x00);
  }

  const highBits = Math.floor(bitLength / 0x100000000);
  const lowBits = bitLength >>> 0;
  for (let i = 3; i >= 0; i--) {
    utf8.push((highBits >>> (i * 8)) & 0xff);
  }
  for (let i = 3; i >= 0; i--) {
    utf8.push((lowBits >>> (i * 8)) & 0xff);
  }

  const w = new Array<number>(64);
  for (let chunk = 0; chunk < utf8.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        (utf8[chunk + i * 4] << 24) |
        (utf8[chunk + i * 4 + 1] << 16) |
        (utf8[chunk + i * 4 + 2] << 8) |
        utf8[chunk + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[i] + w[i]) | 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${toHex(h0)}${toHex(h1)}${toHex(h2)}${toHex(h3)}${toHex(h4)}${toHex(h5)}${toHex(h6)}${toHex(h7)}`;
}

/**
 * Deterministic canonical JSON serializer.
 * Recursively sorts keys so object serialization produces consistent byte streams.
 */
export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJsonStringify).join(',')}]`;
  }
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`);
  return `{${pairs.join(',')}}`;
}

/**
 * Cryptographic Hash Chain Builder and Verification Engine
 * Enforces cryptographic linking, tamper detection, and sequence gap verification.
 */
export class HashChainBuilder {
  public static readonly GENESIS_HASH =
    '0000000000000000000000000000000000000000000000000000000000000000';

  private entries: AuditEntry[] = [];

  constructor(initialEntries: readonly AuditEntry[] = []) {
    if (initialEntries.length > 0) {
      const validation = HashChainBuilder.verifyChain(initialEntries);
      if (!validation.isValid) {
        throw new Error(
          `Cannot initialize HashChainBuilder with corrupted ledger chain: ${validation.errors[0]?.message ?? 'Integrity validation failed'}`
        );
      }
      this.entries = [...initialEntries];
    }
  }

  /**
   * Computes the deterministic SHA-256 hash for an audit entry.
   * Explicitly binds sequence, previous_hash, timestamp, actor, action, resource, payload, and metadata.
   */
  public static calculateHash(params: {
    sequence: number;
    timestamp: string;
    actor_id: string;
    actor_role: string;
    action: string;
    resource_id: string;
    payload: Record<string, unknown>;
    previous_hash: string;
    metadata?: Record<string, unknown>;
  }): string {
    const canonicalPayload = canonicalJsonStringify(params.payload ?? {});
    const canonicalMetadata = params.metadata ? canonicalJsonStringify(params.metadata) : '{}';

    const rawDigestPayload = [
      params.sequence.toString(),
      params.previous_hash,
      params.timestamp,
      params.actor_id,
      params.actor_role,
      params.action,
      params.resource_id,
      canonicalPayload,
      canonicalMetadata,
    ].join('|');

    return calculateSha256(rawDigestPayload);
  }

  /**
   * Generates a securely chained AuditEntry linking directly to its predecessor.
   */
  public static buildNextEntry(
    input: CreateAuditEntryInput,
    previousEntry: AuditEntry | null
  ): AuditEntry {
    const sequence = previousEntry ? previousEntry.sequence + 1 : 1;
    const previous_hash = previousEntry
      ? previousEntry.current_hash
      : HashChainBuilder.GENESIS_HASH;
    const timestamp = input.timestamp ?? new Date().toISOString();
    const id =
      input.id ??
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `aud-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

    const current_hash = HashChainBuilder.calculateHash({
      sequence,
      timestamp,
      actor_id: input.actor_id,
      actor_role: input.actor_role,
      action: input.action,
      resource_id: input.resource_id,
      payload: input.payload,
      previous_hash,
      metadata: input.metadata,
    });

    return {
      id,
      sequence,
      timestamp,
      actor_id: input.actor_id,
      actor_role: input.actor_role,
      action: input.action,
      resource_id: input.resource_id,
      payload: input.payload,
      previous_hash,
      current_hash,
      metadata: input.metadata,
    };
  }

  /**
   * Iterates through the ledger to detect broken links, retroactive payload tampering, or sequence gaps.
   */
  public static verifyChain(entries: readonly AuditEntry[]): HashChainValidationResult {
    const errors: HashChainValidationError[] = [];

    if (entries.length === 0) {
      return {
        isValid: true,
        totalEntries: 0,
        verifiedEntries: 0,
        errors: [],
      };
    }

    let previousEntry: AuditEntry | null = null;
    let verifiedCount = 0;

    for (let i = 0; i < entries.length; i++) {
      const current = entries[i];

      // 1. Dizi Boşluğu Doğrulaması
      const expectedSequence = previousEntry ? previousEntry.sequence + 1 : 1;
      if (current.sequence !== expectedSequence) {
        errors.push({
          type: 'SEQUENCE_GAP',
          index: i,
          entryId: current.id,
          sequence: current.sequence,
          expected: expectedSequence,
          actual: current.sequence,
          message: `Sequence gap detected at index ${i}. Expected sequence ${expectedSequence}, encountered ${current.sequence}.`,
        });
      }

      // 2. Genesis ve Zincirlenmiş Bağlantı Doğrulaması
      const expectedPreviousHash = previousEntry
        ? previousEntry.current_hash
        : HashChainBuilder.GENESIS_HASH;

      if (current.previous_hash !== expectedPreviousHash) {
        errors.push({
          type: i === 0 ? 'GENESIS_MISMATCH' : 'BROKEN_LINK',
          index: i,
          entryId: current.id,
          sequence: current.sequence,
          expected: expectedPreviousHash,
          actual: current.previous_hash,
          message:
            i === 0
              ? `Genesis hash mismatch at index 0. Expected ${expectedPreviousHash}, encountered ${current.previous_hash}.`
              : `Broken hash chain link at index ${i}. Expected previous_hash ${expectedPreviousHash}, encountered ${current.previous_hash}.`,
        });
      }

      // 3. Geriye Dönük Yük Kurcalama Doğrulaması
      const calculatedCurrentHash = HashChainBuilder.calculateHash({
        sequence: current.sequence,
        timestamp: current.timestamp,
        actor_id: current.actor_id,
        actor_role: current.actor_role,
        action: current.action,
        resource_id: current.resource_id,
        payload: current.payload,
        previous_hash: current.previous_hash,
        metadata: current.metadata,
      });

      if (current.current_hash !== calculatedCurrentHash) {
        errors.push({
          type: 'PAYLOAD_TAMPERED',
          index: i,
          entryId: current.id,
          sequence: current.sequence,
          expected: calculatedCurrentHash,
          actual: current.current_hash,
          message: `Cryptographic payload tampering detected at sequence ${current.sequence} (id: ${current.id}). Stored hash '${current.current_hash}' does not match computed digest '${calculatedCurrentHash}'.`,
        });
      }

      // 4. Kronolojik Monotonluk Kontrolü
      if (previousEntry) {
        const prevTime = new Date(previousEntry.timestamp).getTime();
        const currTime = new Date(current.timestamp).getTime();
        if (!isNaN(prevTime) && !isNaN(currTime) && currTime < prevTime) {
          errors.push({
            type: 'INVALID_TIMESTAMP_ORDER',
            index: i,
            entryId: current.id,
            sequence: current.sequence,
            expected: `>= ${previousEntry.timestamp}`,
            actual: current.timestamp,
            message: `Chronological violation detected at index ${i}. Timestamp '${current.timestamp}' precedes predecessor '${previousEntry.timestamp}'.`,
          });
        }
      }

      if (errors.length === 0) {
        verifiedCount++;
      }

      previousEntry = current;
    }

    return {
      isValid: errors.length === 0,
      totalEntries: entries.length,
      verifiedEntries: verifiedCount,
      errors,
    };
  }

  /**
   * Appends a new entry to the active builder chain.
   */
  public append(input: CreateAuditEntryInput): AuditEntry {
    const latest = this.getLatestEntry();
    const newEntry = HashChainBuilder.buildNextEntry(input, latest);
    this.entries.push(newEntry);
    return newEntry;
  }

  /**
   * Retrieves the current tip of the hash chain.
   */
  public getLatestEntry(): AuditEntry | null {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1] : null;
  }

  /**
   * Retrieves all entries currently held by this builder.
   */
  public getChain(): readonly AuditEntry[] {
    return [...this.entries];
  }

  /**
   * Verifies the cryptographic integrity of the internal chain.
   */
  public verify(): HashChainValidationResult {
    return HashChainBuilder.verifyChain(this.entries);
  }
}
