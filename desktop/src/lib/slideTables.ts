const DURATION_MS = 520;
const STAGGER_MS = 10;

/** İki görünüm de ölçülebilir durur: her masa eski yerinden yeni yerine kayar. */
export function slideTables(from: HTMLElement, to: HTMLElement) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  to.querySelectorAll<HTMLElement>('[data-table-id]').forEach((element, index) => {
    const start = from.querySelector(`[data-table-id="${element.dataset.tableId}"]`)?.getBoundingClientRect();
    const end = element.getBoundingClientRect();
    if (!start || end.width === 0) return;
    // Kroki ölçekli çizilir: kaydırma, öğenin kendi ölçeğine çevrilir.
    const parentScale = end.width / element.offsetWidth;
    const x = (start.left - end.left) / parentScale;
    const y = (start.top - end.top) / parentScale;
    element.style.transformOrigin = 'top left';
    element.animate(
      [{ transform: `translate(${x}px, ${y}px) scale(${start.width / end.width}, ${start.height / end.height})` }, { transform: 'none' }],
      { duration: DURATION_MS, delay: index * STAGGER_MS, easing: 'cubic-bezier(.22,.8,.2,1)', fill: 'backwards' },
    );
  });
}
