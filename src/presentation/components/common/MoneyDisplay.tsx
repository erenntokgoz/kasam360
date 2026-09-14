
export function MoneyDisplay({ amountInCents, className }: { amountInCents: number, className?: string }) {
  const formatMoney = (cents: number) => {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(cents / 100);
  };

  return <span className={`font-mono tracking-tight font-semibold ${className || ''}`}>{formatMoney(amountInCents)}</span>;
}
