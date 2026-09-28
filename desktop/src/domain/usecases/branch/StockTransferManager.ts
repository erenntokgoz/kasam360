import { BranchIsolationGuard, IsolationViolationException } from './BranchIsolationGuard';
import {
  BranchInventoryBatch,
  StockTransferAuditEntry,
  StockTransferExecutionResult,
  StockTransferItem,
  StockTransferRequest,
  StockTransferTransaction,
  TenantBranchContext,
} from './types';

export class StockTransferException extends Error {
  constructor(
    message: string,
    public readonly transactionId?: string,
    public readonly details?: unknown
  ) {
    super(`[STOCK_TRANSFER_ERROR] ${message}`);
    this.name = 'StockTransferException';
    Object.setPrototypeOf(this, StockTransferException.prototype);
  }
}

export class StockTransferManager {
  /**
   * Çakışmaya dayanıklı benzersiz bir tanımlayıcı oluşturur.
   */
  private static generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Partileri FIFO kurallarına göre sıralar (en eski alınan tarih önce).
   */
  private static sortBatchesFifo(batches: BranchInventoryBatch[]): BranchInventoryBatch[] {
    return [...batches].sort((a, b) => {
      const timeDiff = new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });
  }

  /**
   * İşlem tamamlanana kadar işlemsel değişmezliği garanti etmek için bir envanter partileri listesini kopyalar.
   */
  private static cloneBatches(batches: BranchInventoryBatch[]): BranchInventoryBatch[] {
    return batches.map((batch) => ({ ...batch }));
  }

