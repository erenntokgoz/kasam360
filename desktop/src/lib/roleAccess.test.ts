import { describe, expect, it } from 'vitest';
import { canCollectPayment, canOpenModule, homeModule } from './roleAccess';

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
});
