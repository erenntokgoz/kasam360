import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MenuRecipeTab } from './MenuRecipeTab';

describe('reçetede ilk malzeme', () => {
  it('stok kalemi yokken de malzeme ekleme yolunu açar', () => {
    const html = renderToStaticMarkup(<MenuRecipeTab
      product={{ id: 'prd_food', name: 'Yemek', categoryId: 'cat_food', priceCents: 10000, isActive: true, is86: false }}
      products={[]} cost={null} busy={false} createRecipe={async () => true} deactivateRecipe={async () => true}
    />);
    expect(html).toContain('Malzeme Ekle');
    expect(html).not.toContain('önce hammaddeyi');
  });
});
