import React from 'react';
import type { SetupPhase } from '../../stores/setupStore';
import { SetupWizard } from './SetupWizard';

interface SetupGateProps {
  phase: Exclude<SetupPhase, 'COMPLETE'>;
  error: string | null;
  onRetry: () => void;
}

/** Kurulum tamamlanmadan görünen ekranlar. Hiçbiri giriş veya kilit göstermez. */
export const SetupGate: React.FC<SetupGateProps> = ({ phase, error, onRetry }) => {
  if (phase === 'LOADING') {
    return <div className="h-screen w-screen bg-[var(--bg-canvas)]" aria-busy="true" />;
  }

  if (phase === 'ERROR') {
    return (
      <div className="h-screen w-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex items-center justify-center p-6">
        <div role="alert" className="bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg p-6 max-w-sm space-y-4">
          <h1 className="text-base font-bold">Kurulum durumu okunamadı</h1>
          <p className="text-sm text-[var(--text-secondary)] break-words">{error}</p>
          <button type="button" onClick={onRetry} className="tactile-btn min-h-12 px-4 rounded-lg bg-[var(--brand)] text-white">
            Yeniden Dene
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-[var(--bg-canvas)]">
      <SetupWizard />
    </div>
  );
};
