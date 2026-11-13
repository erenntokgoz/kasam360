import React, { useEffect, useMemo } from 'react';
import { Button } from '../../ui/Button';
import { InlineAlert } from '../../ui/InlineAlert';
import { canServeDeliveries } from '../../lib/roleAccess';
import { groupDeliveries, LATE_DELIVERY_SECONDS, waitLabel } from '../../lib/deliveryList';
import { useAuthStore } from '../../stores/authStore';
import { useDeliveryStore } from '../../stores/deliveryStore';
import { useFeatureStore } from '../../stores/featureStore';
import { useKitchenSetupStore } from '../../stores/kitchenSetupStore';

const POLL_MS = 10_000;

/**
 * Mutfakta hazır olup masaya götürülmemiş kalemler. Mutfak ekranı gizliyse (bayrak kapalı ya da
 * etkin mutfak kullanıcısı yok) hazır kalem de oluşmaz; liste hiç çizilmez ve sunucuya sorulmaz.
 */
export const PendingDeliveries: React.FC<{ active: boolean }> = ({ active }) => {
  const role = useAuthStore((state) => state.user?.role);
  const kdsOn = useFeatureStore((state) => state.isEnabled('feat_kds'));
  const hasKitchenUser = useKitchenSetupStore((state) => state.hasKitchenUser);
  const { items, loadError, isServing, load, serve } = useDeliveryStore();
  const visible = canServeDeliveries(role) && kdsOn && hasKitchenUser !== false;

  useEffect(() => {
    if (!active || !visible) return undefined;
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, visible, load]);

  const groups = useMemo(() => groupDeliveries(items), [items]);
  if (!visible || (groups.length === 0 && !loadError)) return null;

  return (
    <section className="delivery-strip" aria-label="Teslim edilecekler">
      <h2 className="delivery-title">Teslim edilecekler <span className="tabular-nums">{groups.length}</span></h2>
      {loadError ? <InlineAlert message={`Teslim listesi güncellenemedi: ${loadError}`} /> : null}
      <ul className="delivery-list">
        {groups.map((group) => (
          <li key={group.orderId} className="delivery-row" data-late={group.readySeconds >= LATE_DELIVERY_SECONDS}>
            <span className="delivery-table">{group.tableName}</span>
            <span className="delivery-summary">{group.summary}</span>
            <span className="delivery-wait tabular-nums">{waitLabel(group.readySeconds)}</span>
            <Button
              variant="success"
              size="md"
              disabled={isServing}
              aria-label={`${group.tableName} teslim edildi`}
              onClick={() => void serve(group.itemIds)}
            >
              Teslim edildi
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
};
