import { describe, expect, it } from 'vitest';
import { canAdvanceKitchen, canCollectPayment, canOpenModule, canQuickSale, canServeDeliveries, homeModule } from './roleAccess';

describe('roleAccess', () => {
  it('mutfak yalnız mutfak ekranını açar', () => {
    expect(homeModule('KITCHEN')).toBe('KDS');
    expect(canOpenModule('KITCHEN', 'CASHIER')).toBe(false);
    expect(canOpenModule('KITCHEN', 'POS')).toBe(false);
  });

  it('garson sipariş alır, tahsilat yapamaz', () => {
    expect(canOpenModule('WAITER', 'POS')).toBe(true);
    expect(canOpenModule('WAITER', 'KDS')).toBe(true);
    expect(canOpenModule('WAITER', 'CASHIER')).toBe(false);
    expect(canCollectPayment('WAITER')).toBe(false);
  });

  it('kasiyer tahsilat yapar, yönetime giremez', () => {
    expect(canCollectPayment('CASHIER')).toBe(true);
    expect(canOpenModule('CASHIER', 'ERP')).toBe(false);
    expect(canOpenModule('CASHIER', 'FLOOR')).toBe(true);
    expect(canOpenModule('CASHIER', 'POS')).toBe(true);
    expect(canOpenModule('CASHIER', 'KDS')).toBe(true);
  });

  it('tahsilat düğmeleri yalnız kasiyer ve işletme sahibine açılır', () => {
    expect(canCollectPayment('OWNER')).toBe(true);
    expect(canCollectPayment('MANAGER')).toBe(false);
    expect(canCollectPayment('KITCHEN')).toBe(false);
    expect(canCollectPayment('MASTER')).toBe(false);
  });

  it('müdür ve patron yönetime girer, oturumsuz hiçbir ekran açılmaz', () => {
    expect(canOpenModule('MANAGER', 'ERP')).toBe(true);
    expect(canOpenModule('MANAGER', 'SETTINGS')).toBe(true);
    expect(canOpenModule('OWNER', 'ERP')).toBe(true);
    expect(canOpenModule('MASTER', 'FLOOR')).toBe(false);
    expect(canOpenModule('MASTER', 'ERP')).toBe(false);
    expect(canOpenModule(undefined, 'FLOOR')).toBe(false);
  });

  it('mutfak fişini yalnız mutfak hattı ilerletir; kasiyer ve garson izler', () => {
    expect(['OWNER', 'MANAGER', 'KITCHEN'].map((role) => canAdvanceKitchen(role as never))).toEqual([true, true, true]);
    expect(canAdvanceKitchen('CASHIER')).toBe(false);
    expect(canAdvanceKitchen('WAITER')).toBe(false);
    expect(canAdvanceKitchen(undefined)).toBe(false);
  });

  it('hızlı satış kasiyer, müdür ve patrona açık; garson ve mutfağa kapalı', () => {
    expect(canQuickSale('CASHIER')).toBe(true);
    expect(canQuickSale('MANAGER')).toBe(true);
    expect(canQuickSale('OWNER')).toBe(true);
    expect(canQuickSale('WAITER')).toBe(false);
    expect(canQuickSale('KITCHEN')).toBe(false);
    expect(canQuickSale(undefined)).toBe(false);
  });

  it('teslim listesini salon rolleri görür, mutfak görmez', () => {
    expect(canServeDeliveries('WAITER')).toBe(true);
    expect(canServeDeliveries('CASHIER')).toBe(true);
    expect(canServeDeliveries('KITCHEN')).toBe(false);
    expect(canServeDeliveries('MASTER')).toBe(false);
    expect(canServeDeliveries(undefined)).toBe(false);
  });
});
