// eslint-disable-next-line no-restricted-imports
import { isTauri, invoke } from '@tauri-apps/api/core';
import { StationRouter } from './StationRouter';
import { LoadBalancer } from './LoadBalancer';
import {
  Order,
  OrderItem,
  StationType,
  KitchenLoadReport,
} from './types';
import {
  KdsOrder,
  KitchenTicketStatus,
  StationQueueItem,
  KdsStationFilter,
  KdsStatusFilter,
  TicketStatusTransitionEvent,
} from '../../../presentation/types';
import { ImmutableLedgerRepository } from '../../../data/local/ledger/ImmutableLedgerRepository';
import { LedgerPrincipal } from '../../entities/ledger/types';


/**
 * Mutfak istasyonu önizlemesi ve testi için başlangıç KDS tohum sipariş biletleri
 */
const SEED_KDS_ORDERS: KdsOrder[] = [
  {
    id: 'kds_ord_101',
    orderNumber: 'ORD-101',
    tableNumber: 'Masa 4',
    status: 'Pending',
    priority: 'RUSH',
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    notes: 'Glutensiz ekmek tercihi, az pişmiş et',
    serverName: 'Ahmet K.',
    items: [
      {
        id: 'item_101_1',
        orderId: 'kds_ord_101',
        name: 'Kasam360 Gurme Burger',
        quantity: 2,
        station: 'Grill',
        complexityWeight: 1.0,
        status: 'Pending',
        modifiers: ['Ekstra Cheddar', 'Az Pişmiş'],
      },
      {
        id: 'item_101_2',
        orderId: 'kds_ord_101',
        name: 'Baharatlı Parmak Patates',
        quantity: 2,
        station: 'Fryer',
        complexityWeight: 0.6,
        status: 'Pending',
        notes: 'Acı sos ayrı',
      },
      {
        id: 'item_101_3',
        orderId: 'kds_ord_101',
        name: 'Ev Yapımı Limonata',
        quantity: 2,
        station: 'Bar',
        complexityWeight: 0.4,
        status: 'Pending',
      },
    ],
  },
  {
    id: 'kds_ord_102',
    orderNumber: 'ORD-102',
    tableNumber: 'Masa 12',
    status: 'Preparing',
    priority: 'VIP',
    createdAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
    startedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    notes: 'VIP Misafir - Hızlı Servis',
    serverName: 'Merve S.',
    items: [
      {
        id: 'item_102_1',
        orderId: 'kds_ord_102',
        name: 'Taş Fırın Margherita Pizza',
        quantity: 1,
        station: 'Pizza',
        complexityWeight: 1.4,
        status: 'Preparing',
        modifiers: ['Bol Fesleğen'],
      },
      {
        id: 'item_102_2',
        orderId: 'kds_ord_102',
        name: 'Iced Americano',
        quantity: 1,
        station: 'Bar',
        complexityWeight: 0.4,
        status: 'Ready',
      },
    ],
  },
  {
    id: 'kds_ord_103',
    orderNumber: 'ORD-103',
    tableNumber: 'Paket #03',
    status: 'Ready',
    priority: 'NORMAL',
    createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    startedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    readyAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    serverName: 'Kurye Bekliyor',
    items: [
      {
        id: 'item_103_1',
        orderId: 'kds_ord_103',
        name: 'Kars Kaşarlı Bazlama Tost',
        quantity: 1,
        station: 'Prep',
        complexityWeight: 0.8,
        status: 'Ready',
      },
      {
        id: 'item_103_2',
        orderId: 'kds_ord_103',
        name: 'Geleneksel Türk Çayı',
        quantity: 2,
        station: 'Bar',
        complexityWeight: 0.4,
        status: 'Ready',
      },
    ],
  },
];

