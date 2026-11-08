import { PAID_CHANNELS, type ReceiptDraft } from '../../lib/purchaseReceipt';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { NumberInput } from '../../ui/NumberInput';

interface ReceiptOptionsProps {
  value: ReceiptDraft;
  onChange: (draft: ReceiptDraft) => void;
  /** Adetle alınan kalemler: bir adetten çıkan gram sorulur. */
  gramItems: { id: string; name: string }[];
  disabled?: boolean;
}

/** Teslimde ödeme şekli, vade, belge ve gram tek yerde seçilir; hızlı giriş de aynısını kullanır. */
export function ReceiptOptions({ value, onChange, gramItems, disabled = false }: ReceiptOptionsProps) {
  const patch = (next: Partial<ReceiptDraft>) => onChange({ ...value, ...next });
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Ödeme şekli">
        <Button type="button" role="radio" aria-checked={value.mode === 'TERM'} variant={value.mode === 'TERM' ? 'selected' : 'secondary'} className="min-h-12" onClick={() => patch({ mode: 'TERM' })}>Vadeli</Button>
        <Button type="button" role="radio" aria-checked={value.mode === 'PAID'} variant={value.mode === 'PAID' ? 'selected' : 'secondary'} className="min-h-12" onClick={() => patch({ mode: 'PAID' })}>Peşin</Button>
      </div>
      {value.mode === 'TERM' ? (
        <label className="block text-xs space-y-1"><span>Vade tarihi</span>
          <Input type="date" aria-label="Vade tarihi" value={value.dueDate} onChange={(event) => patch({ dueDate: event.target.value })} />
        </label>
      ) : (
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Ödeme kanalı">
          {PAID_CHANNELS.map((channel) => (
            <Button key={channel.id} type="button" role="radio" aria-checked={value.channel === channel.id} variant={value.channel === channel.id ? 'selected' : 'secondary'} className="min-h-12" onClick={() => patch({ channel: channel.id })}>
              {channel.label}
            </Button>
          ))}
        </div>
      )}
      <label className="block text-xs space-y-1"><span>Belge no</span>
        <Input aria-label="Belge no" maxLength={60} value={value.documentNo} onChange={(event) => patch({ documentNo: event.target.value })} />
      </label>
      {gramItems.map((item) => (
        <label key={item.id} className="block text-xs space-y-1"><span>{item.name}: 1 adetten çıkan kullanılabilir gram</span>
          <NumberInput kind="quantity" aria-label={`${item.name} 1 adet gram`} value={value.grams[item.id] ?? ''} onValueChange={(text) => patch({ grams: { ...value.grams, [item.id]: text } })} />
        </label>
      ))}
    </fieldset>
  );
}
