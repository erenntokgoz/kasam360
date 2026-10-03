/**
 * Faz 13 · Kart / Kroki görünüm anahtarı.
 *
 * Neden ayrı bileşen: anahtar hem salon panosunda hem de kroki başlığında
 * kullanılıyor. İki yerde yazılırsa biri güncellenmeyi unutur ve iki ekran
 * farklı görünümde açılır.
 */

export type FloorViewMode = 'grid' | 'map';

export interface ViewToggleProps {
  mode: FloorViewMode;
  onChange: (mode: FloorViewMode) => void;
  /** Kroki görünümü kullanıcıya açık mı? Kapalıysa kilitli gösterilir. */
  mapAvailable?: boolean;
}

const SECENEKLER: { mod: FloorViewMode; etiket: string }[] = [
  { mod: 'grid', etiket: 'Kart' },
  { mod: 'map', etiket: 'Kroki' },
];

export function ViewToggle({ mode, onChange, mapAvailable = true }: ViewToggleProps) {
  return (
    <div
      role="group"
      aria-label="Salon görünümü"
      className="flex items-center rounded-full border border-[var(--border)] bg-[var(--glass-thin)] p-1"
    >
      {SECENEKLER.map(({ mod, etiket }) => {
        const aktif = mode === mod;
        const kilitli = mod === 'map' && !mapAvailable;
        return (
          <button
            key={mod}
            type="button"
            aria-pressed={aktif}
            disabled={kilitli}
            onClick={() => onChange(mod)}
            className={`rounded-full px-4 py-1 text-xs transition-colors active:scale-95 touch-manipulation disabled:opacity-40 ${
              aktif
                ? 'bg-[var(--glass-heavy)] font-semibold'
                : 'opacity-70 hover:opacity-100'
            }`}
          >
            {etiket}
          </button>
        );
      })}
    </div>
  );
}