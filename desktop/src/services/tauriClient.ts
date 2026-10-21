import { invoke } from '@tauri-apps/api/core';
import type { FloorTable } from '../types/floor';
import type { Shift, ShiftSummary, CashMovement, ZReportData } from '../types/shift';
import type { DirectoryContact, FinancialProfitSummary } from '../types/ledger';
import type { ProcessPaymentPayload, PaymentResult } from '../types/payment';
import {
  SEED_ZONES,
  SEED_TABLES,
  SEED_CATEGORIES,
  SEED_PRODUCTS,
  SEED_KDS_TICKETS,
  SEED_DIRECTORIES,
  SEED_DEBTS,
} from './mockSeedData';

// Tauri ortamında mıyız kontrolü
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

// ============================================================================
// GENEL IPC WRAPPER (TAURI CORE VEYA YEREL MOTOR FALLBACK)
// ============================================================================

export async function invokeIPC<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri()) {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      console.warn(`[IPC ERROR] ${command}:`, error);
      throw error;
    }
  }

  // Tarayıcı / Geliştirici Ortamı için Hafıza Tabanlı Yanıtlayıcı
  return handleMockIPC<T>(command, args);
}

// Tarayıcı mock belleği
let mockTables = [...SEED_TABLES];
let mockActiveShift: Shift | null = {
  id: 'shf_demo_01',
  tenantId: 'ten_01',
  cashierId: 'usr_cashier',
  cashierName: 'Eren Tokgöz',
  openingCashCents: 150000,
  openedAt: new Date(Date.now() - 4 * 3600000).toISOString(),
  isOpen: true,
};
const mockCashMovements: CashMovement[] = [];
let mockKdsTickets = [...SEED_KDS_TICKETS];
const mockDirectories = [...SEED_DIRECTORIES];
const mockDebts = [...SEED_DEBTS];

