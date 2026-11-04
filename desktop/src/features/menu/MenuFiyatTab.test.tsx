import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useFeatureStore } from '../../stores/featureStore';
import { MenuFiyatTab } from './MenuFiyatTab';

describe('toplu fiyat ekranı', () => {
  it('dinamik fiyat bayrağı kapalıyken boş tarife yönetimini göstermez', () => {
    useFeatureStore.getState().setModules([]);
    const html = renderToStaticMarkup(<MenuFiyatTab />);
    expect(html).toContain('Toplu Fiyat Artışı');
    expect(html).not.toContain('Fiyat Listeleri');
  });
});
