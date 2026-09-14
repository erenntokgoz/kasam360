/**
 * Kasam360 - Enterprise Vector Clock Engine
 * Architecture: src/data/sync/VectorClockManager.ts
 *
 * Distributed Systems Mandate:
 * Eliminates physical wall-clock drift hazards across distributed POS terminals.
 * Tracks causal ordering (Happened-Before relation) deterministically via logical vector clocks.
 */

import { VectorClock, VectorClockComparison } from './types';

export class VectorClockManager {
  private readonly terminalId: string;
  private clock: VectorClock;

  public constructor(terminalId: string, initialClock: VectorClock = {}) {
    if (!terminalId || terminalId.trim().length === 0) {
      throw new Error('VectorClockManager requires a valid, non-empty terminalId.');
    }
    this.terminalId = terminalId.trim();
    this.clock = VectorClockManager.clone(initialClock);

    // Yerel terminalin mantıksal saatte mevcut olduğundan emin ol
    if (this.clock[this.terminalId] === undefined) {
      this.clock[this.terminalId] = 0;
    }
  }

  /**
   * Returns current terminal identifier.
   */
  public getTerminalId(): string {
    return this.terminalId;
  }

  /**
   * Returns a deep immutable snapshot of the active vector clock.
   */
  public getClock(): VectorClock {
    return VectorClockManager.clone(this.clock);
  }

  /**
   * Overwrites the internal clock state with a validated vector clock.
   */
  public setClock(clock: VectorClock): void {
    const cloned = VectorClockManager.clone(clock);
    if (cloned[this.terminalId] === undefined) {
      cloned[this.terminalId] = this.clock[this.terminalId] ?? 0;
    }
    this.clock = cloned;
  }

  /**
   * Advances the local terminal's logical clock tick upon an internal state mutation.
   * Monotonically increases the local counter.
   */
  public tick(): VectorClock {
    const currentVal = this.clock[this.terminalId] ?? 0;
    this.clock[this.terminalId] = currentVal + 1;
    return this.getClock();
  }

  /**
   * Merges an incoming remote vector clock via component-wise maximum
   * without unconditionally incrementing the local terminal tick counter.
   */
  public update(remoteClock: VectorClock): VectorClock {
    this.clock = VectorClockManager.merge(this.clock, remoteClock);
    return this.getClock();
  }

  // ==========================================
  // Deterministic Static Operations
  // ==========================================

  /**
   * Computes component-wise maximum across the union of all terminal keys.
   */
  public static merge(clockA: VectorClock, clockB: VectorClock): VectorClock {
    const result: VectorClock = {};
    const allKeys = new Set([...Object.keys(clockA), ...Object.keys(clockB)]);

    for (const key of allKeys) {
      const valA = clockA[key] ?? 0;
      const valB = clockB[key] ?? 0;
      result[key] = Math.max(valA, valB);
    }

    return result;
  }

  /**
   * Compares two vector clocks to determine causal relationship.
   *
   * - 'EQUAL': A and B are causally identical.
   * - 'GREATER': A happened after B (A causally dominates B, B is ancestor of A).
   * - 'LESS': A happened before B (A is ancestor of B, B causally dominates A).
   * - 'CONCURRENT': Independent concurrent divergence (requires domain-level merge).
   */
  public static compare(clockA: VectorClock, clockB: VectorClock): VectorClockComparison {
    const allKeys = new Set([...Object.keys(clockA), ...Object.keys(clockB)]);

    let aHasGreater = false;
    let bHasGreater = false;

    for (const key of allKeys) {
      const valA = clockA[key] ?? 0;
      const valB = clockB[key] ?? 0;

      if (valA > valB) {
        aHasGreater = true;
      } else if (valB > valA) {
        bHasGreater = true;
      }
    }

    if (aHasGreater && bHasGreater) {
      return 'CONCURRENT';
    }
    if (aHasGreater && !bHasGreater) {
      return 'GREATER';
    }
    if (!aHasGreater && bHasGreater) {
      return 'LESS';
    }
    return 'EQUAL';
  }

  /**
   * Checks whether two vector clocks are concurrent (causally conflicting).
   */
  public static isConcurrent(clockA: VectorClock, clockB: VectorClock): boolean {
    return VectorClockManager.compare(clockA, clockB) === 'CONCURRENT';
  }

  /**
   * Checks whether clockA strictly happened before clockB (clockA is an ancestor of clockB).
   */
  public static happenedBefore(clockA: VectorClock, clockB: VectorClock): boolean {
    return VectorClockManager.compare(clockA, clockB) === 'LESS';
  }

  /**
   * Checks whether clockA strictly happened after clockB (clockA dominates clockB).
   */
  public static happenedAfter(clockA: VectorClock, clockB: VectorClock): boolean {
    return VectorClockManager.compare(clockA, clockB) === 'GREATER';
  }

  /**
   * Checks whether two vector clocks are equal across all keys.
   */
  public static areEqual(clockA: VectorClock, clockB: VectorClock): boolean {
    return VectorClockManager.compare(clockA, clockB) === 'EQUAL';
  }

  /**
   * Performs deep clone of a vector clock structure.
   */
  public static clone(clock: VectorClock): VectorClock {
    const clone: VectorClock = {};
    for (const key of Object.keys(clock)) {
      const val = clock[key];
      if (typeof val === 'number' && !Number.isNaN(val) && val >= 0) {
        clone[key] = Math.floor(val);
      }
    }
    return clone;
  }

  /**
   * Canonical deterministic serialization with alphabetically sorted terminal keys.
   */
  public static serialize(clock: VectorClock): string {
    const sortedKeys = Object.keys(clock).sort();
    const sortedObj: VectorClock = {};
    for (const key of sortedKeys) {
      sortedObj[key] = clock[key];
    }
    return JSON.stringify(sortedObj);
  }

  /**
   * Deserializes a raw JSON string into a validated vector clock.
   */
  public static deserialize(raw: string): VectorClock {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      return VectorClockManager.clone(parsed as VectorClock);
    } catch {
      return {};
    }
  }
}
