import { describe, expect, it } from 'vitest';
import { buildNavSections, greetingFor, initials, type NavEntry } from './shellModel';

const entries: NavEntry[] = [
  { id: 'FLOOR', label: 'Salon', visible: true },
  { id: 'KDS', label: 'Mutfak', badge: 3, visible: true },
  { id: 'CASHIER', label: 'Kasa', visible: true },
  { id: 'ERP', label: 'Yönetim', visible: false },
  { id: 'SETTINGS', label: 'Ayarlar', visible: true },
];

describe('kenar çubuğu modeli', () => {
  it('görünmeyen öğeyi göstermez ve boş grubu atar', () => {
    const sections = buildNavSections(entries, '');
    expect(sections.map((section) => section.title)).toEqual(['OPERASYON', 'PARA', 'İŞLETME']);
    expect(sections.flatMap((section) => section.items.map((item) => item.id))).not.toContain('ERP');
  });

  it('aramayla yalnız görünür öğeleri daraltır', () => {
    expect(buildNavSections(entries, 'mut').flatMap((section) => section.items.map((item) => item.id))).toEqual(['KDS']);
    expect(buildNavSections(entries, 'yönetim')).toEqual([]);
  });

  it('rozet sayısını korur', () => {
    expect(buildNavSections(entries, '')[0].items.find((item) => item.id === 'KDS')?.badge).toBe(3);
  });
});

describe('karşılama ve kişi kartı', () => {
  it('günün saatine göre selam seçer', () => {
    expect(greetingFor(new Date(2026, 10, 11, 8))).toBe('Günaydın');
    expect(greetingFor(new Date(2026, 10, 11, 14))).toBe('İyi günler');
    expect(greetingFor(new Date(2026, 10, 11, 21))).toBe('İyi akşamlar');
    expect(greetingFor(new Date(2026, 10, 11, 2))).toBe('İyi akşamlar');
  });

  it('adın baş harflerini üretir', () => {
    expect(initials('Eren Tokgöz')).toBe('ET');
    expect(initials('ayşe')).toBe('A');
    expect(initials(undefined)).toBe('?');
  });
});
