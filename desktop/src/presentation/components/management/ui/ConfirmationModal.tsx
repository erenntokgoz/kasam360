import { useEffect } from 'react';
import { AlertTriangle, Info } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'danger' | 'primary' | 'warning';
  isLoading?: boolean;
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Onayla',
  cancelText = 'Vazgeç',
  confirmVariant = 'danger',
  isLoading = false,
}: ConfirmationModalProps) {
  // Escape tuşuna basıldığında modalı kapat
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const getVariantStyles = () => {
    switch (confirmVariant) {
      case 'danger':
        return 'bg-red-600 hover:bg-red-500 text-white font-semibold';
      case 'warning':
        return 'bg-amber-500 hover:bg-amber-400 text-black font-semibold';
      case 'primary':
      default:
        return 'bg-white hover:bg-zinc-200 text-black font-semibold';
    }
  };

  const getIcon = () => {
    switch (confirmVariant) {
      case 'danger':
      case 'warning':
        return (
          <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mb-3">
            <AlertTriangle size={20} />
          </div>
        );
      case 'primary':
      default:
        return (
          <div className="w-12 h-12 rounded-full bg-[#007AFF]/10 border border-[#007AFF]/50/20 text-[#007AFF] flex items-center justify-center mb-3">
            <Info size={20} />
          </div>
        );
    }
  };

  return (
    <div
      onClick={e => {
        if (e.target === e.currentTarget && !isLoading) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
    >
      <div className="backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-sm w-full p-6 text-center shadow-2xl flex flex-col items-center dark:text-zinc-100 text-zinc-900 animate-in zoom-in-95 duration-150">
        {getIcon()}

        <h3 className="font-semibold text-base dark:text-white text-zinc-900">{title}</h3>
        <p className="text-xs dark:text-zinc-400 text-zinc-600 mt-1.5 leading-relaxed">
          {description}
        </p>

        <div className="flex gap-2 w-full mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 py-2.5 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-zinc-300 text-zinc-700 font-semibold rounded-2xl text-xs transition-all disabled:opacity-50 cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`flex-1 py-2.5 rounded-2xl text-xs transition-all disabled:opacity-50 cursor-pointer active:scale-95 shadow-sm ${getVariantStyles()}`}
          >
            {isLoading ? 'İşleniyor...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
