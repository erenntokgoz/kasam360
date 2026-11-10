import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InlineAlert } from './InlineAlert';

describe('InlineAlert', () => {
  it('hatayı akış içinde alert olarak gösterir ve kapatma düğmesi 48px hedeftir', () => {
    const html = renderToStaticMarkup(<InlineAlert message="Sipariş gönderilmedi." onDismiss={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Sipariş gönderilmedi.');
    expect(html).toContain('aria-label="Hatayı kapat"');
    expect(html).toContain('size-12');
  });

  it('kapatma işlevi verilmezse düğme çizilmez', () => {
    expect(renderToStaticMarkup(<InlineAlert message="Hata" />)).not.toContain('<button');
  });
});
