import { create } from 'zustand';
import { invokeIPC } from '../services/tauriClient';
import { sessionArgs } from './cariStore';
import { errorText } from '../lib/cariInput';
import { printKitchenTickets } from '../lib/kitchenPrint';
import type {
  CourierSettlement, CreatedPackage, PackageCourier, PackageCustomer, PackageCustomerOrder, PackageDelivery,
  PackagePayment, PackageReport, PackageStatus,
} from '../types/packageService';

interface PackageStore {
  rows: PackageDelivery[];
  couriers: PackageCourier[];
  loadError: string | null;
  /** Yazma hatası kalıcıdır: kullanıcı kapatana kadar tahtanın üstünde durur. */
  actionError: string | null;
  isBusy: boolean;
  load: () => Promise<void>;
  loadCouriers: () => Promise<void>;
  dismissActionError: () => void;
  advance: (deliveryId: string, to: PackageStatus, courierId?: string) => Promise<boolean>;
  assignCourier: (deliveryId: string, courierId: string) => Promise<boolean>;
  cancel: (delivery: PackageDelivery, reason: string, pin: string) => Promise<void>;
  setCourierFlag: (userId: string, enabled: boolean) => Promise<boolean>;
}

// Eski bir okuma, daha yeni bir okumanın sonucunu ezmesin.
let boardRequest = 0;

export const usePackageStore = create<PackageStore>((set, get) => ({
  rows: [],
  couriers: [],
  loadError: null,
  actionError: null,
  isBusy: false,

  load: async () => {
    const request = ++boardRequest;
    try {
      const { actorRole, actorId, tenantId } = sessionArgs();
      const rows = await invokeIPC<PackageDelivery[]>('list_delivery_board', { actorId, actorRole, tenantId });
      // Okuma hatasında eski liste durur: boş tahta "sipariş yok" anlamına gelirdi.
      if (request === boardRequest) set({ rows, loadError: null });
    } catch (error) {
      if (request === boardRequest) set({ loadError: errorText(error) });
    }
  },

  loadCouriers: async () => {
    try {
      const { actorRole, tenantId } = sessionArgs();
      const couriers = await invokeIPC<PackageCourier[]>('list_delivery_couriers', { actorRole, tenantId });
      set({ couriers });
    } catch (error) {
      set({ loadError: errorText(error) });
    }
  },

  dismissActionError: () => set({ actionError: null }),

  advance: async (deliveryId, to, courierId) => {
    if (get().isBusy) return false;
    set({ isBusy: true, actionError: null });
    try {
      const { actorRole, actorId, tenantId } = sessionArgs();
      await invokeIPC<PackageDelivery>('advance_delivery', {
        actorId, actorRole, tenantId, deliveryId, toStatus: to, courierId: courierId ?? null,
      });
      set({ isBusy: false });
      await get().load();
      return true;
    } catch (error) {
      // Başka cihaz durumu değiştirmiş olabilir: liste yenilenir, hata görünür kalır.
      set({ isBusy: false, actionError: errorText(error) });
      await get().load();
      return false;
    }
  },

  assignCourier: async (deliveryId, courierId) => {
    if (get().isBusy) return false;
    set({ isBusy: true, actionError: null });
    try {
      const { actorRole, actorId, tenantId } = sessionArgs();
      await invokeIPC<PackageDelivery>('assign_delivery_courier', { actorId, actorRole, tenantId, deliveryId, courierId });
      set({ isBusy: false });
      await get().load();
      return true;
    } catch (error) {
      set({ isBusy: false, actionError: errorText(error) });
      return false;
    }
  },

  // İptal yönetici PIN'iyle onaylanır; hata pencerede gösterilsin diye yukarı taşınır.
  cancel: async (delivery, reason, pin) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    const approval = await invokeIPC<{ approvalToken: string }>('verify_manager_pin', {
      payload: {
        operation: 'VOID_ORDER',
        resourceId: delivery.orderId,
        actorId,
        actorRole,
        amountCents: delivery.totalCents,
        discountPercent: 0,
        terminalId: 'terminal_void',
        pin,
        tenantId,
      },
    });
    await invokeIPC<PackageDelivery>('cancel_delivery', {
      actorId, actorRole, tenantId, deliveryId: delivery.id, reason: reason.trim(), approvalToken: approval.approvalToken,
    });
    await get().load();
  },

  setCourierFlag: async (userId, enabled) => {
    set({ actionError: null });
    try {
      const { actorRole, actorId, tenantId } = sessionArgs();
      await invokeIPC<void>('set_delivery_courier_flag', { actorId, actorRole, tenantId, userId, enabled });
      await get().loadCouriers();
      return true;
    } catch (error) {
      set({ actionError: errorText(error) });
      return false;
    }
  },
}));

/** Müşteri araması: telefon ya da ad. Boş arama son müşterileri getirir. */
export async function searchPackageCustomers(query: string): Promise<PackageCustomer[]> {
  const { actorRole, tenantId } = sessionArgs();
  return invokeIPC<PackageCustomer[]>('list_delivery_customers', { actorRole, tenantId, query });
}

export async function customerHistory(customerId: string): Promise<PackageCustomerOrder[]> {
  const { actorRole, tenantId } = sessionArgs();
  return invokeIPC<PackageCustomerOrder[]>('get_delivery_customer_history', { actorRole, tenantId, customerId });
}

export async function saveCustomer(input: { id?: string; phone: string; name: string; note: string }): Promise<PackageCustomer> {
  const { actorRole, actorId, tenantId } = sessionArgs();
  return invokeIPC<PackageCustomer>('save_delivery_customer', { actorId, actorRole, tenantId, input });
}

export async function saveAddress(input: {
  id?: string; customerId: string; label: string; address: string; directions: string;
}): Promise<PackageCustomer> {
  const { actorRole, actorId, tenantId } = sessionArgs();
  return invokeIPC<PackageCustomer>('save_delivery_address', { actorId, actorRole, tenantId, input });
}

export async function removeAddress(addressId: string): Promise<PackageCustomer> {
  const { actorRole, actorId, tenantId } = sessionArgs();
  return invokeIPC<PackageCustomer>('remove_delivery_address', { actorId, actorRole, tenantId, addressId });
}

/**
 * Siparişi kaydeder ve fişi basar. Sipariş yazıldıktan sonra basım hatası akışı bozmaz:
 * sipariş kayıtlıdır, hata kalıcı yazıcı uyarısına dönüşür (`printKitchenTickets`).
 */
export async function createPackageOrder(input: {
  customerId: string;
  addressId: string;
  items: unknown[];
  feeCents: number;
  paymentMethod: PackagePayment;
  note: string;
}): Promise<CreatedPackage> {
  const { actorRole, actorId, tenantId } = sessionArgs();
  const created = await invokeIPC<CreatedPackage>('create_delivery_order', { actorId, actorRole, tenantId, input });
  await printKitchenTickets(created.orderId, created.itemIds, actorRole, tenantId);
  return created;
}

export async function settleCourier(input: {
  courierId: string;
  deliveryIds: string[];
  receivedCashCents: number;
  receivedCardCents: number;
  note: string;
}): Promise<CourierSettlement> {
  const { actorRole, actorId, tenantId } = sessionArgs();
  return invokeIPC<CourierSettlement>('settle_delivery_courier', { actorId, actorRole, tenantId, input });
}

export async function loadPackageReport(from: string, to: string): Promise<PackageReport> {
  const { actorRole, tenantId } = sessionArgs();
  return invokeIPC<PackageReport>('get_delivery_report', { actorRole, tenantId, from, to });
}
