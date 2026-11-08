import { ChevronRight } from 'lucide-react';
import { Button } from '../../ui/Button';

interface RecordCardProps {
  title: string;
  description: string;
  value?: string;
  onOpen: () => void;
}

export function RecordCard({ title, description, value, onOpen }: RecordCardProps) {
  return (
    <Button type="button" variant="secondary" onClick={onOpen} className="w-full min-w-0 !justify-between !text-left">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{title}</span>
        <span className="block truncate text-xs font-normal text-[var(--text-secondary)] tabular-nums">{description}</span>
      </span>
      {value ? <span className="shrink-0 tabular-nums">{value}</span> : null}
      <ChevronRight aria-hidden="true" className="w-4 h-4 shrink-0" />
    </Button>
  );
}
