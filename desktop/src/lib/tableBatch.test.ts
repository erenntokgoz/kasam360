import { describe, expect, it } from 'vitest';
import { buildTableBatch, compareTableNames, findDuplicateName, nextTableNumber } from './tableBatch';

describe('toplu masa', () => {
  it('sayıları değerine göre sıralar', () => {
    expect(['Masa 10', 'Masa 2', 'Masa 1'].sort(compareTableNames)).toEqual(['Masa 1', 'Masa 2', 'Masa 10']);
  });

  it('numarayı en büyük masadan sürdürür, başka adı saymaz', () => {
    expect(nextTableNumber(['Masa 3', 'Masa 12', 'Bar 90'], 'Masa')).toBe(13);
    expect(nextTableNumber(['Bar 90'], 'Masa')).toBe(1);
    expect(nextTableNumber(['Masa (A) 4'], 'Masa (A)')).toBe(5);
  });

  it('farklı kişi sayılı grupları tek sırada numaralar', () => {
    const batch = buildTableBatch('Masa', 6, [{ count: 2, seats: 4 }, { count: 2, seats: 6 }]);
    expect(batch).toEqual([
      { name: 'Masa 6', seats: 4 },
      { name: 'Masa 7', seats: 4 },
      { name: 'Masa 8', seats: 6 },
      { name: 'Masa 9', seats: 6 },
    ]);
  });

  it('var olan adı yakalar', () => {
    expect(findDuplicateName(buildTableBatch('Masa', 1, [{ count: 3, seats: 4 }]), ['Masa 2'])).toBe('Masa 2');
    expect(findDuplicateName(buildTableBatch('Masa', 3, [{ count: 3, seats: 4 }]), ['Masa 2'])).toBeUndefined();
  });
});
