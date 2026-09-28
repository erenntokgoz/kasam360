import { GlobalNav } from './GlobalNav';
import { TopHeader } from './TopHeader';

export function AppShell({ children }: { children: React.ReactNode }) {
  // macOS ve bağımsız yüzen cam adalar (floating glass islands) mimarisi:
  // Arka planda saf tuval (#060609 / #f5f5f7), üzerinde bağımsız yüzen yumuşak kenarlı cam yapılar.
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden dark:bg-[#060609] bg-[#f5f5f7] dark:text-[#f5f5f7] text-zinc-900 select-none transition-colors duration-200">
      <TopHeader />
      <div className="flex flex-1 min-h-0 w-full flex-row items-center overflow-hidden relative p-3.5 gap-3.5">
        <GlobalNav />
        <main className="flex-1 h-full self-stretch overflow-hidden rounded-3xl backdrop-blur-2xl dark:bg-white/[0.02] bg-white/70 border dark:border-white/10 border-black/[0.08] shadow-[0_8px_30px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.4)] flex flex-col min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
