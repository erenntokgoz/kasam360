export const BATCH_LIMIT = 400;

export interface TableGroup {
  count: number;
  seats: number;
}

export interface NewTable {
  name: string;
  seats: number;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Sayılar değerine göre dizilir: Masa 2, Masa 10'dan önce gelir. */
export const compareTableNames = (left: string, right: string) => left.localeCompare(right, 'tr', { numeric: true, sensitivity: 'base' });

/** Yeni masalar ada göre sürer: "Masa 12" varken sıradaki numara 13 olur. */
export function nextTableNumber(existingNames: string[], baseName: string): number {
  const pattern = new RegExp(`^${escapeRegExp(baseName.trim())} (\\d+)$`);
  return existingNames.reduce((highest, name) => Math.max(highest, Number(name.match(pattern)?.[1] ?? 0)), 0) + 1;
}

/** Gruplar tek numara dizisinde birleşir: 5 tane 4 kişilik ardından 5 tane 6 kişilik 1-10 olur. */
export function buildTableBatch(baseName: string, start: number, groups: TableGroup[]): NewTable[] {
  let number = start;
  return groups.flatMap(({ count, seats }) =>
    Array.from({ length: count }, () => {
      const table = { name: `${baseName.trim()} ${number}`, seats };
      number += 1;
      return table;
    }),
  );
}

export const findDuplicateName = (batch: NewTable[], existingNames: string[]) => {
  const taken = new Set(existingNames);
  return batch.find((table) => taken.has(table.name))?.name;
};
