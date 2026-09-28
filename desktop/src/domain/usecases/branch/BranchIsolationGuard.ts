import { ScopedEvent, ScopedQuery, TenantBranchContext } from './types';

export class IsolationViolationException extends Error {
  constructor(
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(`[ISOLATION_VIOLATION] ${message}`);
    this.name = 'IsolationViolationException';
    Object.setPrototypeOf(this, IsolationViolationException.prototype);
  }
}

export class ContextMissingException extends Error {
  constructor(
    message: string = 'Execution context missing: Tenant and Branch scope must be explicitly set.'
  ) {
    super(`[CONTEXT_MISSING] ${message}`);
    this.name = 'ContextMissingException';
    Object.setPrototypeOf(this, ContextMissingException.prototype);
  }
}

export class BranchIsolationGuard {
  private static activeContext: TenantBranchContext | null = null;

  /**
   * Mevcut senkron iş parçacığı yürütmesi için ortam aktif bağlamını ayarlar.
   */
  public static setActiveContext(context: TenantBranchContext): void {
    BranchIsolationGuard.validateContext(context);
    BranchIsolationGuard.activeContext = { ...context };
  }

  /**
   * Aktif ortam bağlamını temizler.
   */
  public static clearActiveContext(): void {
    BranchIsolationGuard.activeContext = null;
  }

  /**
   * Mevcut aktif ortam bağlamını alır veya ContextMissingException fırlatır.
   */
  public static getActiveContext(): TenantBranchContext {
    if (!BranchIsolationGuard.activeContext) {
      throw new ContextMissingException();
    }
    return { ...BranchIsolationGuard.activeContext };
  }

  /**
   * Kapsamlı bir bağlam içinde senkron bir görev çalıştırır ve ardından otomatik olarak temizler.
   */
  public static runInScope<T>(
    context: TenantBranchContext,
    task: (ctx: TenantBranchContext) => T
  ): T {
    BranchIsolationGuard.validateContext(context);
    const previousContext = BranchIsolationGuard.activeContext;
    try {
      BranchIsolationGuard.activeContext = { ...context };
      return task(BranchIsolationGuard.activeContext);
    } finally {
      BranchIsolationGuard.activeContext = previousContext;
    }
  }

  /**
   * Kapsamlı bir bağlam içinde asenkron bir görev çalıştırır ve önceki bağlamı otomatik olarak geri yükler.
   */
  public static async runInScopeAsync<T>(
    context: TenantBranchContext,
    task: (ctx: TenantBranchContext) => Promise<T>
  ): Promise<T> {
    BranchIsolationGuard.validateContext(context);
    const previousContext = BranchIsolationGuard.activeContext;
    try {
      BranchIsolationGuard.activeContext = { ...context };
      return await task(BranchIsolationGuard.activeContext);
    } finally {
      BranchIsolationGuard.activeContext = previousContext;
    }
  }

  /**
   * Sağlanan bağlamın boş olmayan, kesinlikle kapsamı belirlenmiş tanımlayıcılar içerdiğini doğrular.
   */
  public static validateContext(context: unknown): asserts context is TenantBranchContext {
    if (!context || typeof context !== 'object') {
      throw new ContextMissingException('Context must be a valid non-null object.');
    }

    const ctx = context as Partial<TenantBranchContext>;

    if (!ctx.tenantId || typeof ctx.tenantId !== 'string' || ctx.tenantId.trim() === '') {
      throw new IsolationViolationException('Security Context requires a non-empty tenantId.');
    }

    if (!ctx.branchId || typeof ctx.branchId !== 'string' || ctx.branchId.trim() === '') {
      throw new IsolationViolationException('Security Context requires a non-empty branchId.');
    }

    if (!ctx.userId || typeof ctx.userId !== 'string' || ctx.userId.trim() === '') {
      throw new IsolationViolationException('Security Context requires an authenticated userId.');
    }
  }

  /**
   * Açık parametreden veya ortam aktif bağlamından etkili bağlamı çözer.
   */
  public static resolveContext(explicitContext?: TenantBranchContext): TenantBranchContext {
    if (explicitContext) {
      BranchIsolationGuard.validateContext(explicitContext);
      return explicitContext;
    }
    return BranchIsolationGuard.getActiveContext();
  }

