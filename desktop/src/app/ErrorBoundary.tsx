import { ErrorToast } from '../ui/ErrorToast';
import React from 'react';

interface ErrorBoundaryState {
  message: string | null;
}

/** Tek ekran hatası kasayı siyah ekranda bırakmaz: kayıtlar diskte, ekran yeniden açılır. */
export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="h-screen w-screen flex items-center justify-center p-6 bg-[var(--bg-canvas)]">
        <div className="paper p-6 max-w-md w-full flex flex-col gap-3">
          <ErrorToast message={this.state.message} />
          <h1 className="print-title text-2xl">Ekran açılamadı</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Kayıtlarınız güvende. Ekranı yeniden açın; sorun sürerse bu metni destek ekibine iletin.
          </p>
          <p className="text-xs break-words text-[var(--text-muted)]">{this.state.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="tactile-btn min-h-12 px-4 rounded-md font-bold bg-[var(--primary-bg)] text-[var(--primary-fg)] cursor-pointer"
          >
            Ekranı Yeniden Aç
          </button>
        </div>
      </div>
    );
  }
}
