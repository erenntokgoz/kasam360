export interface InventoryBatchCore {
  id: string;
  ingredientId: string;
  receivedAt: string;
  expirationDate?: string;
  unitCost: number;
  remainingQuantity: number;
}

export interface FifoAllocationCore {
  batchId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

export interface FifoConsumptionResultCore {
  ingredientId: string;
  requestedQuantity: number;
  consumedQuantity: number;
  totalCogs: number;
  blendedUnitCost: number;
  allocations: FifoAllocationCore[];
  remainingDeficit: number;
  updatedBatches: InventoryBatchCore[];
}

/**
 * Partileri FIFO kurallarına göre (en eski ilk) kronolojik olarak artan sırada sıralar.
 * Saf bir etki alanı (domain) işlevi olarak çıkarılmıştır.
 */
export function sortBatchesFifo<T extends Pick<InventoryBatchCore, 'id' | 'receivedAt'>>(
  batches: T[]
): T[] {
  return [...batches].sort((a, b) => {
    const timeDiff = new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Aktif envanter partilerinde FIFO yöntemini kullanarak tek bir bileşen için stok tüketir.
 * Tahsisleri, toplam harmanlanmış SMM'yi (COGS), kalan açığı (varsa) ve güncellenmiş parti durumunu döndürür.
 * Saf, deterministik bir etki alanı (domain) işlevi olarak çıkarılmıştır.
 */
export function consumeStockFifo(
  allBatches: InventoryBatchCore[],
  ingredientId: string,
  quantityToConsume: number,
  nowMs: number = Date.now()
): FifoConsumptionResultCore {
  if (quantityToConsume <= 0) {
    return {
      ingredientId,
      requestedQuantity: quantityToConsume,
      consumedQuantity: 0,
      totalCogs: 0,
      blendedUnitCost: 0,
      allocations: [],
      remainingDeficit: 0,
      updatedBatches: allBatches.map((b) => ({ ...b })),
    };
  }

  // Değişmezliği korumak için tüm partileri kopyala
  const batchCopies: InventoryBatchCore[] = allBatches.map((b) => ({ ...b }));

  // Bu bileşen için ilgili partileri ayıkla ve sırala
  const eligibleBatches = sortBatchesFifo(
    batchCopies.filter(
      (b) =>
        b.ingredientId === ingredientId &&
        b.remainingQuantity > 0 &&
        (!b.expirationDate || new Date(b.expirationDate).getTime() > nowMs)
    )
  );

  let needed = quantityToConsume;
  let totalCogs = 0;
  const allocations: FifoAllocationCore[] = [];

  for (const batch of eligibleBatches) {
    if (needed <= 0) break;

    const takeQty = Math.min(batch.remainingQuantity, needed);
    const allocationCost = Math.round(takeQty * batch.unitCost * 10000) / 10000;

    // Tam kopyalanmış dizideki kalan parti miktarını güncelle
    const targetInCopies = batchCopies.find((b) => b.id === batch.id);
    if (targetInCopies) {
      targetInCopies.remainingQuantity =
        Math.round((targetInCopies.remainingQuantity - takeQty) * 10000) / 10000;
    }

    allocations.push({
      batchId: batch.id,
      quantity: takeQty,
      unitCost: batch.unitCost,
      totalCost: allocationCost,
    });

    totalCogs += allocationCost;
    needed = Math.round((needed - takeQty) * 10000) / 10000;
  }

  const consumedQuantity = Math.round((quantityToConsume - needed) * 10000) / 10000;
  const blendedUnitCost =
    consumedQuantity > 0 ? Math.round((totalCogs / consumedQuantity) * 10000) / 10000 : 0;

  return {
    ingredientId,
    requestedQuantity: quantityToConsume,
    consumedQuantity,
    totalCogs: Math.round(totalCogs * 10000) / 10000,
    blendedUnitCost,
    allocations,
    remainingDeficit: Math.max(0, needed),
    updatedBatches: batchCopies,
  };
}