  /**
   * Bir hedef kiracıya erişimin kesinlikle arayanın kiracı sınırları içinde olduğunu iddia eder.
   * Çok kiracılı sınır aşılamaz; merkezi yönetici yabancı kiracıya erişemez.
   */
  public static assertTenantAccess(
    targetTenantId: string,
    explicitContext?: TenantBranchContext
  ): void {
    const ctx = BranchIsolationGuard.resolveContext(explicitContext);
    if (!targetTenantId || targetTenantId !== ctx.tenantId) {
      throw new IsolationViolationException(
        `Cross-tenant access rejected: Request tenant [${targetTenantId}] does not match context tenant [${ctx.tenantId}].`,
        { contextTenantId: ctx.tenantId, targetTenantId }
      );
    }
  }

  /**
   * Şube düzeyinde erişimi iddia eder. Arayan 'isCentralAdmin' ayrıcalığına sahip olmadığı sürece,
   * diğer şubelere yönelik talepler kesinlikle reddedilir.
   */
  public static assertBranchAccess(
    targetBranchId: string,
    explicitContext?: TenantBranchContext
  ): void {
    const ctx = BranchIsolationGuard.resolveContext(explicitContext);
    if (!targetBranchId) {
      throw new IsolationViolationException('Target branch ID is required for access assertion.');
    }

    if (targetBranchId !== ctx.branchId && !ctx.isCentralAdmin) {
      throw new IsolationViolationException(
        `Cross-branch access forbidden: Caller is restricted to branch [${ctx.branchId}], cannot access branch [${targetBranchId}].`,
        { contextBranchId: ctx.branchId, targetBranchId, userId: ctx.userId }
      );
    }
  }

  /**
   * Şubeler arası transfer izinlerini iddia eder. Her iki şube de arayanın kiracısına ait olmalıdır.
   */
  public static assertCrossBranchTransferAllowed(
    sourceBranchId: string,
    destinationBranchId: string,
    explicitContext?: TenantBranchContext
  ): void {
    const ctx = BranchIsolationGuard.resolveContext(explicitContext);

    if (!sourceBranchId || !destinationBranchId) {
      throw new IsolationViolationException(
        'Both source and destination branch IDs must be provided.'
      );
    }

    if (sourceBranchId === destinationBranchId) {
      throw new IsolationViolationException('Source and destination branches cannot be identical.');
    }

    // Arayan kişinin kaynak şubede yetkisi olmalı veya merkezi yönetici olmalıdır
    if (sourceBranchId !== ctx.branchId && !ctx.isCentralAdmin) {
      throw new IsolationViolationException(
        `Unauthorized transfer initiation: User branch [${ctx.branchId}] cannot initiate transfer out from [${sourceBranchId}].`,
        { userBranch: ctx.branchId, sourceBranchId }
      );
    }
  }

  /**
   * Veritabanı filtre nesnelerinde titiz kiracı ve şube sorgu kapsamını zorunlu kılar.
   * Filtredeki tenantId veya branchId'yi geçersiz kılma girişimlerini algılar ve engeller.
   */
  public static enforceQuery<T extends Record<string, unknown>>(
    queryFilter: T,
    explicitContext?: TenantBranchContext
  ): T & { tenantId: string; branchId: string } {
    const ctx = BranchIsolationGuard.resolveContext(explicitContext);

    const filterObj = queryFilter as Record<string, unknown>;

    // Kiracılar arası sorgu enjeksiyonunu engelle
    if (
      'tenantId' in filterObj &&
      filterObj.tenantId !== undefined &&
      filterObj.tenantId !== ctx.tenantId
    ) {
      throw new IsolationViolationException(
        `Data isolation breach: Query filter tenantId [${filterObj.tenantId}] conflicts with security context [${ctx.tenantId}].`
      );
    }

    // Arayan Merkezi Yönetici değilse, şubeler arası sorgu enjeksiyonunu engelle
    if (
      'branchId' in filterObj &&
      filterObj.branchId !== undefined &&
      filterObj.branchId !== ctx.branchId
    ) {
      if (!ctx.isCentralAdmin) {
        throw new IsolationViolationException(
          `Cross-branch query forbidden: Query filter branchId [${filterObj.branchId}] conflicts with context [${ctx.branchId}].`
        );
      }
    }

    return {
      ...queryFilter,
      tenantId: ctx.tenantId,
      branchId:
        ctx.isCentralAdmin && 'branchId' in filterObj && typeof filterObj.branchId === 'string'
          ? filterObj.branchId
          : ctx.branchId,
    };
  }

