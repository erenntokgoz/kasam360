/**
 * Faz 13 · Hazır şablon seçici.
 *
 * Şablon uygulamak **geri alınamaz** bir toplu işlemdir: masalar yeniden
 * konumlanır. Bu yüzden düğme, uygulamadan önce uyarı ister. Onaysız buton
 * kullanıcının saatlerce çizdiği salonu tek tıkla dağıtır.
 */

import { useState } from 'react';
import type { FloorTemplateInfo } from './krokiTypes';

export interface TemplatePickerProps {
  templates: FloorTemplateInfo[];
  onUygula: (templateId: string) => void | Promise<void>;
  disabled?: boolean;
}

export function TemplatePicker({ templates, onUygula, disabled }: TemplatePickerProps) {
  const [acik, setAcik] = useState(false);
  const [onayBekleyen, setOnayBekleyen] = useState<FloorTemplateInfo | null>(null);

  if (templates.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAcik((oncekisi) => !oncekisi)}
        aria-expanded={acik}
        aria-haspopup="menu"
        className="rounded-full border border-[var(--border)] bg-[var(--glass-regular)] px-4 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--glass-thick)] active:scale-95 touch-manipulation disabled:opacity-40"
      >
        Şablon
      </button>

      {acik && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--glass-ultra)] backdrop-blur-xl shadow-lg"
        >
          {templates.map((sablon) => (
            <button
              key={sablon.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setAcik(false);
                setOnayBekleyen(sablon);
              }}
              className="flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-[var(--glass-thick)]"
            >
              <span className="text-xs font-semibold">{sablon.name}</span>
              <span className="text-[11px] opacity-60">{sablon.description}</span>
            </button>
          ))}
        </div>
      )}

      {onayBekleyen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div
            role="alertdialog"
            aria-labelledby="sablon-onay-baslik"
            className="w-80 rounded-2xl border border-[var(--border)] bg-[var(--glass-ultra)] p-5 shadow-xl"
          >
            <h2 id="sablon-onay-baslik" className="text-sm font-semibold">
              {onayBekleyen.name} şablonu uygulansın mı?
            </h2>
            <p className="mt-2 text-xs opacity-70">
              Masanız bu yerleşime göre yeniden konumlanır. {onayBekleyen.description}.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOnayBekleyen(null)}
                className="rounded-full border border-[var(--border)] px-4 py-1.5 text-xs active:scale-95"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => {
                  void onUygula(onayBekleyen.id);
                  setOnayBekleyen(null);
                }}
                className="rounded-full border border-[var(--brand)] px-4 py-1.5 text-xs font-semibold active:scale-95"
              >
                Uygula
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}