import { X } from 'lucide-react';

export interface PaymentModalPanelProps {
  isOpen: boolean;
  totalAmount: number;
  tenderedAmount: string;
  isSubmitting: boolean;
  onNumpadPress: (value: string) => void;
  onClose: () => void;
  onExactAmount: () => void;
  onSubmitPayment: (method: 'CASH' | 'CREDIT_CARD') => void;
}

const PRESET_AMOUNTS = [50, 100, 200, 500];

export function PaymentModalPanel({
  isOpen,
  totalAmount,
  tenderedAmount,
  isSubmitting,
  onNumpadPress,
  onClose,
  onExactAmount,
  onSubmitPayment,
}: PaymentModalPanelProps): JSX.Element | null {
  if (!isOpen) return null;

  const parsedTenderedCents = Math.round((parseFloat(tenderedAmount) || 0) * 100);
  const changeAmountCents = Math.max(0, parsedTenderedCents - totalAmount);

  const NumpadButton = ({ label, onClick, className = '' }: { label: React.ReactNode; onClick: () => void; className?: string }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={isSubmitting}
      className={`h-24 w-24 rounded-xl bg-slate-800 text-4xl font-medium text-slate-100 shadow-md touch-manipulation active:scale-95 disabled:opacity-50 transition-transform ${className}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="flex w-full max-w-5xl h-[600px] bg-slate-900 rounded-3xl overflow-hidden shadow-2xl border border-slate-700">
        
        {/* Left Side: Order Summary */}
        <div className="flex-1 p-8 flex flex-col justify-between border-r border-slate-800 bg-slate-900/50">
          <div>
            <div className="flex justify-between items-start mb-12">
              <h2 className="text-3xl font-bold text-slate-100">Ödeme</h2>
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="p-4 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-400 hover:text-slate-200 transition-colors"
              >
                <X size={32} />
              </button>
            </div>
            
            <div className="space-y-6">
              <div>
                <p className="text-xl text-slate-400 mb-2">Ödenecek Tutar</p>
                <p className="text-emerald-400 text-6xl font-mono font-bold tracking-tight">
                  {(totalAmount / 100).toFixed(2)}₺
                </p>
              </div>

              <div>
                <p className="text-xl text-slate-400 mb-2">Alınan Tutar</p>
                <p className="text-white text-5xl font-mono tracking-tight">
                  {tenderedAmount || '0.00'}₺
                </p>
              </div>
              
              <div>
                <p className="text-xl text-slate-400 mb-2">Para Üstü</p>
                <p className="text-amber-400 text-4xl font-mono tracking-tight">
                  {(changeAmountCents / 100).toFixed(2)}₺
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-8">
            <button
              onClick={() => onSubmitPayment('CASH')}
              disabled={isSubmitting || (parsedTenderedCents > 0 && parsedTenderedCents < totalAmount)}
              className="py-6 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-2xl font-bold shadow-lg touch-manipulation active:scale-95 disabled:opacity-50 disabled:active:scale-100 transition-all"
            >
              Nakit Ödeme
            </button>
            <button
              onClick={() => onSubmitPayment('CREDIT_CARD')}
              disabled={isSubmitting || (parsedTenderedCents > 0 && parsedTenderedCents < totalAmount)}
              className="py-6 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-2xl font-bold shadow-lg touch-manipulation active:scale-95 disabled:opacity-50 disabled:active:scale-100 transition-all"
            >
              Kredi Kartı
            </button>
          </div>
        </div>

        {/* Right Side: Numpad */}
        <div className="w-[500px] p-8 flex flex-col justify-center bg-slate-800/30">
          <div className="grid grid-cols-4 gap-4 mb-8">
            {PRESET_AMOUNTS.map((amount) => (
              <button
                key={amount}
                onClick={() => onNumpadPress(`PRESET_${amount}`)}
                disabled={isSubmitting}
                className="h-20 rounded-xl bg-slate-700 hover:bg-slate-600 text-2xl font-bold text-emerald-400 shadow-sm touch-manipulation active:scale-95 disabled:opacity-50"
              >
                {amount}₺
              </button>
            ))}
            <button
              onClick={onExactAmount}
              disabled={isSubmitting}
              className="h-20 col-span-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-2xl font-bold text-white shadow-sm touch-manipulation active:scale-95 disabled:opacity-50"
            >
              Tam Tutar ({(totalAmount / 100).toFixed(2)}₺)
            </button>
          </div>

          <div className="flex justify-center">
            <div className="grid grid-cols-3 gap-6">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                <NumpadButton key={num} label={num} onClick={() => onNumpadPress(num)} />
              ))}
              <NumpadButton label="C" onClick={() => onNumpadPress('C')} className="bg-red-900/40 hover:bg-red-800/80 text-red-400" />
              <NumpadButton label="0" onClick={() => onNumpadPress('0')} />
              <NumpadButton label="." onClick={() => onNumpadPress('.')} />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
