'use client';

import { useCallback, useState } from 'react';

// Görsel kutusunun oranı CSS ile ayrılır (kayma olmaz); yüklenene kadar düz zemin görünür, sonra görsel solarak gelir.
// Sunucudan gelen görsel zaten WebP ve içerik-adreslidir; ek bir optimizasyon katmanı gerekmez.
export function ProductImage({ src, alt, priority = false }: { src: string; alt: string; priority?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  // Hidrasyondan önce yüklenmiş görselde onLoad kaçmış olabilir; ref içinde tamamlanma kontrol edilir.
  const ref = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) setLoaded(true);
  }, []);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      className="m-img"
      data-loaded={loaded}
      src={src}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(true)}
    />
  );
}
