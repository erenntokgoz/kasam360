interface BranchArchiveDialogProps {
  branchName: string;
  isBusy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Şube arşivleme onayı.
 *
 * Metin bilinçli olarak "silme" dilini kullanmaz: şube fiziksel olarak silinmez,
 * `status = 'ARCHIVED'` olur. Geçmiş sipariş ve vardiya kayıtları bu şubeye
 * bağlıdır; son aktif şube arşivlenemez.
 */
export function BranchArchiveDialog({
  branchName,
  isBusy,
  onConfirm,
  onCancel,
}: BranchArchiveDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="w-full max-w-sm rounded-2xl border dark:border-white/10 border-black/10 bg-white/95 dark:bg-[#1F2024]/95 p-5 backdrop-blur-2xl">
        <h3 className="text-[15px] font-semibold dark:text-white text-zinc-900">
          Şubeyi arşivle
        </h3>
        <p className="mt-2 text-xs dark:text-zinc-300 text-zinc-600">
          {branchName} şubesi arşivlenecek. Geçmiş sipariş ve vardiya kayıtları
          korunur; son aktif şube arşivlenemez.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border dark:border-white/10 border-black/10 px-3 py-1.5 text-[11px] dark:text-zinc-200 text-zinc-700 cursor-pointer"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className="rounded-xl bg-[#FF453A] text-white px-3 py-1.5 text-[11px] font-medium disabled:opacity-50 cursor-pointer"
          >
            Arşivle
          </button>
        </div>
      </div>
    </div>
  );
}