  /**
   * Kiracı düzeyinde izolasyonu zorunlu kılarken çoklu şube toplamaya izin verir (örn. ConsolidatedReportingEngine için).
   */
  public static enforceTenantQuery<T extends Record<string, unknown>>(
    queryFilter: T,
    explicitContext?: TenantBranchContext
  ): T & { tenantId: string } {
    const ctx = BranchIsolationGuard.resolveContext(explicitContext);
    const filterObj = queryFilter as Record<string, unknown>;

    if (
      'tenantId' in filterObj &&
      filterObj.tenantId !== undefined &&
      filterObj.tenantId !== ctx.tenantId
    ) {
      throw new IsolationViolationException(
        `Cross-tenant aggregate forbidden: Filter tenantId [${filterObj.tenantId}] does not match context tenant [${ctx.tenantId}].`
      );
    }

    return {
      ...queryFilter,
      tenantId: ctx.tenantId,
    };
  }

  /**
   * Verilerin doğru şekilde etiketlendiğinden emin olmak için kalıcılıktan önce varlıklar üzerinde katı kapsam zorunlu kılar.
   */
  public static enforceEntity<T extends Record<string, unknown>>(
    entity: T,
    explicitContext?: TenantBranchContext
  ): T & { tenantId: string; branchId: string } {
    const ctx = BranchIsolationGuard.resolveContext(explicitContext);

    const raw = entity as Record<string, unknown>;
    if (raw.tenantId && raw.tenantId !== ctx.tenantId) {
      throw new IsolationViolationException(
        'Cannot persist entity tagged with differing tenantId.'
      );
    }
    if (raw.branchId && raw.branchId !== ctx.branchId && !ctx.isCentralAdmin) {
      throw new IsolationViolationException(
        'Cannot persist entity tagged with differing branchId.'
      );
    }

    return {
      ...entity,
      tenantId: ctx.tenantId,
      branchId: (raw.branchId as string) || ctx.branchId,
    };
  }

  /**
   * Kurcalamaya karşı korumalı bir ScopedQuery sarmalayıcısı oluşturur.
   */
  public static createScopedQuery<T extends Record<string, unknown>>(
    filter: T,
    explicitContext?: TenantBranchContext
  ): ScopedQuery<T> {
    const ctx = BranchIsolationGuard.resolveContext(explicitContext);
    return {
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      filter,
    };
  }

  /**
   * Kiracılar arası olay işlemeyi önleyerek, bir olay yükünü güçlendirilmiş bir ScopedEvent nesnesine sarar.
   */
  public static wrapEvent<T>(
    eventType: string,
    payload: T,
    explicitContext?: TenantBranchContext
  ): ScopedEvent<T> {
    const ctx = BranchIsolationGuard.resolveContext(explicitContext);

    return {
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      userId: ctx.userId,
      correlationId: ctx.correlationId,
      timestamp: new Date().toISOString(),
      payload,
    };
  }

  /**
   * Gelen bir ScopedEvent'i mevcut yürütme bağlamına karşı doğrular.
   */
  public static verifyEventScope(
    event: ScopedEvent<unknown>,
    expectedBranchId?: string,
    explicitContext?: TenantBranchContext
  ): void {
    const ctx = BranchIsolationGuard.resolveContext(explicitContext);

    if (event.tenantId !== ctx.tenantId) {
      throw new IsolationViolationException(
        `Event tenant [${event.tenantId}] does not match context tenant [${ctx.tenantId}]. Event discarded.`,
        { eventId: event.eventId, eventType: event.eventType }
      );
    }

    if (expectedBranchId && event.branchId !== expectedBranchId && !ctx.isCentralAdmin) {
      throw new IsolationViolationException(
        `Event branch [${event.branchId}] does not match expected branch [${expectedBranchId}].`,
        { eventId: event.eventId, eventType: event.eventType }
      );
    }
  }
}
