import { AlertTriangle, Info, X } from 'lucide-react';

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
  cancelText = 'İptal',
  confirmVariant = 'danger',
  isLoading = false,
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  const getVariantStyles = () => {
    switch (confirmVariant) {
      case 'danger':
        return 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/30';
      case 'warning':
        return 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/30';
      case 'primary':
      default:
        return 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/30';
    }
  };

  const getIcon = () => {
    switch (confirmVariant) {
      case 'danger':
      case 'warning':
        return (
          <div className="p-3 bg-red-500/10 text-red-400 rounded-full">
            <AlertTriangle size={24} />
          </div>
        );
      case 'primary':
      default:
        return (
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-full">
            <Info size={24} />
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {getIcon()}
            <div>
              <h3 className="text-lg font-bold text-white">{title}</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed pl-1">
          {description}
        </p>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${getVariantStyles()}`}
          >
            {isLoading ? 'İşleniyor...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
