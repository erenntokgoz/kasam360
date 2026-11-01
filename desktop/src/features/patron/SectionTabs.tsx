export interface SectionTab<T extends string> {
  id: T;
  label: string;
}

interface SectionTabsProps<T extends string> {
  label: string;
  tabs: SectionTab<T>[];
  active: T;
  onChange: (id: T) => void;
}

/** Bölüm içi ikincil gezinme: üst çubuğu kalabalıklaştırmadan işlem kaybetmemek için. */
export function SectionTabs<T extends string>({ label, tabs, active, onChange }: SectionTabsProps<T>) {
  return (
    <div className="flex flex-wrap gap-x-6 border-b-2 border-[var(--border)]" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className="desk-tab text-lg"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
