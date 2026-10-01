import { tauriInvoke as invoke } from './tauriInvoke';
import { IPOSRepository } from '../../domain/repositories/IPOSRepository';
import {
  POSProduct,
  PaymentPayload,
  PaymentResult,
  POSCategory,
  SubmitOrderPayload,
  VoidOrderPayload,
  CartItem,
  ModifierGroup,
  ModifierOption,
} from '../../presentation/types';
import { KdsWorkflowManager } from '../../domain/usecases/kds/KdsWorkflowManager';
import { Order } from '../../domain/usecases/kds/types';
import { useAuthStore } from '../../presentation/store/useAuthStore';

export class TauriPOSRepository implements IPOSRepository {
  private static instance: TauriPOSRepository | null = null;

  public static getInstance(): TauriPOSRepository {
    if (!TauriPOSRepository.instance) {
      TauriPOSRepository.instance = new TauriPOSRepository();
    }
    return TauriPOSRepository.instance;
  }

  public async getProducts(category?: string, query?: string): Promise<POSProduct[]> {
    const rawProducts = await invoke<Record<string, unknown>[]>('pos_get_products');
    let result: POSProduct[] = (rawProducts || []).map((p: Record<string, unknown>) => ({
      id: String(p.id ?? ''),
      sku: String(p.sku || ''),
      barcode: p.barcode ? String(p.barcode) : undefined,
      name: String(p.name ?? ''),
      price: Number(p.price ?? p.priceCents ?? p.price_cents ?? 0),
      taxRate: Number(p.taxRate ?? p.tax_rate ?? 10),
      category: String(p.category || p.categoryId || p.category_id || ''),
      description: p.description ? String(p.description) : undefined,
      inStock: Boolean(p.inStock ?? p.in_stock ?? true),
      stockQuantity: p.stockQuantity !== undefined ? Number(p.stockQuantity) : p.stock_quantity !== undefined ? Number(p.stock_quantity) : undefined,
      color: p.color ? String(p.color) : undefined,
      imageUrl: p.imageUrl ? String(p.imageUrl) : p.image_url ? String(p.image_url) : undefined,
    }));

    if (category && category !== 'all') {
      result = result.filter((p) => p.category === category);
    }

    if (query && query.trim()) {
      const q = query.trim().toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.includes(q)) ||
          (p.description && p.description.toLowerCase().includes(q))
      );
    }

    return result;
  }

  public async getProductById(id: string): Promise<POSProduct | null> {
    const products = await this.getProducts();
    return products.find((p) => p.id === id) ?? null;
  }

  public async getProductByBarcode(barcode: string): Promise<POSProduct | null> {
    const cleanBarcode = barcode.trim();
    if (!cleanBarcode) return null;
    const products = await this.getProducts();
    return products.find((p) => p.barcode === cleanBarcode) ?? null;
  }

  public async getCategories(): Promise<POSCategory[]> {
    const rawCats = await invoke<Record<string, unknown>[]>('pos_get_categories');
    return (rawCats || []).map((c: Record<string, unknown>) => ({
      id: String(c.id ?? ''),
      name: String(c.name ?? ''),
      icon: c.icon ? String(c.icon) : undefined,
    }));
  }

  public async getProductModifiers(productId: string): Promise<ModifierGroup[]> {
    const rawGroups = await invoke<Record<string, unknown>[]>('get_product_modifiers', {
      productId,
      product_id: productId,
    });
    if (!rawGroups || !Array.isArray(rawGroups)) return [];
    return rawGroups.map((g: Record<string, unknown>) => ({
      id: String(g.id ?? ''),
      name: String(g.name ?? ''),
      isRequired: Boolean(g.isRequired ?? g.is_required),
      minSelections: Number(g.minSelections ?? g.min_selections ?? 0),
      maxSelections: g.maxSelections !== undefined && g.maxSelections !== null
        ? Number(g.maxSelections)
        : g.max_selections !== undefined && g.max_selections !== null
        ? Number(g.max_selections)
        : null,
      options: ((g.options as Record<string, unknown>[]) || []).map((o: Record<string, unknown>) => ({
        id: String(o.id ?? ''),
        name: String(o.name ?? ''),
        priceCents: Number(o.priceCents ?? o.price_cents ?? 0),
      })),
    }));
  }

  public async processPayment(payload: PaymentPayload): Promise<PaymentResult> {
    // Rol, backend'deki SPEC §34 "Ödeme Alma" kapısina girer; repo katmanı yetkiyi kendisi bilmez
    const actorRole = useAuthStore.getState().user?.role ?? 'WAITER';
    const result = await invoke<PaymentResult>('process_payment', { payload, actorRole });

    if (result.success) {
      const kdsOrder: Order = {
        id: payload.orderId || payload.transactionId,
        orderNumber: payload.orderId || `ORD-${payload.transactionId.slice(-4)}`,
        tableNumber: payload.customerRef || 'Hızlı Satış',
        items: payload.items.map((it) => ({
          id: it.id,
          name: it.product.name,
          quantity: it.quantity,
          category: it.product.category,
          complexityWeight: 1.0,
          notes: it.note,
        })),
        createdAt: payload.timestamp,
        priority: 'NORMAL',
      };
      KdsWorkflowManager.getInstance().enqueueOrder(kdsOrder);
    }

    return result;
  }

  public async processSplitPayment(payload: PaymentPayload): Promise<PaymentResult> {
    const actorRole = useAuthStore.getState().user?.role ?? 'WAITER';
    const result = await invoke<PaymentResult>('process_split_payment', { payload, actorRole });

    if (result.success) {
      const kdsOrder: Order = {
        id: payload.orderId || payload.transactionId,
        orderNumber: payload.orderId || `ORD-${payload.transactionId.slice(-4)}`,
        tableNumber: payload.customerRef || 'Hızlı Satış',
        items: payload.items.map((it) => ({
          id: it.id,
          name: it.product.name,
          quantity: it.quantity,
          category: it.product.category,
          complexityWeight: 1.0,
          notes: it.note,
        })),
        createdAt: payload.timestamp,
        priority: 'NORMAL',
      };
      KdsWorkflowManager.getInstance().enqueueOrder(kdsOrder);
    }

    return result;
  }

  public async printReceipt(payload: PaymentPayload): Promise<void> {
    await invoke<void>('print_receipt', { order: payload });
  }

  public async submitOrder(payload: SubmitOrderPayload): Promise<boolean> {
    const success = await invoke<boolean>('submit_order', { payload });
    if (success) {
      const kdsOrder: Order = {
        id: payload.orderId,
        orderNumber: payload.orderId,
        tableNumber: payload.tableId,
        items: payload.items.map((it) => ({
          id: it.id,
          name: it.product.name,
          quantity: it.quantity,
          category: it.product.category,
          complexityWeight: 1.0,
          notes: it.note,
        })),
        createdAt: new Date().toISOString(),
        priority: 'NORMAL',
      };
      KdsWorkflowManager.getInstance().enqueueOrder(kdsOrder);
    }
    return success;
  }

  public async voidOrder(payload: VoidOrderPayload): Promise<boolean> {
    return await invoke<boolean>('void_order', { payload });
  }

  public async getOrderItems(tableId: string): Promise<CartItem[]> {
    const rawItems = await invoke<Record<string, unknown>[]>('get_order_items', { tableId, table_id: tableId });
    if (!rawItems || !Array.isArray(rawItems)) return [];
    return rawItems.map((item: Record<string, unknown>) => {
      const prod = (item.product as Record<string, unknown>) || {};
      const unitPrice = Math.round(Number(item.unitPrice ?? item.unit_price ?? prod.price ?? prod.priceCents ?? 0));
      const quantity = Math.round(Number(item.quantity || 1));
      const taxRate = Number(item.taxRate ?? item.tax_rate ?? prod.taxRate ?? 10);
      const subtotal = Math.round(Number(item.subtotal ?? item.subtotal_cents ?? (unitPrice * quantity)));
      const taxAmount = Math.round(Number(item.taxAmount ?? item.tax_amount ?? item.tax_amount_cents ?? Math.round(subtotal * (taxRate / 100))));
      const total = Math.round(Number(item.total ?? item.total_cents ?? (subtotal + taxAmount)));

      let modifiers: ModifierOption[] | undefined = undefined;
      if (item.modifiers) {
        if (typeof item.modifiers === 'string') {
          try {
            modifiers = JSON.parse(item.modifiers) as ModifierOption[];
          } catch {
            modifiers = undefined;
          }
        } else if (Array.isArray(item.modifiers)) {
          modifiers = item.modifiers as ModifierOption[];
        }
      }

      const cartItem: CartItem = {
        id: String(item.id || crypto.randomUUID()),
        product: {
          id: String(prod.id || item.productId || item.product_id || ''),
          name: String(prod.name || 'Ürün'),
          sku: String(prod.sku || ''),
          barcode: prod.barcode ? String(prod.barcode) : undefined,
          category: String(prod.category || prod.categoryId || 'all'),
          price: Number(prod.price ?? prod.priceCents ?? unitPrice),
          taxRate,
          inStock: Boolean(prod.inStock ?? true),
          description: prod.description ? String(prod.description) : undefined,
          imageUrl: prod.imageUrl ? String(prod.imageUrl) : undefined,
          color: prod.color ? String(prod.color) : undefined,
        },
        quantity,
        unitPrice,
        taxRate,
        subtotal,
        taxAmount,
        total,
        modifiers,
        note: item.note ? String(item.note) : item.notes ? String(item.notes) : undefined,
      };
      return cartItem;
    });
  }
}
