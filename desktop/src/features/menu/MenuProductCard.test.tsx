import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProductDto } from '../../types/menu';
import { MenuProductCard } from './MenuProductCard';

const kart = (extra: Partial<ProductDto>) => renderToStaticMarkup(
  <MenuProductCard
    product={{ id: 'prd_1', name: 'Kek', categoryId: 'cat_1', priceCents: 5000, isActive: true, is86: false, isRaw: false, ...extra }}
    isSelected={false} onSelect={() => undefined} station={null} isChecked={false} onCheck={() => undefined}
  />,
);

describe('ürün kartı durumu', () => {
  it('tükendi ve satış dışını ayrı adla gösterir', () => {
    expect(kart({ is86: true })).toContain('Tükendi');
    expect(kart({ is86: true })).not.toContain('Satış Dışı');
    expect(kart({ isActive: false })).toContain('Satış Dışı');
    expect(kart({ isActive: false })).not.toContain('Tükendi');
    const ikisi = kart({ isActive: false, is86: true });
    expect(ikisi).toContain('Tükendi');
    expect(ikisi).toContain('Satış Dışı');
    expect(kart({})).toContain('Satışta');
  });
});
