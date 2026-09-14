/**
 * POSLayout — Root Presenter (Dumb) Component
 *
 * Structural shell for the POS operating surface. Accepts named slot props so
 * every child region is injected from the outside — this component owns ZERO
 * business state. It defines the ergonomic viewport split:
 *
 *   ┌──────────────────────────────┬────────────────┐
 *   │                              │                │
 *   │   mainContent   (flex-1)     │  sidebar (w-96)│
 *   │                              │                │
 *   └──────────────────────────────┴────────────────┘
 *
 * Design principles:
 *  - Flat background layers with hard borders only — no gradients, no blurs.
 *  - 100dvh viewport lock to match Tauri's fixed window chrome.
 *  - The sidebar has a fixed intrinsic width; main content expands to fill.
 */

interface POSLayoutProps {
  /** Primary working surface: product grid, search, category nav */
  mainContent: React.ReactNode;
  /** Right rail: cart panel injected from a Container component */
  sidebar: React.ReactNode;
  /** Optional top bar slot (clock, cashier info, shift controls) */
  topBar?: React.ReactNode;
}

export function POSLayout({ mainContent, sidebar, topBar }: POSLayoutProps): JSX.Element {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-pos-bg text-slate-100">
      {/* ── Top Bar ────────────────────────────────────────────────────── */}
      {topBar}

      {/* ── Main Split ─────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: Product grid / catalog — grows to fill remaining space */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-pos-bg">
          {mainContent}
        </main>

        {/* Divider */}
        <div className="w-px shrink-0 bg-pos-border" aria-hidden="true" />

        {/* Right: Cart sidebar — fixed intrinsic width, never shrinks */}
        <aside className="flex w-96 shrink-0 flex-col overflow-hidden bg-pos-surface">
          {sidebar}
        </aside>
      </div>
    </div>
  );
}
