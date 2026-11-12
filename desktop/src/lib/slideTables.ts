import { prefersReducedMotion } from './motion';
const DURATION_MS = 520;
const STAGGER_MS = 10;

/**
 * Masa `--rot` ile döndürülmüşse sınır kutusu büyür; kayma ve ölçek dönüşsüz (adlandırılmış) ölçüden
 * hesaplanır. Kroki masaları kare olduğundan |cos|+|sin| çarpanı yeterlidir.
 */
export function unrotatedSize(rect: { width: number; height: number }, rotationDegrees: number) {
  const radians = (rotationDegrees * Math.PI) / 180;
  const factor = Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians));
  return { width: rect.width / factor, height: rect.height / factor };
}

const rotationOf = (element: HTMLElement) => Number.parseFloat(element.style.getPropertyValue('--rot')) || 0;

/**
 * İki görünüm de ölçülebilir durur: her masa eski yerinden yeni yerine kayar.
 * Animasyon `transform` değil bağımsız `translate`/`scale` özelliklerini kullanır: masanın kalıcı açısı
 * (`transform: rotate`) ve dönüş merkezi bozulmaz, aksi halde görünüm değişince dönük masa köşesinden sapıyordu.
 */
export function slideTables(from: HTMLElement, to: HTMLElement) {
  if (prefersReducedMotion()) return;
  to.querySelectorAll<HTMLElement>('[data-table-id]').forEach((element, index) => {
    const source = from.querySelector<HTMLElement>(`[data-table-id="${element.dataset.tableId}"]`);
    const start = source?.getBoundingClientRect();
    const end = element.getBoundingClientRect();
    if (!source || !start || end.width === 0) return;
    // Kroki ölçekli çizilir: kaydırma, öğenin kendi ölçeğine çevrilir.
    const from0 = unrotatedSize(start, rotationOf(source));
    const to0 = unrotatedSize(end, rotationOf(element));
    const parentScale = to0.width / element.offsetWidth;
    const x = (start.left + start.width / 2 - (end.left + end.width / 2)) / parentScale;
    const y = (start.top + start.height / 2 - (end.top + end.height / 2)) / parentScale;
    element.animate(
      [{ translate: `${x}px ${y}px`, scale: from0.width / to0.width }, { translate: '0px 0px', scale: 1 }],
      { duration: DURATION_MS, delay: index * STAGGER_MS, easing: 'cubic-bezier(.22,.8,.2,1)', fill: 'backwards' },
    );
  });
}
