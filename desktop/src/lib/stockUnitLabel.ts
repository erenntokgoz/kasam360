const labels: Record<string, string> = { adet: 'Adet', g: 'Gram', kg: 'Kilogram', ml: 'Mililitre', l: 'Litre' };

export const stockUnitLabel = (unit?: string) => unit ? labels[unit] ?? unit : "Belirsiz";
