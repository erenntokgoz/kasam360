/**
 * Kasam360 - Domain-Driven Deterministic Conflict Resolution Engine
 * Architecture: src/data/sync/DomainConflictResolver.ts
 *
 * Distributed Systems Mandate:
 * - STRIKE RULE: Naive Last-Write-Wins (LWW) is strictly prohibited.
 * - Enforces causal ordering via Vector Clocks.
 * - Executes line-level non-destructive reconciliation for concurrent POS orders.
 * - Enforces commutative delta convergence for inventory stock to prevent count corruption.
 */

import {
  ConflictDetail,
  ConflictResolutionResult,
  InventoryDeltaPayload,
  OrderLineItem,
  OrderSyncPayload,
  OutboxRecord,
} from './types';
import { VectorClockManager } from './VectorClockManager';

export class DomainConflictResolver {
  /**
   * Resolves concurrent mutations for POS Orders using deterministic line-level merging.
   * Eliminates data loss (e.g. concurrent item additions by two waitstaff on different terminals).
   *
   * @param localOrder Current local POS order state
   * @param remoteOrder Incoming remote POS order state
   * @param baseOrder Optional common ancestor snapshot (enables 3-way line delta merge)
   */
  public static resolveOrderConflict(
    localOrder: OrderSyncPayload,
    remoteOrder: OrderSyncPayload,
    baseOrder?: OrderSyncPayload
  ): ConflictResolutionResult<OrderSyncPayload> {
    const localClock = localOrder.vectorClock ?? {};
    const remoteClock = remoteOrder.vectorClock ?? {};
    const clockComparison = VectorClockManager.compare(localClock, remoteClock);

    // Causal baskınlık sapma olmadan mevcutsa, satır birleştirmeye gerek yoktur
    if (clockComparison === 'GREATER') {
      return {
        resolved: true,
        status: 'NO_CONFLICT',
        strategy: 'VECTOR_CLOCK_ORDERED',
        winner: 'LOCAL',
        mergedPayload: localOrder,
        mergedClock: VectorClockManager.clone(localClock),
        conflicts: [],
        reconciliationNotes: ['Local order causally dominates remote order.'],
      };
    }

    if (clockComparison === 'LESS') {
      return {
        resolved: true,
        status: 'NO_CONFLICT',
        strategy: 'VECTOR_CLOCK_ORDERED',
        winner: 'REMOTE',
        mergedPayload: remoteOrder,
        mergedClock: VectorClockManager.clone(remoteClock),
        conflicts: [],
        reconciliationNotes: ['Remote order causally dominates local order.'],
      };
    }

    // Her iki saat EŞİT ve yükler eşleşiyor
    if (
      clockComparison === 'EQUAL' &&
      JSON.stringify(localOrder.items) === JSON.stringify(remoteOrder.items) &&
      localOrder.status === remoteOrder.status
    ) {
      return {
        resolved: true,
        status: 'NO_CONFLICT',
        strategy: 'VECTOR_CLOCK_ORDERED',
        winner: 'LOCAL',
        mergedPayload: localOrder,
        mergedClock: VectorClockManager.clone(localClock),
        conflicts: [],
        reconciliationNotes: ['Local and remote orders are identical.'],
      };
    }

    // ==========================================
    // Deterministik Satır Düzeyinde Birleştirme Protokolü
    // ==========================================
    const conflicts: ConflictDetail[] = [];
    const notes: string[] = [];

    const localItemMap = new Map<string, OrderLineItem>();
    const remoteItemMap = new Map<string, OrderLineItem>();
    const baseItemMap = new Map<string, OrderLineItem>();

    for (const item of localOrder.items) {
      localItemMap.set(item.id, item);
    }
    for (const item of remoteOrder.items) {
      remoteItemMap.set(item.id, item);
    }
    if (baseOrder) {
      for (const item of baseOrder.items) {
        baseItemMap.set(item.id, item);
      }
    }

    const allItemIds = new Set([
      ...localItemMap.keys(),
      ...remoteItemMap.keys(),
      ...baseItemMap.keys(),
    ]);

    const mergedItems: OrderLineItem[] = [];

    for (const itemId of allItemIds) {
      const localItem = localItemMap.get(itemId);
      const remoteItem = remoteItemMap.get(itemId);
      const baseItem = baseItemMap.get(itemId);

      // Durum 1: Öğe yalnızca Yerel terminalde eklendi -> Kayıpsız koru
      if (localItem && !remoteItem && !baseItem) {
        mergedItems.push({ ...localItem });
        notes.push(`Line item '${localItem.name}' (${itemId}) added on local terminal retained.`);
        continue;
      }

      // Durum 2: Öğe yalnızca Uzak terminalde eklendi -> Kayıpsız koru
      if (!localItem && remoteItem && !baseItem) {
        mergedItems.push({ ...remoteItem });
        notes.push(`Line item '${remoteItem.name}' (${itemId}) added on remote terminal retained.`);
        continue;
      }

      // Durum 3: Temel anlık görüntüden sonra öğe bir terminalde kaldırıldı
      if (baseItem && (!localItem || !remoteItem)) {
        const removedOn = !localItem ? 'local' : 'remote';
        const preservedOn = localItem ? 'local' : 'remote';
        const candidateItem = localItem ?? remoteItem;

        // Kaldırılırken diğer dalda değiştirilirse, mutfak güvenlik denetimi için öğeyi İPTAL EDİLDİ olarak koru
        if (candidateItem && candidateItem.quantity !== baseItem.quantity) {
          mergedItems.push({
            ...candidateItem,
            status: 'CANCELLED',
            notes:
              `${candidateItem.notes ?? ''} [Audit: Removed on ${removedOn} while modified on ${preservedOn}]`.trim(),
          });
          conflicts.push({
            entityId: itemId,
            entityType: 'OrderLineItem',
            field: 'status',
            localValue: localItem?.status ?? 'DELETED',
            remoteValue: remoteItem?.status ?? 'DELETED',
            resolvedValue: 'CANCELLED',
            resolutionReason: `Line item removed on ${removedOn} terminal but quantity changed on ${preservedOn}; resolved to CANCELLED audit state.`,
          });
        } else {
          notes.push(`Line item (${itemId}) removed on ${removedOn} terminal respected.`);
        }
        continue;
      }

      // Durum 4: Öğe hem Yerel hem de Uzak'ta mevcut
      if (localItem && remoteItem) {
        let mergedQuantity = localItem.quantity;
        let lineStatus = localItem.status;

        // Satır düzeyinde miktar uzlaşması
        if (localItem.quantity !== remoteItem.quantity) {
          if (baseItem) {
            // Üç yönlü delta çözümü: temel + deltaA + deltaB
            const deltaLocal = localItem.quantity - baseItem.quantity;
            const deltaRemote = remoteItem.quantity - baseItem.quantity;
            mergedQuantity = Math.max(0, baseItem.quantity + deltaLocal + deltaRemote);
            notes.push(
              `Line item '${localItem.name}' quantity three-way merged from base ${baseItem.quantity} (Local: ${localItem.quantity}, Remote: ${remoteItem.quantity}) -> ${mergedQuantity}.`
            );
          } else {
            // İki yönlü değişmeli birleştirme: eşzamanlı eklemeleri güvenli bir şekilde birleştir
            mergedQuantity = Math.max(localItem.quantity, remoteItem.quantity);
            notes.push(
              `Line item '${localItem.name}' quantity merged via non-destructive upper bound (Local: ${localItem.quantity}, Remote: ${remoteItem.quantity}) -> ${mergedQuantity}.`
            );
          }

          conflicts.push({
            entityId: itemId,
            entityType: 'OrderLineItem',
            field: 'quantity',
            localValue: localItem.quantity,
            remoteValue: remoteItem.quantity,
            resolvedValue: mergedQuantity,
            resolutionReason:
              'Line-level deterministic quantity reconciliation without inventory loss.',
          });
        }

        // Satır düzeyinde durum uzlaşması: Müşteri faturalandırmasını korumak için İPTAL EDİLDİ/GEÇERSİZ KILINDI önceliklidir
        if (localItem.status !== remoteItem.status) {
          if (
            localItem.status === 'CANCELLED' ||
            remoteItem.status === 'CANCELLED' ||
            localItem.status === 'VOID' ||
            remoteItem.status === 'VOID'
          ) {
            lineStatus =
              localItem.status === 'VOID' || remoteItem.status === 'VOID' ? 'VOID' : 'CANCELLED';
          }
          conflicts.push({
            entityId: itemId,
            entityType: 'OrderLineItem',
            field: 'status',
            localValue: localItem.status,
            remoteValue: remoteItem.status,
            resolvedValue: lineStatus,
            resolutionReason:
              'Cancellation/Void status prioritized to prevent overcharging or unwanted preparation.',
          });
        }

        // Notlar uzlaşması: Yinelenmeyen talimatları birleştir
        const mergedNotes = [localItem.notes, remoteItem.notes]
          .filter((n): n is string => Boolean(n && n.trim().length > 0))
          .filter((n, idx, arr) => arr.indexOf(n) === idx)
          .join(' | ');

        // Değiştiriciler uzlaşması: Değiştiricileri çoğaltmadan birleştir
        const localModifiers = localItem.modifiers ?? [];
        const remoteModifiers = remoteItem.modifiers ?? [];
        const modMap = new Map<
          string,
          { id: string; name: string; price: number; quantity?: number }
        >();

        for (const mod of [...localModifiers, ...remoteModifiers]) {
          if (!modMap.has(mod.id)) {
            modMap.set(mod.id, { ...mod });
          } else {
            const existing = modMap.get(mod.id)!;
            existing.quantity = Math.max(existing.quantity ?? 1, mod.quantity ?? 1);
          }
        }

        const mergedUnitPrice = Math.max(localItem.unitPrice, remoteItem.unitPrice);
        const mergedTotalPrice = Number((mergedQuantity * mergedUnitPrice).toFixed(2));
        const mergedLineClock = VectorClockManager.merge(
          localItem.vectorClock ?? {},
          remoteItem.vectorClock ?? {}
        );

        mergedItems.push({
          id: itemId,
          productId: localItem.productId,
          name: localItem.name,
          quantity: mergedQuantity,
          unitPrice: mergedUnitPrice,
          totalPrice: mergedTotalPrice,
          taxRate: localItem.taxRate,
          status: lineStatus,
          notes: mergedNotes.length > 0 ? mergedNotes : undefined,
          modifiers: Array.from(modMap.values()),
          vectorClock: mergedLineClock,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // ==========================================
    // Finansal ve Sipariş Düzeyinde Yeniden Hesaplama
    // ==========================================
    let subtotal = 0;
    let taxTotal = 0;

    for (const item of mergedItems) {
      if (item.status === 'ACTIVE') {
        subtotal += item.totalPrice;
        taxTotal += Number((item.totalPrice * (item.taxRate / 100)).toFixed(2));
      }
    }

    subtotal = Number(subtotal.toFixed(2));
    taxTotal = Number(taxTotal.toFixed(2));
    const discountTotal = Math.max(localOrder.discountTotal ?? 0, remoteOrder.discountTotal ?? 0);
    const grandTotal = Math.max(0, Number((subtotal + taxTotal - discountTotal).toFixed(2)));

    // Sipariş durumu çözümü
    let finalOrderStatus: OrderSyncPayload['status'] = 'OPEN';
    if (localOrder.status === 'PAID' || remoteOrder.status === 'PAID') {
      finalOrderStatus = 'PAID';
    } else if (localOrder.status === 'CANCELLED' && remoteOrder.status === 'CANCELLED') {
      finalOrderStatus = 'CANCELLED';
    } else if (localOrder.status === 'SERVED' || remoteOrder.status === 'SERVED') {
      finalOrderStatus = 'SERVED';
    } else if (localOrder.status === 'IN_PREPARATION' || remoteOrder.status === 'IN_PREPARATION') {
      finalOrderStatus = 'IN_PREPARATION';
    }

    const mergedClock = VectorClockManager.merge(localClock, remoteClock);

    const mergedOrder: OrderSyncPayload = {
      id: localOrder.id,
      branchId: localOrder.branchId,
      terminalId: localOrder.terminalId,
      orderNumber: localOrder.orderNumber,
      tableNumber: localOrder.tableNumber ?? remoteOrder.tableNumber,
      customerCount: Math.max(localOrder.customerCount ?? 0, remoteOrder.customerCount ?? 0),
      status: finalOrderStatus,
      items: mergedItems,
      subtotal,
      taxTotal,
      discountTotal,
      grandTotal,
      vectorClock: mergedClock,
      createdAt: localOrder.createdAt,
      updatedAt: new Date().toISOString(),
    };

    return {
      resolved: true,
      status: 'RESOLVED',
      strategy: 'LINE_LEVEL_MERGE',
      winner: 'MERGED',
      mergedPayload: mergedOrder,
      mergedClock,
      conflicts,
      reconciliationNotes: notes,
    };
  }

  /**
   * Commutative Delta Merge for distributed inventory stock adjustments.
   * Eliminates stock count corruption across disconnected POS registers.
   *
   * @param localDelta Local terminal stock delta (e.g. -2 items sold)
   * @param remoteDelta Remote terminal stock delta (e.g. -3 items sold)
   */
  public static resolveInventoryConflict(
    localDelta: InventoryDeltaPayload,
    remoteDelta: InventoryDeltaPayload
  ): ConflictResolutionResult<InventoryDeltaPayload> {
    const localClock = localDelta.vectorClock ?? {};
    const remoteClock = remoteDelta.vectorClock ?? {};
    const comparison = VectorClockManager.compare(localClock, remoteClock);

    if (comparison === 'GREATER') {
      return {
        resolved: true,
        status: 'NO_CONFLICT',
        strategy: 'VECTOR_CLOCK_ORDERED',
        winner: 'LOCAL',
        mergedPayload: localDelta,
        mergedClock: VectorClockManager.clone(localClock),
        conflicts: [],
        reconciliationNotes: ['Local inventory delta causally dominates remote delta.'],
      };
    }

    if (comparison === 'LESS') {
      return {
        resolved: true,
        status: 'NO_CONFLICT',
        strategy: 'VECTOR_CLOCK_ORDERED',
        winner: 'REMOTE',
        mergedPayload: remoteDelta,
        mergedClock: VectorClockManager.clone(remoteClock),
        conflicts: [],
        reconciliationNotes: ['Remote inventory delta causally dominates local delta.'],
      };
    }

    // Bağımsız stok kesintilerinin değişmeli toplamı
    const mergedQuantityDelta = localDelta.quantityDelta + remoteDelta.quantityDelta;
    const mergedClock = VectorClockManager.merge(localClock, remoteClock);

    const mergedPayload: InventoryDeltaPayload = {
      productId: localDelta.productId,
      branchId: localDelta.branchId,
      quantityDelta: mergedQuantityDelta,
      reason: `Commutative merge [${localDelta.reason} + ${remoteDelta.reason}]`,
      referenceId: `${localDelta.referenceId}+${remoteDelta.referenceId}`,
      vectorClock: mergedClock,
      timestamp: new Date().toISOString(),
    };

    return {
      resolved: true,
      status: 'RESOLVED',
      strategy: 'COMMUTATIVE_DELTA',
      winner: 'MERGED',
      mergedPayload,
      mergedClock,
      conflicts: [
        {
          entityId: localDelta.productId,
          entityType: 'InventoryStock',
          field: 'quantityDelta',
          localValue: localDelta.quantityDelta,
          remoteValue: remoteDelta.quantityDelta,
          resolvedValue: mergedQuantityDelta,
          resolutionReason: 'Commutative addition of concurrent offline stock transactions.',
        },
      ],
      reconciliationNotes: [
        `Inventory stock deltas combined commutatively: ${localDelta.quantityDelta} + ${remoteDelta.quantityDelta} = ${mergedQuantityDelta}.`,
      ],
    };
  }

  /**
   * Generic outbox record conflict resolution router.
   */
  public static resolveRecordConflict(
    localRecord: OutboxRecord,
    remoteRecord: OutboxRecord
  ): ConflictResolutionResult<unknown> {
    const comparison = VectorClockManager.compare(
      localRecord.vectorClock,
      remoteRecord.vectorClock
    );

    if (comparison === 'GREATER') {
      return {
        resolved: true,
        status: 'NO_CONFLICT',
        strategy: 'VECTOR_CLOCK_ORDERED',
        winner: 'LOCAL',
        mergedPayload: localRecord.payload,
        mergedClock: VectorClockManager.clone(localRecord.vectorClock),
        conflicts: [],
        reconciliationNotes: ['Local record causally dominates.'],
      };
    }

    if (comparison === 'LESS') {
      return {
        resolved: true,
        status: 'NO_CONFLICT',
        strategy: 'VECTOR_CLOCK_ORDERED',
        winner: 'REMOTE',
        mergedPayload: remoteRecord.payload,
        mergedClock: VectorClockManager.clone(remoteRecord.vectorClock),
        conflicts: [],
        reconciliationNotes: ['Remote record causally dominates.'],
      };
    }

    // Eşzamanlı sipariş mutasyonu
    if (localRecord.aggregateType === 'ORDER') {
      if (isOrderSyncPayload(localRecord.payload) && isOrderSyncPayload(remoteRecord.payload)) {
        return DomainConflictResolver.resolveOrderConflict(
          localRecord.payload,
          remoteRecord.payload
        );
      }
    }

    // Eşzamanlı envanter mutasyonu
    if (localRecord.aggregateType === 'INVENTORY') {
      if (
        isInventoryDeltaPayload(localRecord.payload) &&
        isInventoryDeltaPayload(remoteRecord.payload)
      ) {
        return DomainConflictResolver.resolveInventoryConflict(
          localRecord.payload,
          remoteRecord.payload
        );
      }
    }

    // Geri dönüş: vektör saatlerini birleştir ve manuel müdahale gerektiren çatışmayı günlüğe kaydet
    const mergedClock = VectorClockManager.merge(localRecord.vectorClock, remoteRecord.vectorClock);

    return {
      resolved: false,
      status: 'CONFLICT_DETECTED',
      strategy: 'MANUAL_INTERVENTION_REQUIRED',
      mergedClock,
      conflicts: [
        {
          entityId: localRecord.aggregateId,
          entityType: localRecord.aggregateType,
          localValue: localRecord.payload,
          remoteValue: remoteRecord.payload,
          resolutionReason: `Unsupported automated merge for aggregate type '${localRecord.aggregateType}'. Flagged for supervisor resolution.`,
        },
      ],
      reconciliationNotes: [
        'Concurrent branch divergence detected without specialized domain handler.',
      ],
    };
  }
}

/**
 * Runtime type guard asserting whether an unknown payload conforms to OrderSyncPayload.
 */
export function isOrderSyncPayload(payload: unknown): payload is OrderSyncPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.branchId === 'string' &&
    typeof candidate.terminalId === 'string' &&
    typeof candidate.orderNumber === 'string' &&
    typeof candidate.status === 'string' &&
    Array.isArray(candidate.items) &&
    typeof candidate.subtotal === 'number' &&
    typeof candidate.taxTotal === 'number' &&
    typeof candidate.grandTotal === 'number' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}

/**
 * Runtime type guard asserting whether an unknown payload conforms to InventoryDeltaPayload.
 */
export function isInventoryDeltaPayload(payload: unknown): payload is InventoryDeltaPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.productId === 'string' &&
    typeof candidate.branchId === 'string' &&
    typeof candidate.quantityDelta === 'number' &&
    typeof candidate.reason === 'string' &&
    typeof candidate.referenceId === 'string' &&
    typeof candidate.timestamp === 'string'
  );
}
