import { describe, expect, it } from 'vitest';
import { mapRecipeCost } from './recipeCost';

describe('reçete maliyeti sözleşmesi', () => {
  it('bilinmeyen maliyeti sıfıra dönüştürmez', () => {
    const result = mapRecipeCost({
      recipe_id: 'rcp_1', product_id: 'prd_1', unit_cost_cents: null,
      unresolved: ['Malzeme maliyeti yok'],
      components: [{ component_product_id: 'ing_1', name: 'Süt', quantity: 1,
        unit: 'l', unit_cost_cents: null, line_cost_cents: null }],
    });
    expect(result.totalCostCents).toBeNull();
    expect(result.unresolvedCount).toBe(1);
    expect(result.items[0].lineCostCents).toBeNull();
  });

  it('geçersiz kuruş tutarını reddeder', () => {
    expect(() => mapRecipeCost({
      recipe_id: 'rcp_1', product_id: 'prd_1', unit_cost_cents: 10.5,
      unresolved: [], components: [],
    })).toThrow('geçersiz');
  });
});
