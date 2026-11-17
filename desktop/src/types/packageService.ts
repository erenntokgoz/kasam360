/** Paket servis sunucu sözleşmesi (`services::delivery`). Tutarlar tamsayı kuruştur. */

export type PackageStatus = 'PREPARING' | 'READY' | 'ON_ROUTE' | 'DELIVERED' | 'CANCELLED';
export type PackagePayment = 'CASH' | 'CARD' | 'ONLINE';
export type PackageSource = 'PHONE' | 'COUNTER' | 'YEMEKSEPETI' | 'GETIR' | 'TRENDYOL' | 'MIGROS';

export interface PackageDelivery {
  id: string;
  orderId: string;
  customerName: string;
  phone: string;
  addressText: string;
  directions: string;
  source: PackageSource;
  externalRef: string | null;
  status: PackageStatus;
  courierId: string | null;
  courierName: string | null;
  feeCents: number;
  totalCents: number;
  paymentMethod: PackagePayment;
  note: string;
  itemsSummary: string;
  createdAt: string;
  readyAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  settledAt: string | null;
}

export interface PackageAddress {
  id: string;
  label: string;
  address: string;
  directions: string;
}

export interface PackageCustomer {
  id: string;
  phone: string;
  name: string;
  note: string;
  addresses: PackageAddress[];
  orderCount: number;
}

export interface PackageCustomerOrder {
  deliveryId: string;
  status: PackageStatus;
  totalCents: number;
  paymentMethod: PackagePayment;
  itemsSummary: string;
  addressText: string;
  createdAt: string;
}

export interface PackageCourier {
  userId: string;
  name: string;
  role: string;
  isCourier: boolean;
  onRouteCount: number;
  unsettledCount: number;
  unsettledCashCents: number;
  unsettledCardCents: number;
}

export interface CreatedPackage {
  deliveryId: string;
  orderId: string;
  itemIds: string[];
  totalCents: number;
}

export interface CourierSettlement {
  settlementId: string;
  orderCount: number;
  expectedCashCents: number;
  expectedCardCents: number;
  receivedCashCents: number;
  receivedCardCents: number;
  cashDifferenceCents: number;
  cardDifferenceCents: number;
}

export interface PackageReport {
  deliveredCount: number;
  revenueCents: number;
  feeCents: number;
  cancelledCount: number;
  cancelledCents: number;
  averageTotalSeconds: number | null;
  methods: { method: PackagePayment; orderCount: number; amountCents: number }[];
  couriers: { courierId: string; name: string; deliveredCount: number; amountCents: number; averageTripSeconds: number | null }[];
}