/**
 * Domain Kullanım Senaryosu: Gerçek Zamanlı Mutfak Ekranı Sistemi (KDS) ve Operasyonel İş Akışı Orkestratörü
 * Sipariş istasyonu yönlendirmesini, Kanban yaşam döngüsü durumlarını (Pending -> Preparing -> Ready),
 * yük dengelemeyi ve değiştirilemez denetim defteri / IPC olay senkronizasyonunu koordine eder.
 */
export class KdsWorkflowManager {
  private static instance: KdsWorkflowManager | null = null;

  private orders: Map<string, KdsOrder> = new Map();
  private readonly router: StationRouter;
  private readonly loadBalancer: LoadBalancer;
  private subscribers: Set<() => void> = new Set();
  private ledgerRepository: ImmutableLedgerRepository | null = null;
  private readonly systemPrincipal: LedgerPrincipal = {
    userId: 'kds_workflow_manager',
    role: 'System',
  };
  private ledgerQueue: Promise<void> = Promise.resolve();

  public constructor(options?: {
    ledgerRepository?: ImmutableLedgerRepository;
    initialOrders?: KdsOrder[];
  }) {
    this.router = new StationRouter();
    this.loadBalancer = new LoadBalancer();
    this.ledgerRepository = options?.ledgerRepository ?? null;

    const initial = options?.initialOrders ?? SEED_KDS_ORDERS;
    for (const ord of initial) {
      this.orders.set(ord.id, { ...ord });
    }
  }

  public static getInstance(): KdsWorkflowManager {
    if (!KdsWorkflowManager.instance) {
      KdsWorkflowManager.instance = new KdsWorkflowManager();
    }
    return KdsWorkflowManager.instance;
  }

  public static resetInstance(): void {
    KdsWorkflowManager.instance = null;
  }

  public setLedgerRepository(repo: ImmutableLedgerRepository): void {
    this.ledgerRepository = repo;
  }

