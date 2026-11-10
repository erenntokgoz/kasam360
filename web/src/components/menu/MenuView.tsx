'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterCategories, sectionId } from '@/lib/menuView';
import { displayName, type MenuProduct, type PublicMenu } from '@/lib/qrMenu';
import { CategoryTabs } from './CategoryTabs';
import { MoonIcon, SearchIcon, SunIcon } from './MenuIcons';
import { ProductCard } from './ProductCard';
import { ProductRow } from './ProductRow';
import { ProductSheet } from './ProductSheet';

gsap.registerPlugin(useGSAP, ScrollTrigger);

const SHEET_STATE = 'k360-menu-sheet';
// Sabit sekme şeridinin altında kalmaması için bölüm başlığına verilen pay (menu.css içindeki --m-sticky ile aynı).
const STICKY_OFFSET = 72;

function useTheme(): [boolean | null, () => void] {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => setDark(document.documentElement.dataset.theme === 'dark'), []);
  const toggle = () => {
    const next = !dark;
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try { localStorage.setItem('k360-theme', next ? 'dark' : 'light'); } catch { /* depolama kapalı: seçim kalıcı olmaz */ }
    setDark(next);
  };
  return [dark, toggle];
}

export function MenuView({ menu }: { menu: PublicMenu }) {
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<MenuProduct | null>(null);
  const [dark, toggleTheme] = useTheme();
  const categories = useMemo(() => filterCategories(menu.categories, query), [menu.categories, query]);
  const [activeState, setActive] = useState<string | null>(null);
  // Etkin sekme yoksa ya da aramayla görünmez olduysa ilk görünür kategoridir.
  const activeId = categories.some((category) => category.id === activeState) ? activeState : (categories[0]?.id ?? null);
  const scrollLock = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);

  // Kaydırma izleme: sabit şeridin altına ulaşmış son bölüm etkin sekmedir; sayfa sonunda son bölüm.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (scrollLock.current || categories.length === 0) return;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current = categories[0].id;
      if (atBottom) current = categories[categories.length - 1].id;
      else {
        for (const category of categories) {
          const section = document.getElementById(sectionId(category.id));
          if (section && section.getBoundingClientRect().top <= STICKY_OFFSET + 16) current = category.id;
        }
      }
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [categories]);

  const jumpTo = useCallback((categoryId: string) => {
    const section = document.getElementById(sectionId(categoryId));
    if (!section) return;
    setActive(categoryId);
    scrollLock.current = true;
    const release = () => { scrollLock.current = false; };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    // scrollend yoksa (eski tarayıcı) zaman aşımı kilidi açar.
    window.addEventListener('scrollend', release, { once: true });
    window.setTimeout(release, reduce ? 50 : 1200);
  }, []);

  // Sheet açılınca bir geçmiş girdisi eklenir: tarayıcı/telefon geri tuşu sayfadan çıkmadan sheet'i kapatır.
  const openProduct = useCallback((product: MenuProduct, source: HTMLElement) => {
    trigger.current = source;
    window.history.pushState({ [SHEET_STATE]: true }, '');
    setSelected(product);
  }, []);
  const requestClose = useCallback(() => {
    if (window.history.state?.[SHEET_STATE]) window.history.back();
    else setSelected(null);
  }, []);
  useEffect(() => {
    const onPop = () => {
      setSelected(null);
      // <dialog> kapanınca odağı kendisi geri verir; yine de kart kaldırıldıysa korumalı davranılır.
      if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Giriş animasyonları: üst bölüm ve sekmeler sırayla, kartlar görünür olurken küçük gruplar halinde.
  // Azaltılmış harekette hiçbiri çalışmaz; içerik doğrudan görünür. Başlangıç gizliliği CSS'te data-anim ile
  // tutulur ki hidrasyondan önce içerik yanıp sönmesin.
  useGSAP(() => {
    const node = root.current;
    if (!node) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from('.m-head > *', { autoAlpha: 0, y: 10, duration: 0.5, ease: 'power3.out', stagger: 0.07 });
      gsap.from('.m-tabs', { autoAlpha: 0, duration: 0.5, delay: 0.15, ease: 'power2.out' });
      const cards = gsap.utils.toArray<HTMLElement>('.m-card, .m-list');
      gsap.set(cards, { autoAlpha: 0, y: 14 });
      node.dataset.anim = 'ready';
      ScrollTrigger.batch(cards, {
        start: 'top 94%',
        once: true,
        onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power3.out', stagger: 0.05, overwrite: true, clearProps: 'transform,opacity,visibility' }),
      });
    });
    mm.add('(prefers-reduced-motion: reduce)', () => {
      node.dataset.anim = 'ready';
    });
  }, { scope: root });

  const name = displayName(menu);
  let imageBudget = 4;

  return (
    <div className="m-root" ref={root} data-anim="pending">
      <header className="m-head">
        <div className="m-brand">
          <h1 className="m-title">{name}</h1>
          {/* Alt satır: API işletme adına eklenecek açıklama alanı gelene kadar menü adresi. */}
          <p className="m-subline">menu.kasam360.com.tr/{menu.slug}</p>
        </div>
        <button type="button" className="m-icon-btn" onClick={toggleTheme} aria-label={dark ? 'Açık temaya geç' : 'Koyu temaya geç'}>
          {dark ? <SunIcon /> : <MoonIcon />}
        </button>
        <label className="m-search">
          <span className="m-search-label">Ara</span>
          <span className="m-search-box">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ürün adı"
              enterKeyHint="search"
              autoComplete="off"
            />
          </span>
        </label>
      </header>

      <CategoryTabs categories={categories} activeId={activeId} onSelect={jumpTo} />

      <main className="m-main" id="menu">
        {categories.length === 0 ? (
          <div className="m-empty" role="status">
            <p>{query.trim() ? `“${query.trim()}” için sonuç yok` : 'Bu menüde henüz ürün yok'}</p>
            {query.trim() && (
              <button type="button" className="m-btn" onClick={() => setQuery('')}>
                Aramayı temizle
              </button>
            )}
          </div>
        ) : (
          categories.map((category) => (
            <section key={category.id} id={sectionId(category.id)} className="m-section" aria-labelledby={`${sectionId(category.id)}-t`}>
              <h2 id={`${sectionId(category.id)}-t`}>{category.name}</h2>
              {/* Önce görselli ürünler ızgarada, görselsizler ardından tek liste bloğunda. */}
              {category.products.some((product) => product.image) && (
                <div className="m-grid">
                  {category.products.filter((product) => product.image).map((product) => {
                    const priority = imageBudget > 0;
                    if (priority) imageBudget -= 1;
                    return <ProductCard key={product.id} product={product} currency={menu.currency} priority={priority} onOpen={openProduct} />;
                  })}
                </div>
              )}
              {category.products.some((product) => !product.image) && (
                <ul className="m-list">
                  {category.products.filter((product) => !product.image).map((product) => (
                    <li key={product.id}>
                      <ProductRow product={product} currency={menu.currency} onOpen={openProduct} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
      </main>

      <ProductSheet product={selected} currency={menu.currency} onRequestClose={requestClose} />
    </div>
  );
}
