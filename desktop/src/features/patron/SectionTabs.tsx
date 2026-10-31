import { Button } from '../../ui/Button';

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
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          variant={active === tab.id ? 'primary' : 'secondary'}
          className="min-h-12 text-xs font-bold"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}