  /**
   * Gelen bir POS müşteri siparişini mutfak ekran sistemine sıraya ekler.
   * Öğeleri hedef istasyonlarına deterministik olarak böler ve karmaşıklığı hesaplar.
   */
  public enqueueOrder(order: Order): KdsOrder {
    const partitioned = this.router.routeOrder(order);
    const stationItems: StationQueueItem[] = [];

    for (const [station, items] of Object.entries(partitioned) as [StationType, OrderItem[]][]) {
      for (const item of items) {
        stationItems.push({
          id: item.id || `kds_item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          orderId: order.id,
          name: item.name,
          quantity: item.quantity || 1,
          station,
          complexityWeight: this.loadBalancer.getItemWeight(item),
          notes: item.notes,
          modifiers: item.modifiers,
          status: 'Pending',
        });
      }
    }

    const priority: 'NORMAL' | 'VIP' | 'RUSH' =
      order.priority === 'VIP' || order.priority === 'RUSH' ? order.priority : 'NORMAL';

    const kdsOrder: KdsOrder = {
      id: order.id,
      orderNumber: String(order.orderNumber || `ORD-${order.id.slice(-4)}`),
      tableNumber: order.tableNumber ? String(order.tableNumber) : undefined,
      status: 'Pending',
      items: stationItems,
      createdAt: typeof order.createdAt === 'string' ? order.createdAt : new Date().toISOString(),
      priority,
      totalComplexity: this.loadBalancer.calculateOrderComplexity(order),
    };

    this.orders.set(kdsOrder.id, kdsOrder);
    this.notifySubscribers();

    // Asenkron defter ve IPC senkronizasyonunu tetikle
    void this.syncOrderEvent('kds:order_enqueued', kdsOrder.id, {
      orderNumber: kdsOrder.orderNumber,
      tableNumber: kdsOrder.tableNumber,
      itemCount: kdsOrder.items.length,
      priority: kdsOrder.priority,
      status: kdsOrder.status,
    });

    return kdsOrder;
  }

  /**
   * Bir siparişi operasyonel bilet yaşam döngüsünde ilerletir:
   * Bekliyor (Pending) -> Hazırlanıyor (Preparing) -> Hazır (Ready) -> Tamamlandı (Completed)
   */
  public async advanceTicketStatus(
    orderId: string,
    targetStatus?: KitchenTicketStatus
  ): Promise<KdsOrder> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`KDS Ticket not found: ${orderId}`);
    }

    const currentStatus = order.status;
    let nextStatus: KitchenTicketStatus;

    if (targetStatus) {
      nextStatus = targetStatus;
    } else {
      switch (currentStatus) {
        case 'Pending':
          nextStatus = 'Preparing';
          break;
        case 'Preparing':
          nextStatus = 'Ready';
          break;
        case 'Ready':
          nextStatus = 'Completed';
          break;
        default:
          return order;
      }
    }

    const now = new Date().toISOString();
    const updatedOrder: KdsOrder = {
      ...order,
      status: nextStatus,
    };

    if (nextStatus === 'Preparing' && !updatedOrder.startedAt) {
      updatedOrder.startedAt = now;
      // Bekleyen öğeleri hazırlanıyor durumuna ilerlet
      updatedOrder.items = updatedOrder.items.map((it) =>
        it.status === 'Pending' ? { ...it, status: 'Preparing' } : it
      );
    } else if (nextStatus === 'Ready') {
      updatedOrder.readyAt = now;
      updatedOrder.items = updatedOrder.items.map((it) =>
        it.status === 'Pending' || it.status === 'Preparing'
          ? { ...it, status: 'Ready', completedAt: now }
          : it
      );
    } else if (nextStatus === 'Completed') {
      updatedOrder.completedAt = now;
      updatedOrder.items = updatedOrder.items.map((it) => ({
        ...it,
        status: 'Completed',
        completedAt: it.completedAt || now,
      }));
    }

    this.orders.set(orderId, updatedOrder);
    this.notifySubscribers();

    const transitionEvent: TicketStatusTransitionEvent = {
      orderId,
      fromStatus: currentStatus,
      toStatus: nextStatus,
      timestamp: now,
      actorId: this.systemPrincipal.userId,
      actorRole: this.systemPrincipal.role,
    };

    await this.syncOrderEvent('kds:ticket_status_advanced', orderId, {
      orderNumber: updatedOrder.orderNumber,
      fromStatus: currentStatus,
      toStatus: nextStatus,
      timestamp: now,
    });

    if (isTauri()) {
      try {
        await invoke('kds_update_ticket_status', { payload: transitionEvent });
      } catch (err) {
        console.warn('Tauri IPC kds_update_ticket_status failed:', err);
      }
    }

    return updatedOrder;
  }

  /**
   * İstasyon sırasındaki tek bir öğenin hazırlık durumunu günceller.
   */
  public async updateItemStatus(
    orderId: string,
    itemId: string,
    nextStatus: KitchenTicketStatus
  ): Promise<KdsOrder> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    const now = new Date().toISOString();
    let hasChanged = false;

    const updatedItems = order.items.map((item) => {
      if (item.id === itemId) {
        hasChanged = true;
        return {
          ...item,
          status: nextStatus,
          completedAt: nextStatus === 'Ready' || nextStatus === 'Completed' ? now : undefined,
        };
      }
      return item;
    });

    if (!hasChanged) {
      return order;
    }

    // Öğenin ilerlemesine göre ana sipariş durumunu değerlendir
    let derivedStatus = order.status;
    const allReadyOrCompleted = updatedItems.every(
      (it) => it.status === 'Ready' || it.status === 'Completed'
    );
    const anyPreparing = updatedItems.some((it) => it.status === 'Preparing');
    const allCompleted = updatedItems.every((it) => it.status === 'Completed');

    if (allCompleted) {
      derivedStatus = 'Completed';
    } else if (allReadyOrCompleted) {
      derivedStatus = 'Ready';
    } else if (anyPreparing && order.status === 'Pending') {
      derivedStatus = 'Preparing';
    }

    const updatedOrder: KdsOrder = {
      ...order,
      status: derivedStatus,
      items: updatedItems,
      startedAt: derivedStatus === 'Preparing' && !order.startedAt ? now : order.startedAt,
      readyAt: derivedStatus === 'Ready' && !order.readyAt ? now : order.readyAt,
      completedAt: derivedStatus === 'Completed' && !order.completedAt ? now : order.completedAt,
    };

    this.orders.set(orderId, updatedOrder);
    this.notifySubscribers();

    await this.syncOrderEvent('kds:item_status_updated', orderId, {
      itemId,
      itemStatus: nextStatus,
      orderStatus: derivedStatus,
    });

    return updatedOrder;
  }

  /**
   * İsteğe bağlı istasyon ve durum filtrelemesi ile canlı siparişleri sorgula.
   */
  public getOrders(filters?: {
    status?: KdsStatusFilter;
    station?: KdsStationFilter;
  }): KdsOrder[] {
    let result = Array.from(this.orders.values());

    if (filters?.status && filters.status !== 'ALL') {
      result = result.filter((o) => o.status === filters.status);
    } else {
      // Varsayılan olarak aktif siparişleri göster (açıkça istenmediği sürece tamamlananları/iptal edilenleri hariç tut)
      result = result.filter((o) => o.status !== 'Completed' && o.status !== 'Cancelled');
    }

    if (filters?.station && filters.station !== 'ALL') {
      result = result
        .filter((o) => o.items.some((it) => it.station === filters.station))
        .map((o) => ({
          ...o,
          items: o.items.filter((it) => it.station === filters.station),
        }));
    }

    // Sıralama: Önce RUSH/VIP, sonra en eski createdAt
    return result.sort((a, b) => {
      const priorityScore = (p?: string) => (p === 'RUSH' ? 3 : p === 'VIP' ? 2 : 1);
      const diffPriority = priorityScore(b.priority) - priorityScore(a.priority);
      if (diffPriority !== 0) return diffPriority;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }

  public getOrderById(orderId: string): KdsOrder | undefined {
    return this.orders.get(orderId);
  }

  /**
   * Tüm mutfak istasyonları genelinde gerçek zamanlı iş yükü raporunu ve darboğaz uyarılarını alır.
   */
  public getKitchenLoad(): KitchenLoadReport {
    const activeOrders = Array.from(this.orders.values()).filter(
      (o) => o.status === 'Pending' || o.status === 'Preparing'
    );

    const domainOrders: Order[] = activeOrders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      tableNumber: o.tableNumber,
      createdAt: o.createdAt,
      priority: o.priority,
      items: o.items.map((it) => ({
        id: it.id,
        name: it.name,
        quantity: it.quantity,
        station: it.station as StationType,
        complexityWeight: it.complexityWeight,
      })),
    }));

    return this.loadBalancer.analyzeKitchenLoad(domainOrders);
  }

  /**
   * React bileşenleri için gerçek zamanlı abonelik hook'u.
   */
  public subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private notifySubscribers(): void {
    for (const callback of this.subscribers) {
      try {
        callback();
      } catch (err) {
        console.error('KdsWorkflowManager subscriber notification error:', err);
      }
    }
  }

  public async waitForLedgerSync(): Promise<void> {
    await this.ledgerQueue;
  }

  private syncOrderEvent(
    action: string,
    resourceId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    this.ledgerQueue = this.ledgerQueue.then(async () => {
      if (this.ledgerRepository) {
        try {
          await this.ledgerRepository.append(
            {
              actor_id: this.systemPrincipal.userId,
              actor_role: this.systemPrincipal.role,
              action,
              resource_id: resourceId,
              payload,
            },
            this.systemPrincipal
          );
        } catch (err) {
          console.warn(`Ledger append failed for ${action}:`, err);
        }
      }
    });

    return this.ledgerQueue;
  }
}

