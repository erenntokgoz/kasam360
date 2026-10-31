import React from 'react';
import { useSetupStore, type SetupMode } from '../../stores/setupStore';
import { AccountLogin } from '../auth/AccountLogin';
import { RestoreFromFile } from './RestoreFromFile';
import { NewBusinessForm } from './NewBusinessForm';
import { BrandMark } from '../../ui/BrandMark';
import { JoinBusinessForm } from './JoinBusinessForm';

export const SetupWizard: React.FC = () => {
  const { mode, draft, saveProgress } = useSetupStore();
  const choose = (next: SetupMode | null) => void saveProgress(next, draft).catch(() => undefined);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg-canvas)] p-6 select-none">
      <div className="min-h-full flex flex-col items-center justify-center">
        <div className="w-full max-w-[560px] paper border border-[var(--border)] rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center gap-2.5">
            <BrandMark className="w-8 h-8" surface="paper" />
            <h1 className="print-title font-bold text-base tracking-tight text-[var(--text-primary)]">
              {mode === null ? 'KASAM360 Giriş' : 'KASAM360 Kurulumu'}
            </h1>
          </div>

          {mode === null ? (
            // Web kaydı gelince `onRegister` web adresini açacak; o zamana kadar
            // işletme bu cihazda kurulur, internet zorunlu olmaz.
            <>
              <AccountLogin onRegister={() => choose('NEW')} onJoinDevice={() => choose('JOIN')} />
              <RestoreFromFile />
            </>
          ) : null}

          {mode === 'NEW' ? <NewBusinessForm onBack={() => choose(null)} /> : null}
          {mode === 'JOIN' ? <JoinBusinessForm onBack={() => choose(null)} /> : null}
        </div>
      </div>
    </div>
  );
};
