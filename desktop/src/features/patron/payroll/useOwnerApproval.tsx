import React, { useCallback, useState } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { ManagerPinPrompt, type ApprovalScope } from '../../payment/ManagerPinPrompt';

interface Pending {
  scope: ApprovalScope;
  title: string;
  resolve: (result: OwnerApproval) => void;
}

/** `approved` false = kullanıcı vazgeçti; `token` yalnız müdür için gelir. */
export interface OwnerApproval {
  approved: boolean;
  token?: string;
}

/**
 * Para çıkışında işletme sahibi onayı. Sahip kendi işlemini doğrudan yapar; müdür için
 * sahibin PIN'i istenir ve işleme bağlı tek kullanımlık jeton döner. `prompt` ekrana
 * yerleştirilmelidir.
 */
export function useOwnerApproval() {
  const role = useAuthStore((state) => state.user?.role);
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback(
    (scope: ApprovalScope, title: string): Promise<OwnerApproval> => {
      if (role !== 'MANAGER') return Promise.resolve({ approved: true });
      return new Promise((resolve) => setPending({ scope, title, resolve }));
    },
    [role],
  );

  const prompt: React.ReactNode = pending ? (
    <ManagerPinPrompt
      cardFlow
      scope={pending.scope}
      title={pending.title}
      onApproved={(token) => {
        pending.resolve({ approved: true, token });
        setPending(null);
      }}
      onClose={() => {
        pending.resolve({ approved: false });
        setPending(null);
      }}
    />
  ) : null;

  return { ask, prompt };
}
