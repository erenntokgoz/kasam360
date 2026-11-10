import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TableCardGrid } from './TableCardGrid';

const noop = () => undefined;

describe('TableCardGrid boş durumları', () => {
  it('süzgeç sonucu boşsa masaları değil verilen boş durumu gösterir', () => {
    const html = renderToStaticMarkup(
      <TableCardGrid tables={[]} onOpenTable={noop} onInspectTable={noop} empty={<span>Bu durumda masa yok.</span>} />,
    );
    expect(html).toContain('Bu durumda masa yok.');
    expect(html).not.toContain('table-spot');
  });

  it('boş durum verilmezse varsayılan metin gösterilir', () => {
    const html = renderToStaticMarkup(<TableCardGrid tables={[]} onOpenTable={noop} onInspectTable={noop} />);
    expect(html).toContain('Bu durumda masa yok.');
  });
});
