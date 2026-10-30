import React from 'react';
import { Link2, Store } from 'lucide-react';
import { useSetupStore, type SetupMode } from '../../stores/setupStore';
import { NewBusinessForm } from './NewBusinessForm';
import { JoinBusinessForm } from './JoinBusinessForm';

const CHOICES: { mode: SetupMode; title: string; detail: string; icon: typeof Store }[] = [
  {
    mode: 'NEW',
    title: 'Yeni işletme kur',
    detail: 'Bu cihaz işletmenin ilk cihazı olur. İnternet gerekmez.',
    icon: Store,
  },
  {
    mode: 'JOIN',
    title: 'Mevcut işletmeye cihaz bağla',
    detail: 'Aynı ağdaki işletmeye tek kullanımlık kodla katılır.',
    icon: Link2,
  },
];

export const SetupWizard: React.FC = () => {
  const { mode, draft, saveProgress } = useSetupStore();
  const choose = (next: SetupMode | null) => void saveProgress(next, draft).catch(() => undefined);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg-canvas)] p-6 select-none">
      <div className="min-h-full flex flex-col items-center justify-center">
        <div className="w-full max-w-[560px] bg-[var(--bg-panel)] border border-[var(--border)] rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs text-[var(--text-primary)] bg-[var(--accent-amber)]">
              360
            </div>
            <h1 className="font-bold text-base tracking-tight text-[var(--text-primary)]">
              KASAM360 Kurulumu
            </h1>
          </div>

          {mode === null ? (
            <div className="grid gap-3">
              {CHOICES.map(({ mode: option, title, detail, icon: Icon }) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => choose(option)}
                  className="tactile-btn min-h-12 w-full rounded-xl p-4 flex items-center gap-3 text-left cursor-pointer bg-[var(--bg-card)] hover:bg-[var(--bg-subtle)]"
                >
                  <Icon className="w-6 h-6 shrink-0 text-[var(--text-secondary)]" />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-[var(--text-primary)]">{title}</span>
                    <span className="block text-xs mt-0.5 text-[var(--text-secondary)]">{detail}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {mode === 'NEW' ? <NewBusinessForm onBack={() => choose(null)} /> : null}
          {mode === 'JOIN' ? <JoinBusinessForm onBack={() => choose(null)} /> : null}
        </div>
      </div>
    </div>
  );
};