  /**
   * Aşama 1 (Çıkış Transferi): İstenen malzemeleri FIFO kullanarak kaynak şube partilerinden düşer.
   * Bir IN_TRANSIT transfer işlemi oluşturur.
   * Envanter yetersizse veya bir hata oluşursa, kaynak durumu tamamen değiştirilmeden bırakılır.
   */
  public static initiateAndDeductTransfer(
    sourceBatches: BranchInventoryBatch[],
    request: StockTransferRequest,
    context?: TenantBranchContext
  ): {
    transaction: StockTransferTransaction;
    updatedSourceBatches: BranchInventoryBatch[];
  } {
    const ctx = BranchIsolationGuard.resolveContext(context);
    BranchIsolationGuard.assertCrossBranchTransferAllowed(
      request.sourceBranchId,
      request.destinationBranchId,
      ctx
    );

    if (!request.items || request.items.length === 0) {
      throw new StockTransferException('Transfer request must contain at least one item.');
    }

    const transactionId = StockTransferManager.generateId('tx_trf');
    const timestamp = new Date().toISOString();
    const workingSourceBatches = StockTransferManager.cloneBatches(sourceBatches);
    const transferItems: StockTransferItem[] = [];
    let totalTransferValue = 0;

    // İstenen her ürün için stok doğrulayın ve düşün
    for (const reqItem of request.items) {
      if (reqItem.quantity <= 0) {
        throw new StockTransferException(
          `Invalid transfer quantity [${reqItem.quantity}] for ingredient [${reqItem.ingredientId}]. Must be > 0.`,
          transactionId
        );
      }

      // Bu malzeme ve kiracı için kaynak şubedeki aktif partileri filtrele
      const matchingBatches = StockTransferManager.sortBatchesFifo(
        workingSourceBatches.filter(
          (b) =>
            b.tenantId === ctx.tenantId &&
            b.branchId === request.sourceBranchId &&
            b.ingredientId === reqItem.ingredientId &&
            b.remainingQuantity > 0
        )
      );

      let remainingToDeduct = reqItem.quantity;
      let itemAllocatedCost = 0;

      for (const batch of matchingBatches) {
        if (remainingToDeduct <= 0) break;

        const deductQty = Math.min(batch.remainingQuantity, remainingToDeduct);
        const lineCost = Math.round(deductQty * batch.unitCost * 10000) / 10000;

        batch.remainingQuantity = Math.round((batch.remainingQuantity - deductQty) * 10000) / 10000;
        itemAllocatedCost += lineCost;
        remainingToDeduct = Math.round((remainingToDeduct - deductQty) * 10000) / 10000;

        transferItems.push({
          ingredientId: reqItem.ingredientId,
          ingredientName: reqItem.ingredientName || reqItem.ingredientId,
          quantity: deductQty,
          unit: reqItem.unit,
          unitCost: batch.unitCost,
          totalCost: lineCost,
          sourceBatchId: batch.id,
        });
      }

      if (remainingToDeduct > 0) {
        throw new StockTransferException(
          `Insufficient inventory at branch [${request.sourceBranchId}] for ingredient [${reqItem.ingredientId}]. Deficit: ${remainingToDeduct} ${reqItem.unit}.`,
          transactionId
        );
      }

      totalTransferValue += itemAllocatedCost;
    }

    totalTransferValue = Math.round(totalTransferValue * 10000) / 10000;

    const initialAudit: StockTransferAuditEntry = {
      timestamp,
      phase: 'OUT_DEDUCTED',
      status: 'IN_TRANSIT',
      userId: ctx.userId,
      action: 'INITIATE_AND_DEDUCT',
      details: `Deducted ${transferItems.length} allocation lines valued at ${totalTransferValue} from branch ${request.sourceBranchId}.`,
    };

    const transaction: StockTransferTransaction = {
      id: transactionId,
      tenantId: ctx.tenantId,
      sourceBranchId: request.sourceBranchId,
      destinationBranchId: request.destinationBranchId,
      status: 'IN_TRANSIT',
      phase: 'OUT_DEDUCTED',
      items: transferItems,
      totalValue: totalTransferValue,
      initiatedBy: request.initiatedBy || ctx.userId,
      dispatchedAt: timestamp,
      notes: request.notes,
      auditTrail: [initialAudit],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return {
      transaction,
      updatedSourceBatches: workingSourceBatches,
    };
  }

  /**
   * Aşama 2 (Giriş Transferi): Transit halindeki ürünleri alır ve bunları hedef şube partilerine kaydeder.
   * Envanter değerlemesinin korunmasını sağlamak için kaynaktan gelen kesin birim maliyetlerini korur.
   */
  public static receiveAndCommitTransfer(
    destinationBatches: BranchInventoryBatch[],
    transaction: StockTransferTransaction,
    context?: TenantBranchContext
  ): {
    transaction: StockTransferTransaction;
    updatedDestinationBatches: BranchInventoryBatch[];
  } {
    const ctx = BranchIsolationGuard.resolveContext(context);
    BranchIsolationGuard.assertTenantAccess(transaction.tenantId, ctx);

    if (transaction.status !== 'IN_TRANSIT' || transaction.phase !== 'OUT_DEDUCTED') {
      throw new StockTransferException(
        `Cannot receive transfer in status [${transaction.status}] / phase [${transaction.phase}]. Expected IN_TRANSIT / OUT_DEDUCTED.`,
        transaction.id
      );
    }

    // Hedef doğrulama
    if (transaction.destinationBranchId !== ctx.branchId && !ctx.isCentralAdmin) {
      throw new IsolationViolationException(
        `User at branch [${ctx.branchId}] unauthorized to receive stock destined for [${transaction.destinationBranchId}].`
      );
    }

    const timestamp = new Date().toISOString();
    const workingDestBatches = StockTransferManager.cloneBatches(destinationBatches);
    const updatedItems: StockTransferItem[] = [];

    // Kesin maliyet tabanını koruyarak hedef şubede yeni partiler oluştur
    for (const item of transaction.items) {
      const destBatchId = StockTransferManager.generateId('batch_dest');

      const newBatch: BranchInventoryBatch = {
        id: destBatchId,
        tenantId: transaction.tenantId,
        branchId: transaction.destinationBranchId,
        ingredientId: item.ingredientId,
        receivedAt: timestamp,
        initialQuantity: item.quantity,
        remainingQuantity: item.quantity,
        unitCost: item.unitCost,
        unit: item.unit,
        batchNumber: `TRF-${transaction.id.substring(0, 12)}`,
      };

      workingDestBatches.push(newBatch);

      updatedItems.push({
        ...item,
        destinationBatchId: destBatchId,
      });
    }

    const commitAudit: StockTransferAuditEntry = {
      timestamp,
      phase: 'COMMITTED',
      status: 'COMPLETED',
      userId: ctx.userId,
      action: 'RECEIVE_AND_COMMIT',
      details: `Received and committed ${updatedItems.length} inventory batches to branch ${transaction.destinationBranchId}.`,
    };

    const committedTransaction: StockTransferTransaction = {
      ...transaction,
      status: 'COMPLETED',
      phase: 'COMMITTED',
      items: updatedItems,
      receivedBy: ctx.userId,
      receivedAt: timestamp,
      auditTrail: [...transaction.auditTrail, commitAudit],
      updatedAt: timestamp,
    };

    return {
      transaction: committedTransaction,
      updatedDestinationBatches: workingDestBatches,
    };
  }

  /**
   * ACID Geri Alma Motoru:
   * Uçuş ortası arızaları veya açık ret durumunda bir transfer işlemini tamamen geri alır.
   * Düşülen miktarları kaynak partilerine geri yükler ve oluşturulan hedef partileri siler.
   */
  public static rollbackTransfer(
    transaction: StockTransferTransaction,
    currentSourceBatches: BranchInventoryBatch[],
    currentDestinationBatches: BranchInventoryBatch[],
    reason: string,
    userId?: string
  ): {
    rolledBackTransaction: StockTransferTransaction;
    restoredSourceBatches: BranchInventoryBatch[];
    restoredDestinationBatches: BranchInventoryBatch[];
  } {
    const timestamp = new Date().toISOString();
    const restoredSource = StockTransferManager.cloneBatches(currentSourceBatches);
    const destinationIdsToRemove = new Set(
      transaction.items.map((i) => i.destinationBatchId).filter((id): id is string => Boolean(id))
    );

    // 1. Kaynak şube parti miktarlarını geri yükle
    for (const item of transaction.items) {
      if (item.sourceBatchId) {
        const sourceBatch = restoredSource.find((b) => b.id === item.sourceBatchId);
        if (sourceBatch) {
          sourceBatch.remainingQuantity =
            Math.round((sourceBatch.remainingQuantity + item.quantity) * 10000) / 10000;
        } else {
          // Orijinal parti temizlendiyse, stok sızıntısını önlemek için telafi partisini yeniden oluşturun
          restoredSource.push({
            id: item.sourceBatchId,
            tenantId: transaction.tenantId,
            branchId: transaction.sourceBranchId,
            ingredientId: item.ingredientId,
            receivedAt: timestamp,
            initialQuantity: item.quantity,
            remainingQuantity: item.quantity,
            unitCost: item.unitCost,
            unit: item.unit,
            batchNumber: `ROLLBACK-COMPENSATING-${transaction.id}`,
          });
        }
      }
    }

    // 2. Kredilendirilmişse hedef partileri kaldırın
    const restoredDestination = currentDestinationBatches.filter(
      (b) => !destinationIdsToRemove.has(b.id)
    );

    const rollbackAudit: StockTransferAuditEntry = {
      timestamp,
      phase: 'ABORTED',
      status: 'ROLLED_BACK',
      userId: userId || transaction.initiatedBy,
      action: 'ACID_ROLLBACK',
      details: `Transaction rolled back completely. Reason: ${reason}`,
    };

    const rolledBackTransaction: StockTransferTransaction = {
      ...transaction,
      status: 'ROLLED_BACK',
      phase: 'ABORTED',
      rollbackReason: reason,
      auditTrail: [...transaction.auditTrail, rollbackAudit],
      updatedAt: timestamp,
    };

    return {
      rolledBackTransaction,
      restoredSourceBatches: restoredSource,
      restoredDestinationBatches: restoredDestination,
    };
  }

  /**
   * Atomik İki Aşamalı Doğrudan Transfer:
   * Kaynaktan düşme ve hedefe alma işlemlerini tek bir ACID işlem ardışık düzeninde yürütür.
   * Herhangi bir adım başarısız olursa, hayalet stok veya envanter sızıntısı oluşmaması için otomatik olarak tam geri almayı tetikler.
   */
  public static executeDirectTransfer(
    sourceBatches: BranchInventoryBatch[],
    destinationBatches: BranchInventoryBatch[],
    request: StockTransferRequest,
    context?: TenantBranchContext
  ): StockTransferExecutionResult {
    const ctx = BranchIsolationGuard.resolveContext(context);

    // ACID geri alma garantisi için temel durumu takip edin
    const initialSourceSnap = StockTransferManager.cloneBatches(sourceBatches);
    const initialDestSnap = StockTransferManager.cloneBatches(destinationBatches);
    let pendingTransaction: StockTransferTransaction | null = null;

    try {
      // Aşama 1: Çıkış Transferi
      const phase1 = StockTransferManager.initiateAndDeductTransfer(sourceBatches, request, ctx);
      pendingTransaction = phase1.transaction;

      // Alımdan önce değerin korunması kontrolü
      const sumTransferred = phase1.transaction.items.reduce((acc, i) => acc + i.totalCost, 0);
      const roundedTransferred = Math.round(sumTransferred * 10000) / 10000;
      if (Math.abs(roundedTransferred - phase1.transaction.totalValue) > 0.001) {
        throw new StockTransferException(
          `Conservation of value violation: Allocated sum ${roundedTransferred} does not equal declared total ${phase1.transaction.totalValue}.`
        );
      }

      // Aşama 2: Giriş Transferi (hedef bağlamda veya merkezi bağlamda simüle edilir)
      const destinationContext: TenantBranchContext = {
        ...ctx,
        branchId: request.destinationBranchId,
      };

      const phase2 = StockTransferManager.receiveAndCommitTransfer(
        destinationBatches,
        phase1.transaction,
        destinationContext
      );

      return {
        success: true,
        transaction: phase2.transaction,
        sourceUpdatedBatches: phase1.updatedSourceBatches,
        destinationUpdatedBatches: phase2.updatedDestinationBatches,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (pendingTransaction) {
        // Devam eden işlemin ACID geri almasını gerçekleştirin
        const rollback = StockTransferManager.rollbackTransfer(
          pendingTransaction,
          initialSourceSnap,
          initialDestSnap,
          errorMsg,
          ctx.userId
        );

        return {
          success: false,
          transaction: rollback.rolledBackTransaction,
          sourceUpdatedBatches: rollback.restoredSourceBatches,
          destinationUpdatedBatches: rollback.restoredDestinationBatches,
          error: errorMsg,
        };
      }

      // 1. Aşama işlem oluşturulmadan önce başarısız olursa, reddedilen işlem kaydı oluşturun
      const timestamp = new Date().toISOString();
      const abortedTx: StockTransferTransaction = {
        id: StockTransferManager.generateId('tx_aborted'),
        tenantId: ctx.tenantId,
        sourceBranchId: request.sourceBranchId,
        destinationBranchId: request.destinationBranchId,
        status: 'ROLLED_BACK',
        phase: 'ABORTED',
        items: [],
        totalValue: 0,
        initiatedBy: request.initiatedBy || ctx.userId,
        dispatchedAt: timestamp,
        rollbackReason: errorMsg,
        auditTrail: [
          {
            timestamp,
            phase: 'ABORTED',
            status: 'ROLLED_BACK',
            userId: ctx.userId,
            action: 'TRANSACTION_FAILED_AT_SOURCE',
            details: errorMsg,
          },
        ],
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      return {
        success: false,
        transaction: abortedTx,
        sourceUpdatedBatches: initialSourceSnap,
        destinationUpdatedBatches: initialDestSnap,
        error: errorMsg,
      };
    }
  }
}
