import { GlobalNav } from './GlobalNav';
import { TopHeader } from './TopHeader';
import { Toaster } from '../../../core/components/ui/toast';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full flex-row overflow-hidden bg-background text-foreground">
      <GlobalNav />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopHeader />
        <main className="flex-1 overflow-auto bg-muted/20">
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  );
}
