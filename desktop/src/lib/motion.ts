/** Hareket süreleri tek yerde durur; CSS'teki kapanış süreleriyle aynı tutulur. */
export const EXIT_MS = 140;

/**
 * Tarayıcı hareket azaltma istiyorsa ya da ortamda medya sorgusu yoksa (test, sunucu çizimi)
 * hareket çalıştırılmaz. Böylece testler kapanış kopyası yüzünden çift metin görmez.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  if (isMotionForced()) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const MOTION_KEY = 'kasam360.motion';

/**
 * Sistem "animasyonları kaldır" açıkken (Windows ve Android'de sık: performans ayarı) uygulamanın
 * hiçbir hareketi çalışmaz ve kullanıcı bunu hata sanır. Ayarlardan "Animasyon Açık" seçilirse
 * sistem tercihi bu uygulama için yok sayılır. Varsayılan sistem tercihine uymaktır.
 */
export function isMotionForced(): boolean {
  try {
    return window.localStorage.getItem(MOTION_KEY) === 'full';
  } catch {
    return false;
  }
}

/** Seçimi saklar ve CSS'in hareket azaltma bloklarını devre dışı bırakan kök işaretini yazar. */
export function setMotionForced(forced: boolean): void {
  try {
    if (forced) window.localStorage.setItem(MOTION_KEY, 'full');
    else window.localStorage.removeItem(MOTION_KEY);
  } catch {
    // Depo yazılamazsa seçim yalnız bu açılışta geçerlidir.
  }
  applyMotionPreference(forced);
}

export function applyMotionPreference(forced = isMotionForced()): void {
  if (typeof document === 'undefined') return;
  if (forced) document.documentElement.dataset.motion = 'full';
  else delete document.documentElement.dataset.motion;
}

/**
 * Kapanan pencerenin donmuş bir kopyasını kısa süre söndürür.
 * Kopya React'e bağlı değildir: kapanan bileşenin durumu silinmiş olsa da çökme olmaz.
 * Tıklama, odak ve ekran okuyucu kopyayı görmez; asıl ekran beklemeden kullanılabilir.
 */
export function spawnExitGhost(ghost: HTMLElement, scrolls: Array<[number, number]>) {
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.removeAttribute('id');
  ghost.removeAttribute('role');
  ghost.removeAttribute('aria-modal');
  // Esc ve odak tuzağı en üstteki [role="dialog"] öğesine bakar; kopya o sayıma girmemeli.
  ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  ghost.querySelectorAll('[role="dialog"],[role="alert"],[role="status"]').forEach((node) => node.removeAttribute('role'));
  ghost.classList.add('motion-ghost');
  document.body.appendChild(ghost);

  if (scrolls.length > 0) {
    const nodes = [ghost, ...ghost.querySelectorAll('*')];
    scrolls.forEach(([index, top]) => { const node = nodes[index]; if (node) node.scrollTop = top; });
  }

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    ghost.remove();
  };
  ghost.addEventListener('animationend', (event) => { if (event.target === ghost) remove(); });
  // Animasyon olayı gelmezse (sekme arka planda) kopya ekranda kalmasın.
  window.setTimeout(remove, EXIT_MS + 80);
}
