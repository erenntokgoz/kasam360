import { PlatformSetupWizard, PlatformSetupWizardProps } from './PlatformSetupWizard';

export interface TenantOnboardingWizardProps extends PlatformSetupWizardProps {
  onComplete?: () => void;
}

/**
 * TenantOnboardingWizard bileşeni — Apple Setup Assistant standartlarında yeniden tasarlanan
 * Platform & Şirket Kurulum Sihirbazı (PlatformSetupWizard) bileşeninin tam uyumlu sarmalayıcısıdır.
 */
export function TenantOnboardingWizard({
  isOpen,
  onClose,
  onSuccess,
  onComplete,
}: TenantOnboardingWizardProps): JSX.Element | null {
  const handleSuccess = async () => {
    if (onSuccess) {
      await onSuccess();
    }
    if (onComplete) {
      onComplete();
    }
  };

  return (
    <PlatformSetupWizard
      isOpen={isOpen}
      onClose={onClose}
      onSuccess={handleSuccess}
    />
  );
}

export default TenantOnboardingWizard;
