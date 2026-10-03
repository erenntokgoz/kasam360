/**
 * Faz 13 · Kroki üst çubuğu: obje ekleme, şablon ve kaydetme.
 *
 * Neden ayrı bileşen: üst çubuk veri taşımaz, yalnız geri çağırma yapar.
 * Çizim yüzeyinin sorumluluğu sadece "nerede", üst çubuğunki "ne yapılır".
 */

import { OBJECT_KIND_LABELS, type FloorTemplateInfo, type ObjectKind } from './krokiTypes';
import { TemplatePicker } from './TemplatePicker';

export interface FloorPlanToolbarProps {
  templates: FloorTemplateInfo[];
  dirty: boolean;
  saving: boolean;
  canEdit: boolean;
  error: string | null;
  onAddObject: (kind: ObjectKind) => void;
  onApplyTemplate: (templateId: string) => void | Promise<void>;
  onSave: () => void;
}

const BUTON_TEMEL =
  'rounded-full border border-[var(--border)] bg-[var(--glass-regular)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--glass-thick)] active:scale-95 touch-manipulation disabled:opacity-40';

export function FloorPlanToolbar({
  templates,
  dirty,
  saving,
  canEdit,
  error,
  onAddObject,
  onApplyTemplate,
  onSave,
}: FloorPlanToolbarProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {canEdit &&
            (Object.keys(OBJECT_KIND_LABELS) as ObjectKind[]).map((tur) => (
              <button
                key={tur}
                type="button"
                onClick={() => onAddObject(tur)}
                className={BUTON_TEMEL}
              >
                {OBJECT_KIND_LABELS[tur]} ekle
              </button>
            ))}
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            <TemplatePicker templates={templates} onUygula={onApplyTemplate} />
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || saving}
              className="rounded-full border border-[var(--border)] bg-[var(--glass-thick)] px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--glass-heavy)] active:scale-95 touch-manipulation disabled:opacity-40"
            >
              {saving ? 'Kaydediliyor' : dirty ? 'Kaydet' : 'Kaydedildi'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="px-1 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}