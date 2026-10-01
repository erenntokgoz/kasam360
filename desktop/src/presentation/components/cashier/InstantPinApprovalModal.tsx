/**
 * Anlık PIN onay penceresi (Faz 3).
 *
 * Sekme değil, modal: onay kuyruğu kaldırıldı (C-3). Kullanıcı işlemi
 * tetiklediğinde bu pencere açılır, yetkili kişi PIN'ini girer ve işlem
 * tek kullanımlık jetonla sürer.
 *
 * Erişilebilirlik: pencere `role="dialog"` + `aria-modal`, alan `aria-invalid`
 * ve `aria-describedby` taşır, Escape kapatır, odak alana taşınır.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Lock, ShieldCheck, TriangleAlert } from 'lucide-react';

import { Button } from '@core/components/ui/button';
import {
  ApprovalError,
  describeRemainingAttempts,
  type ApprovalOperation,
  type ApprovalRequest,
  requestApproval,
} from '../../../core/services/approvalService';

/** Onay yüzeylerinin kullanıcı dilindeki adı. */
const OPERATION_LABELS: Record<ApprovalOperation, string> = {
  VOID_ORDER: 'Adisyon iptali',
  DISCOUNT: 'İndirim',
  COMPLIMENTARY: 'İkram',
};

export interface InstantPinApprovalModalProps {
  open: boolean;
  /** Onayın bağlandığı işlem: yüzey, kaynak, tutar ve işlemi yapan kişi. */
  request: ApprovalRequest;
  /** Kuruş cinsinden tutarın kullanıcı dilinde gösterimi. */
  formatCents?: (cents: number) => string;
  /** Onay başarılı: tek kullanımlık jeton çağırana döner. */
  onApproved: (token: string) => void;
  /** Kullanıcı vazgeçti veya pencereyi kapattı. */
  onCancel: () => void;
}

const DEFAULT_FORMAT = (cents: number): string =>
  `${(cents / 100).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₺`;

export function InstantPinApprovalModal({
  open,
  request,
  formatCents = DEFAULT_FORMAT,
  onApproved,
  onCancel,
}: InstantPinApprovalModalProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  // Pencere her açıldığında alan temizlenir: önceki hatalı PIN'in izi kalmaz.
  useEffect(() => {
    if (!open) return;
    setPin('');
    setError(null);
    setRemaining(null);
    setIsSubmitting(false);
    inputRef.current?.focus();
  }, [open]);

  // Escape iptaldir. Onay PIN'i girilirken kazara kapanmasın diye
  // işlem sürerken Escape yok sayılır.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, isSubmitting, onCancel]);

  if (!open) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pin.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const result = await requestApproval(request, pin.trim());
      // PIN yalnız burada var; onaydan sonra bellekten düşer.
      setPin('');
      onApproved(result.approvalToken);
    } catch (caught) {
      setPin('');
      // `instanceof` daraltması bu hedefte güvenilir değil; servis her hata
      // durumunda `ApprovalError` fırlatır, bu yüzden tür doğrudan okunur.
      const error = caught as ApprovalError;
      setError(error.message ?? 'Onay doğrulanamadı.');
      setRemaining(typeof error.remainingAttempts === 'number' ? error.remainingAttempts : null);
      setIsSubmitting(false);
    }
  };

  const remainingHint = describeRemainingAttempts(remaining);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-md supports-backdrop-filter:bg-black/40"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${errorId}-title`}
        aria-describedby={error ? errorId : undefined}
        className="w-full max-w-sm rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-xl backdrop-blur-2xl"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </div>

          <div className="space-y-1">
            <h2 id={`${errorId}-title`} className="text-base font-semibold">
              Yönetici Onayı Gerekli
            </h2>
            <p className="text-xs text-muted-foreground">
              {OPERATION_LABELS[request.operation]} için yetkili bir yöneticinin
              PIN'ini girin.
            </p>
          </div>
        </div>

        <dl className="mt-5 space-y-2 rounded-xl border border-border bg-muted/40 p-4 text-xs">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">İşlem</dt>
            <dd className="font-medium">{OPERATION_LABELS[request.operation]}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Kaynak</dt>
            <dd className="truncate font-mono text-[11px]">{request.resourceId}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Tutar</dt>
            <dd className="font-medium tabular-nums">
              {formatCents(request.amountCents)}
            </dd>
          </div>
        </dl>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={`${errorId}-pin`} className="text-xs font-medium">
              Onay PIN'i
            </label>
            <input
              id={`${errorId}-pin`}
              ref={inputRef}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              value={pin}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="h-11 w-full rounded-xl border border-input bg-background/60 px-3 text-center font-mono text-lg tracking-[0.4em] tabular-nums outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
            />
          </div>

          {error && (
            <p
              id={errorId}
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}

          {remainingHint && !error && (
            <p className="text-center text-xs text-muted-foreground">{remainingHint}</p>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="touch"
              className="flex-1"
              disabled={isSubmitting}
              onClick={onCancel}
            >
              Vazgeç
            </Button>
            <Button
              type="submit"
              size="touch"
              className="flex-1"
              disabled={!pin.trim() || isSubmitting}
            >
              <Lock className="size-4" aria-hidden="true" />
              {isSubmitting ? 'Doğrulanıyor' : 'Onayla'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default InstantPinApprovalModal;
