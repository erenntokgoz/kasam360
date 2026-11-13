import { describe, expect, it } from 'vitest';
import { transferProblem, type MoneyAccount } from './accountsModel';

const account = (id: string, balanceCents: number): MoneyAccount => ({ id, name: id, kind: 'CASH', openingCents: 0, balanceCents, isActive: true });

describe('transferProblem', () => {
  it('geçerli transferde sorun döndürmez', () => {
    expect(transferProblem(account('a', 500), account('b', 0), 500)).toBeNull();
  });

  it('bakiye aşımı, aynı hesap, boş tutar ve eksik seçimi reddeder', () => {
    expect(transferProblem(account('a', 500), account('b', 0), 501)).toMatch(/yetersiz/);
    expect(transferProblem(account('a', 500), account('a', 500), 1)).toMatch(/aynı/);
    expect(transferProblem(account('a', 500), account('b', 0), 0)).toMatch(/Tutarı/);
    expect(transferProblem(account('a', 500), account('b', 0), null)).toMatch(/Tutarı/);
    expect(transferProblem(undefined, account('b', 0), 1)).toMatch(/seçin/);
  });
});
