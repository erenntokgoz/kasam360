'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef, useState } from 'react';
import { formatMenuPrice } from '@/lib/menuView';
import type { MenuProduct } from '@/lib/qrMenu';
import { CloseIcon } from './MenuIcons';
import { ProductImage } from './ProductImage';

gsap.registerPlugin(useGSAP);

// Alttan açılan ürün ayrıntısı. Yerel <dialog> modal kullanılır: odak sheet içinde tutulur, Esc kapatır,
// kapanınca odak sheet'i açan öğeye döner. Kapatma isteği üst bileşene gider (geri tuşu geçmişiyle birlikte yönetilir).
export function ProductSheet({ product, currency, onRequestClose }: {
  product: MenuProduct | null; currency: string; onRequestClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Kapanış animasyonu sırasında içerik kaybolmasın diye son ürün tutulur.
  const [shown, setShown] = useState<MenuProduct | null>(product);
  if (product && product !== shown) setShown(product);

  useGSAP(() => {
    const node = dialog.current;
    const body = panel.current;
    if (!node) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (product) {
      if (!node.open) node.showModal();
      // Odak açılışta kapatma düğmesine alınır (animasyon görünürlüğü değiştirmeden önce); klavye ve ekran okuyucu sheet içinde başlar.
      // Sonraya bırakılır: pushState sonrası Next yönlendiricisi odağı kendi köküne alabilir.
      window.setTimeout(() => node.querySelector<HTMLElement>('.m-sheet-close')?.focus({ preventScroll: true }), 60);
      if (body) {
        body.scrollTop = 0;
        if (!reduce) {
          gsap.fromTo(body, { yPercent: 8, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.32, ease: 'power3.out', clearProps: 'transform,opacity,visibility' });
        }
      }
    } else if (node.open) {
      if (reduce || !body) node.close();
      else {
        gsap.to(body, { yPercent: 6, autoAlpha: 0, duration: 0.2, ease: 'power2.in', onComplete: () => { node.close(); gsap.set(body, { clearProps: 'all' }); } });
      }
    }
  }, { dependencies: [product] });

  return (
    <dialog
      ref={dialog}
      className="m-sheet"
      aria-labelledby="m-sheet-title"
      onCancel={(event) => {
        event.preventDefault();
        onRequestClose();
      }}
      onClick={(event) => {
        // Dış yüzeye (karartma) dokunmak kapatır; içerikteki tıklamalar kapatmaz.
        if (event.target === event.currentTarget) onRequestClose();
      }}
    >
      {shown && (
        <div className="m-sheet-panel" ref={panel}>
          <button type="button" className="m-sheet-close" onClick={onRequestClose} aria-label="Kapat">
            <CloseIcon />
          </button>
          {shown.image && (
            <div className="m-sheet-media">
              <ProductImage src={shown.image} alt={shown.name} priority />
            </div>
          )}
          <div className="m-sheet-body">
            <h2 id="m-sheet-title">{shown.name}</h2>
            <p className="m-sheet-price k-num">
              {formatMenuPrice(shown.priceCents, currency)}
              {!shown.inStock && <span className="m-badge">Tükendi</span>}
            </p>
            {shown.description && <p className="m-sheet-desc">{shown.description}</p>}
          </div>
        </div>
      )}
    </dialog>
  );
}
