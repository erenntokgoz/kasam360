import type { RecipeCostDto } from '../types/menu360';

interface WireComponent {
  component_product_id: string;
  name: string;
  quantity: number;
  unit: string;
  unit_cost_cents: number | null;
  line_cost_cents: number | null;
}

interface WireRecipeCost {
  recipe_id: string;
  product_id: string;
  unit_cost_cents: number | null;
  components: WireComponent[];
  unresolved: string[];
}

export function mapRecipeCost(wire: WireRecipeCost): RecipeCostDto {
  if (!wire || !Array.isArray(wire.components) || !Array.isArray(wire.unresolved) ||
      !wire.recipe_id || !wire.product_id ||
      (wire.unit_cost_cents !== null && !Number.isSafeInteger(wire.unit_cost_cents))) {
    throw new Error('Reçete maliyeti yanıtı geçersiz.');
  }
  return {
    recipeId: wire.recipe_id,
    productId: wire.product_id,
    totalCostCents: wire.unit_cost_cents,
    unresolvedCount: wire.unresolved.length,
    items: wire.components.map((component) => {
      if (!component.component_product_id || !component.name ||
          (component.unit_cost_cents !== null && !Number.isSafeInteger(component.unit_cost_cents)) ||
          (component.line_cost_cents !== null && !Number.isSafeInteger(component.line_cost_cents))) {
        throw new Error('Reçete bileşeni yanıtı geçersiz.');
      }
      return {
        ingredientId: component.component_product_id,
        ingredientName: component.name,
        quantity: component.quantity,
        unit: component.unit,
        unitCostCents: component.unit_cost_cents,
        lineCostCents: component.line_cost_cents,
      };
    }),
  };
}
