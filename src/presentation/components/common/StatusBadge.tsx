import { Badge } from '../../../core/components/ui/badge';

export function StatusBadge({ status, variant = 'default' }: { status: string, variant?: 'default' | 'secondary' | 'destructive' | 'outline' }) {
  return <Badge variant={variant}>{status}</Badge>;
}
