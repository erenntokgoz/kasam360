import { describe, expect, it } from 'vitest';
import { quickActionsFor } from './mobileShellModel';

type Enabled = Parameters<typeof quickActionsFor>[1];
const allOn: Enabled = () => true;
const ids = (role: Parameters<typeof quickActionsFor>[0], on: Enabled = allOn) => quickActionsFor(role, on).map((a) => a.id);

describe('mobil hızlı işlemler', () => {
  it('patron dört kısayolu da görür', () => {
    expect(ids('OWNER')).toEqual(['NEW_ORDER', 'QUICK_SALE', 'COLLECT', 'CASH_OUT', 'LEDGER']);
  });

  it('kasiyer cari ekranına gitmez', () => {
    expect(ids('CASHIER')).toEqual(['NEW_ORDER', 'QUICK_SALE', 'COLLECT', 'CASH_OUT']);
  });

  it('garson yalnız masa ekranından sipariş açar, tahsilat göremez', () => {
    const actions = quickActionsFor('WAITER', allOn);
    expect(actions).toEqual([{ id: 'NEW_ORDER', label: 'Yeni Sipariş', module: 'FLOOR' }]);
    expect(actions.some((action) => action.id === 'QUICK_SALE')).toBe(false);
  });

  it('mutfak ve oturumsuz kullanıcı kısayol görmez', () => {
    expect(ids('KITCHEN')).toEqual([]);
    expect(ids(undefined)).toEqual([]);
  });

  it('cari bayrağı kapalıysa cari kısayolu gizlenir', () => {
    expect(ids('MANAGER', (flag) => flag !== 'feat_ledger_cari')).toEqual(['NEW_ORDER', 'QUICK_SALE', 'CASH_OUT']);
  });

  it('müdür tahsilat düğmesi görmez ama gideri açar', () => {
    expect(ids('MANAGER')).toEqual(['NEW_ORDER', 'QUICK_SALE', 'CASH_OUT', 'LEDGER']);
  });
});
