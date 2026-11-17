import { describe, expect, it } from 'vitest';
import { acceptedProviders, type MealCardProvider } from './mealCards';

describe('yemek kartı markaları', () => {
  it('kapalı marka ödeme ekranına gelmez', () => {
    const all: MealCardProvider[] = [
      { code: 'MULTINET', label: 'Multinet', enabled: true },
      { code: 'SETCARD', label: 'Setcard', enabled: false },
      { code: 'OTHER', label: 'Diğer yemek kartı', enabled: true },
    ];
    expect(acceptedProviders(all).map((provider) => provider.code)).toEqual(['MULTINET', 'OTHER']);
  });
});
