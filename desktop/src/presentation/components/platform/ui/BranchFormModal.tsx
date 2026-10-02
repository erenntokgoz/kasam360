import { useState } from 'react';

export interface BranchFormValues {
  name: string;
  address: string;
}

interface BranchFormModalProps {
  /** Düzenlemede kayıt kimliği; eklemede boş bırakılır. */
  branchId: string;
  initialValues: BranchFormValues;
  isBusy: boolean;
  error: string | null;
  onSubmit: (values: BranchFormValues) => void;
  onClose: () => void;
}

/**
 * Şube ekleme / düzenleme penceresi.
 *
 * Neden ayrı bileşen: `PlatformBranchesPanel` 300 satırlık bileşen sınırını
 * aşmasın diye yazma yüzeyi ayrıldı. Form yalnız değer toplar; yazma işi
 * panelin tenant bağlamıyla olur.
 */
export function BranchFormModal({
  branchId,
  initialValues,
  isBusy,
  error,
  onSubmit,
  onClose,
}: BranchFormModalProps) {
  const [values, setValues] = useState<BranchFormValues>(initialValues);
  const isEdit = branchId.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
        className="w-full max-w-sm rounded-2xl border dark:border-white/10 border-black/10 bg-white/95 dark:bg-[#1F2024]/95 p-5 backdrop-blur-2xl"
      >
        <h3 className="text-[15px] font-semibold dark:text-white text-zinc-900">
          {isEdit ? 'Şubeyi Düzenle' : 'Yeni Şube'}
        </h3>

        <label
          className="mt-4 block text-[11px] dark:text-zinc-400 text-zinc-600"
          htmlFor="branch-form-name"
        >
          Şube Adı
        </label>
        <input
          id="branch-form-name"
          value={values.name}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
          className="mt-1 w-full rounded-xl border dark:border-white/10 border-black/10 bg-white/80 dark:bg-white/[0.05] px-3 py-2 text-xs dark:text-zinc-100 text-zinc-800"
        />

        <label
          className="mt-3 block text-[11px] dark:text-zinc-400 text-zinc-600"
          htmlFor="branch-form-address"
        >
          Adres
        </label>
        <input
          id="branch-form-address"
          value={values.address}
          onChange={(event) => setValues({ ...values, address: event.target.value })}
          className="mt-1 w-full rounded-xl border dark:border-white/10 border-black/10 bg-white/80 dark:bg-white/[0.05] px-3 py-2 text-xs dark:text-zinc-100 text-zinc-800"
        />

        {error && (
          <p role="alert" className="mt-3 text-[11px] text-[#FF453A] dark:text-[#FF6B60]">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border dark:border-white/10 border-black/10 px-3 py-1.5 text-[11px] dark:text-zinc-200 text-zinc-700 hover:bg-black/[0.05] cursor-pointer"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={isBusy}
            className="rounded-xl bg-[#0A84FF] dark:bg-[#007AFF] text-white px-3 py-1.5 text-[11px] font-medium disabled:opacity-50 cursor-pointer"
          >
            Kaydet
          </button>
        </div>
      </form>
    </div>
  );
}