import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useFeatureStore } from '../../stores/featureStore';
import { Menu360FiyatTab } from './Menu360FiyatTab';

describe('toplu fiyat ekranı', () => {
  it('dinamik fiyat bayrağı kapalıyken boş tarife yönetimini göstermez', () => {
    useFeatureStore.getState().setModules([]);
    const html = renderToStaticMarkup(<Menu360FiyatTab />);
    expect(html).toContain('Toplu Fiyat Artışı');
    expect(html).not.toContain('Fiyat Listeleri');
  });
});
