import { Compass } from 'lucide-react';

/**
 * Kapalı özellik için **404 yüzeyi**.
 *
 * Neden 404 ve boş ekran değil: AGENTS.md §3.3 "Feature flag kapalıyken route açık
 * YASAK (404 dönmeli)". Kullanıcı "menüde yok" ile "menüde var ama çalışmıyor"
 * durumlarını ayırt edemez; 404 ikisini de doğru biçimde "bu işletmede yok"
 * der.
 *
 * `reload()` bilinçli olarak sunulmaz: bayrağı yalnız MASTER açabilir ve açma
 * işlemi başka bir ekrandadır.
 */
export function FeatureDisabledNotice({
  featureName,
  hint,
}: {
  featureName: string;
  hint: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-3xl border border-black/[0.08] dark:border-white/10 bg-white/70 dark:bg-white/[0.03] px-8 py-12 text-center backdrop-blur-xl"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/[0.04] dark:bg-white/[0.06] text-zinc-500 dark:text-zinc-400">
        <Compass size={22} />
      </span>

      <div className="space-y-1.5">
        <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          404
        </p>
        <h2 className="text-[17px] font-semibold tracking-tight text-zinc-900 dark:text-white">
          {featureName} bu işletmede etkin değil
        </h2>
        <p className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">{hint}</p>
      </div>

      <p className="text-[11px] text-zinc-500 dark:text-zinc-500">
        Özellik anahtarlarını yalnız platform yöneticisi (MASTER) değiştirebilir.
      </p>
    </div>
  );
}