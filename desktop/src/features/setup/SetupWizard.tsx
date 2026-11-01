import React from 'react';
import { useSetupStore, type SetupMode } from '../../stores/setupStore';
import { AccountLogin } from '../auth/AccountLogin';
import { AuthLayout } from '../auth/AuthLayout';
import { RestoreFromFile } from './RestoreFromFile';
import { NewBusinessForm } from './NewBusinessForm';
import { JoinBusinessForm } from './JoinBusinessForm';

export const SetupWizard: React.FC = () => {
  const { mode, draft, saveProgress } = useSetupStore();
  const choose = (next: SetupMode | null) => void saveProgress(next, draft).catch(() => undefined);

  const headline =
    mode === 'NEW'
      ? { title: 'İşletmeni kur.', subtitle: 'İlk sahip hesabı ve PIN bu cihazda oluşur.' }
      : mode === 'JOIN'
      ? { title: 'Bu cihazı bağla.', subtitle: 'Mevcut işletmeden aldığın kodu gir.' }
      : { title: 'İşletme hesabına gir.', subtitle: 'Yeni işletme kurabilir ya da bu cihazı mevcut işletmeye bağlayabilirsin.' };

  return (
    <AuthLayout title={headline.title} subtitle={headline.subtitle}>
      {mode === null ? (
        // Web kaydı gelince `onRegister` web adresini açacak; o zamana kadar
        // işletme bu cihazda kurulur, internet zorunlu olmaz.
        <>
          <h2 className="print-title text-2xl">Giriş</h2>
          <AccountLogin onRegister={() => choose('NEW')} onJoinDevice={() => choose('JOIN')} />
          <RestoreFromFile />
        </>
      ) : null}

      {mode === 'NEW' ? <NewBusinessForm onBack={() => choose(null)} /> : null}
      {mode === 'JOIN' ? <JoinBusinessForm onBack={() => choose(null)} /> : null}
    </AuthLayout>
  );
};
