'use client';

import { useEffect, useRef, useState } from 'react';
import type { SceneApi, SceneMode, StationId } from '@/components/scene/sceneTypes';

// Sayfadaki adım şeridi makineye bu olayla komut gönderir; makine de öndeki siparişin adımını FLOW_EVENT ile yayınlar.
export const STAGE_EVENT = 'k5-stage';
export const FLOW_EVENT = 'k5-flow';
export type StageCommand = { mode?: SceneMode; focus?: StationId };

export function RestaurantStage() {
  const host = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const tooltipTitle = useRef<HTMLElement>(null);
  const tooltipText = useRef<HTMLParagraphElement>(null);
  const api = useRef<SceneApi | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    // three.js yalnız tarayıcıda ve ayrı parça olarak yüklenir; sayfanın ilk boyaması sahneyi beklemez.
    (async () => {
      try {
        await document.fonts.ready;
        const { initRestaurantScene } = await import('@/components/scene/restaurantScene');
        const refs = [host, canvasHost, labels, tooltip, tooltipTitle, tooltipText];
        if (cancelled || refs.some((r) => !r.current)) return;
        api.current = initRestaurantScene(
          {
            host: host.current!, canvasHost: canvasHost.current!, labels: labels.current!, tooltip: tooltip.current!,
            tooltipTitle: tooltipTitle.current!, tooltipText: tooltipText.current!,
          },
          {
            embedded: true,
            onReady: () => setStatus('ready'),
            onStage: (stage) => window.dispatchEvent(new CustomEvent<number>(FLOW_EVENT, { detail: stage })),
          },
        );
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    const onCommand = (e: Event) => {
      const cmd = (e as CustomEvent<StageCommand>).detail;
      if (cmd.mode) api.current?.setMode(cmd.mode);
      if (cmd.focus) api.current?.focusStation(cmd.focus);
    };
    window.addEventListener(STAGE_EVENT, onCommand);
    return () => {
      cancelled = true;
      window.removeEventListener(STAGE_EVENT, onCommand);
      api.current?.dispose();
      api.current = null;
    };
  }, []);

  return (
    <div className="k-stage" ref={host} id="makine">
      <div
        className="k-canvas"
        ref={canvasHost}
        role="img"
        aria-label="Döndürülebilir 3D restoran makinesi: bir sipariş salondan mutfağa, depoya, kasaya ve buluta ilerler. Sürükleyip çevirin, bir istasyona tıklayıp yaklaşın."
      />
      <div className="k-vignette" />
      <div className="k-labels" ref={labels} />
      <div className="k-tip" ref={tooltip} role="tooltip" data-visible="false">
        <b ref={tooltipTitle} />
        <p ref={tooltipText} />
      </div>
      {status === 'loading' && <div className="k-stage-msg">Makine kuruluyor</div>}
      {status === 'error' && (
        <div className="k-stage-msg k-stage-error" role="alert">
          <b>3D sahne açılamadı.</b>
          <p>Tarayıcıda WebGL kapalı olabilir. Sayfanın geri kalanı çalışıyor.</p>
        </div>
      )}
    </div>
  );
}
