export const formatCurrency = (cents: number, signed = false): string => {
    const lira = cents / 100;
    const formatted = new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency: 'TRY',
    }).format(lira);

    if (signed && cents > 0) return `+${formatted}`;
    return formatted;
};

export const formatDate = (iso: string | null): string => {
    if (!iso) return '';
    const date = new Date(iso);
    return date.toLocaleString('tr-TR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
};