async function handleMockIPC<T>(command: string, args: Record<string, unknown>): Promise<T> {
  // Simüle edilmiş mikro gecikme (10ms)
  await new Promise((r) => setTimeout(r, 10));

  switch (command) {
    case 'auth_login':
    case 'auth_login_credentials': {
      return {
        userId: 'usr_patron',
        name: 'Eren Tokgöz',
        role: 'OWNER',
        tenantId: 'ten_01',
        token: 'tok_demo_patron_360',
      } as unknown as T;
    }

    case 'get_floor_plan':
    case 'get_floor_layout': {
      return {
        zones: SEED_ZONES,
        tables: mockTables,
      } as unknown as T;
    }

    case 'save_floor_layout': {
      const { tables } = args as { tables: FloorTable[] };
      if (tables) mockTables = tables;
      return { success: true } as unknown as T;
    }

    case 'pos_get_categories': {
      return SEED_CATEGORIES as unknown as T;
    }

    case 'pos_get_products': {
      return SEED_PRODUCTS as unknown as T;
    }

    case 'get_active_tickets': {
      return mockKdsTickets.filter((t) => !t.isCompleted) as unknown as T;
    }

    case 'kds_update_ticket_status': {
      const { ticketId, isCompleted } = args as { ticketId: string; isCompleted: boolean };
      mockKdsTickets = mockKdsTickets.map((t) => (t.id === ticketId ? { ...t, isCompleted } : t));
      return { success: true } as unknown as T;
    }

    case 'recall_kds_ticket': {
      if (mockKdsTickets.length > 0) {
        mockKdsTickets[mockKdsTickets.length - 1].isCompleted = false;
      }
      return { success: true } as unknown as T;
    }

    case 'get_active_shift': {
      return mockActiveShift as unknown as T;
    }

    case 'open_shift': {
      const { openingCashCents, cashierId, cashierName } = args as {
        openingCashCents: number;
        cashierId: string;
        cashierName: string;
      };
      mockActiveShift = {
        id: `shf_${Date.now()}`,
        tenantId: 'ten_01',
        cashierId: cashierId || 'usr_cashier',
        cashierName: cashierName || 'Eren Tokgöz',
        openingCashCents,
        openedAt: new Date().toISOString(),
        isOpen: true,
      };
      return mockActiveShift as unknown as T;
    }

    case 'close_shift': {
      const { countedCashCents, notes } = args as { countedCashCents: number; notes?: string };
      const expected = (mockActiveShift?.openingCashCents || 0) + 485000;
      const diff = countedCashCents - expected;

      const zReport: ZReportData = {
        reportNumber: `Z-${Date.now().toString().slice(-6)}`,
        tenantName: 'KASAM360 DEMO RESTORAN',
        taxNumber: 'VKN: 9028374615',
        dateStr: new Date().toLocaleDateString('tr-TR'),
        shiftId: mockActiveShift?.id || 'shf_01',
        cashierName: mockActiveShift?.cashierName || 'Kasiyer',
        openingCashCents: mockActiveShift?.openingCashCents || 0,
        countedCashCents,
        expectedCashCents: expected,
        differenceCents: diff,
        cashSalesCents: 485000,
        cardSalesCents: 1240000,
        mealCardSalesCents: 320000,
        veresiyeSalesCents: 85000,
        totalRevenueCents: 2130000,
        totalVatCents: 193636,
        voidTotalCents: 0,
        discountTotalCents: 1500,
        orderCount: 14,
        closedAt: new Date().toISOString(),
      };

      if (mockActiveShift) {
        mockActiveShift.isOpen = false;
        mockActiveShift.closedAt = zReport.closedAt;
        mockActiveShift.closingCashCents = countedCashCents;
        mockActiveShift.expectedCashCents = expected;
        mockActiveShift.cashDifferenceCents = diff;
        mockActiveShift.notes = notes;
      }

      return zReport as unknown as T;
    }

    case 'cash_in': {
      const { shiftId, amountCents, reason } = args as { shiftId: string; amountCents: number; reason: string };
      const record: CashMovement = {
        id: `csh_${Date.now()}`,
        shiftId,
        type: 'IN',
        amountCents,
        reason,
        authorizedBy: 'Eren Tokgöz',
        createdAt: new Date().toISOString(),
      };
      mockCashMovements.push(record);
      return record as unknown as T;
    }

    case 'cash_out': {
      const { shiftId, amountCents, reason } = args as { shiftId: string; amountCents: number; reason: string };
      const record: CashMovement = {
        id: `csh_${Date.now()}`,
        shiftId,
        type: 'OUT',
        amountCents,
        reason,
        authorizedBy: 'Eren Tokgöz',
        createdAt: new Date().toISOString(),
      };
      mockCashMovements.push(record);
      return record as unknown as T;
    }

    case 'get_shift_summary': {
      const summary: ShiftSummary = {
        shiftId: mockActiveShift?.id || 'shf_01',
        cashierName: mockActiveShift?.cashierName || 'Kasiyer',
        openedAt: mockActiveShift?.openedAt || new Date().toISOString(),
        openingCashCents: mockActiveShift?.openingCashCents || 150000,
        totalCashSalesCents: 485000,
        totalCardSalesCents: 1240000,
        totalMealCardSalesCents: 320000,
        totalVeresiyeCents: 85000,
        totalCashInCents: mockCashMovements.filter((m) => m.type === 'IN').reduce((s, m) => s + m.amountCents, 0),
        totalCashOutCents: mockCashMovements.filter((m) => m.type === 'OUT').reduce((s, m) => s + m.amountCents, 0),
        expectedCashInDrawerCents: (mockActiveShift?.openingCashCents || 150000) + 485000,
        totalSalesCents: 2130000,
        totalTaxCents: 193636,
        orderCount: 14,
      };
      return summary as unknown as T;
    }

    case 'process_payment':
    case 'process_split_payment': {
      const payload = args as unknown as ProcessPaymentPayload;
      const targetTable = mockTables.find(
        (t) => t.id === payload.orderId?.replace('ord_', '') || t.activeOrderId === payload.orderId
      );

      const remainingOrderCents = targetTable
        ? Math.max(0, targetTable.totalCents - payload.amountCents)
        : 0;
      const isOrderClosed = remainingOrderCents === 0;

      if (targetTable) {
        mockTables = mockTables.map((t) => {
          if (t.id === targetTable.id) {
            if (isOrderClosed) {
              return {
                ...t,
                status: 'EMPTY',
                totalCents: 0,
                activeOrderId: undefined,
                occupiedSeats: undefined,
                waiterName: undefined,
                openedAt: undefined,
              };
            }
            return {
              ...t,
              totalCents: remainingOrderCents,
            };
          }
          return t;
        });
      }

      const res: PaymentResult = {
        paymentId: `pay_${Date.now()}`,
        orderId: payload.orderId || 'ord_01',
        amountPaidCents: payload.amountCents,
        remainingOrderCents,
        isOrderClosed,
        receiptNumber: `FIS-${Date.now().toString().slice(-6)}`,
        printedReceiptText: 'Mali Fiş Başarıyla Üretildi',
      };
      return res as unknown as T;
    }

    case 'verify_manager_pin': {
      const { pin } = args as { pin: string };
      const isValid = pin === '2222' || pin === '3333';
      return { success: isValid, approverRole: pin === '2222' ? 'OWNER' : 'MANAGER' } as unknown as T;
    }

    case 'get_directories': {
      return mockDirectories as unknown as T;
    }

    case 'create_directory': {
      const newDir: DirectoryContact = {
        id: `dir_${Date.now()}`,
        tenantId: 'ten_01',
        name: (args.name as string) || 'Yeni Müşteri',
        phone: (args.phone as string) || '',
        type: (args.type as DirectoryContact['type']) || 'CUSTOMER',
        balanceCents: 0,
      };
      mockDirectories.push(newDir);
      return newDir as unknown as T;
    }

    case 'get_debts': {
      return mockDebts as unknown as T;
    }

    case 'get_financial_report':
    case 'get_net_balance': {
      const summary: FinancialProfitSummary = {
        grossSalesCents: 3845000,
        fifoCostOfGoodsCents: 1245000,
        grossProfitCents: 2600000,
        operatingExpensesCents: 680000,
        netProfitCents: 1920000,
        totalReceivablesCents: 280000,
        totalPayablesCents: 1870000,
        cashInDrawerCents: 635000,
      };
      return summary as unknown as T;
    }

    default:
      return { success: true } as unknown as T;
  }
}
