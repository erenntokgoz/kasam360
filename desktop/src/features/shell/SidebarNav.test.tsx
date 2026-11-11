import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarNav } from './SidebarNav';
import { TopBar } from './TopBar';

describe('uygulama iskeleti', () => {
  it('oturum yokken rolün görmediği menüyü göstermez', () => {
    const html = renderToStaticMarkup(<SidebarNav />);
    expect(html).toContain('Menüde ara');
    expect(html).toContain('Koyu mod');
    expect(html).toContain('Eşleşen menü yok');
    expect(html).not.toContain('Kilitle');
  });

  it('üst çubuk karşılama ve ekran adını taşır', () => {
    const html = renderToStaticMarkup(<TopBar />);
    expect(html).toMatch(/Günaydın|İyi günler|İyi akşamlar/);
    expect(html).toContain('Salon');
  });
});
