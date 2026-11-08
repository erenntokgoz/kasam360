// Sahnenin canlı kısmı: kamera, modlar, istasyona odaklanma, işaretçi etkileşimi, animasyon ve temizlik.
// Görünmeyen sahne çizilmez; hareket azaltma açıksa sahne dönmez ve mod geçişleri anında olur.
import * as THREE from 'three';
import { TAU } from './sceneKit';
import type { LoopContext, SceneApi, SceneMode, StationId } from './sceneTypes';

export function runLoop(c: LoopContext): SceneApi {
  const { dom, opts, renderer, scene, camera, controls, kit, T, A, stations, packets, path, belt, pipes, updateBelt, at, depoU, kasaU, bulutU, reduceMotion, embedded, W, H, ripples, listen, cleanups } = c;
  let mode: SceneMode = 'assembled', cameraMode: 'overview' | 'station' = 'overview', playing = !reduceMotion, simTime = 0, spread = 0;
  let selected: StationId = 'mutfak', hovered: StationId | null = null;
  let width = W(), height = H(), mobile = width <= 900, lastInteraction = performance.now(), dragging = false, wasDragged = false, downX = 0, downY = 0;
  let cameraAnimating = true, lastDraw = -1, visible = true, sized = false, readySent = false, baseDistance = 25, online = false, prevJourney = -1, activeStation: StationId | null = null, idleFocus = 0;
  const desiredPos = new THREE.Vector3(), desiredTarget = new THREE.Vector3(0, 1, 0), viewDir = new THREE.Vector3(10.5, 10.8, 17).normalize();

  function goal() {
    if (cameraMode === 'station') {
      desiredTarget.copy(at(selected)).add(new THREE.Vector3(0, 1.25, 0));
      desiredPos.copy(desiredTarget).addScaledVector(viewDir, mobile ? 9 : 12); return;
    }
    desiredTarget.set(0, 1, 0);
    desiredPos.copy(viewDir).multiplyScalar(baseDistance * (mode === 'stations' ? 1.2 : 1)).add(desiredTarget);
  }
  // Boyut sıfırken (kapalı panel, gizli sekme) kamera hesaplanmaz; aksi halde en-boy oranı NaN olur.
  function layout() {
    if (!W() || !H()) return;
    const first = !sized; sized = true; width = W(); height = H(); mobile = width <= 900;
    renderer.setSize(width, height); camera.aspect = width / height;
    // Geniş ekranda makine sağdaki alana kayar, soldaki başlık boş kalır; hedef noktası değişmez.
    camera.setViewOffset(width, height, mobile || !embedded ? 0 : -width * 0.21, 0, width, height);
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const hFit = 17.3 / (2 * half * (width / height) * (mobile ? 0.91 : 0.55));
    const vFit = 11.5 / (2 * half * (embedded ? 0.85 : 0.62));
    baseDistance = (Math.max(hFit, vFit) * (mobile ? 0.97 : 1)) / (embedded ? (mobile ? 1.4 : 1.2) : 1);
    controls.maxDistance = Math.max(55, baseDistance * 1.6); camera.updateProjectionMatrix(); goal(); cameraAnimating = true;
    if (first) { camera.position.copy(desiredPos); controls.target.copy(desiredTarget); controls.update(); cameraAnimating = false; }
  }
  function setMode(next: SceneMode, instant = reduceMotion) {
    mode = next; lastInteraction = performance.now(); cameraMode = 'overview';
    if (instant) { kit.cutPlane.constant = mode === 'cutaway' ? 0.99 : 10; spread = mode === 'stations' ? 1 : 0; }
    if (mode === 'order') { simTime = 0; lastDraw = -1; prevJourney = -1; playing = true; }
    goal(); cameraAnimating = true; opts.onModeChange?.(mode);
  }
  function focusStation(id: StationId) {
    selected = id; if (mode === 'order') { mode = 'assembled'; opts.onModeChange?.(mode); }
    cameraMode = 'station'; idleFocus = 0; lastInteraction = performance.now(); goal(); cameraAnimating = true;
  }

  layout(); listen(window, 'resize', layout);
  const ro = new ResizeObserver(layout); ro.observe(dom.host); cleanups.push(() => ro.disconnect());
  controls.addEventListener('start', () => { dragging = true; cameraAnimating = false; lastInteraction = performance.now(); });
  controls.addEventListener('end', () => { dragging = false; lastInteraction = performance.now(); });

  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  const local = (e: PointerEvent): [number, number] => { const r = dom.host.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const hit = (x: number, y: number) => {
    ptr.set((x / width) * 2 - 1, (-y / height) * 2 + 1); ray.setFromCamera(ptr, camera);
    const h = ray.intersectObjects(stations.map((s) => s.group), true);
    return h.length ? stations.find((s) => s.id === h[0].object.userData.station) ?? null : null;
  };
  listen(renderer.domElement, 'pointermove', (e: PointerEvent) => {
    const [x, y] = local(e); if (Math.hypot(x - downX, y - downY) > 5) wasDragged = true; if (dragging) return;
    const s = hit(x, y); hovered = s ? s.id : null; renderer.domElement.style.cursor = s ? 'pointer' : 'grab';
    dom.tooltip.dataset.visible = String(!!s);
    if (!s) return;
    dom.tooltipTitle.textContent = `${String(s.order + 1).padStart(2, '0')}  ${s.name}`; dom.tooltipText.textContent = s.desc;
    dom.tooltip.style.left = `${Math.min(width - 255, Math.max(10, x + 16))}px`; dom.tooltip.style.top = `${Math.max(10, Math.min(height - 95, y - 65))}px`;
  });
  listen(renderer.domElement, 'pointerleave', () => { hovered = null; dom.tooltip.dataset.visible = 'false'; });
  listen(renderer.domElement, 'pointerdown', (e: PointerEvent) => { [downX, downY] = local(e); wasDragged = false; dom.tooltip.dataset.visible = 'false'; });
  listen(renderer.domElement, 'pointerup', (e: PointerEvent) => { if (wasDragged) return; const s = hit(...local(e)); if (s) focusStation(s.id); });
  const io = new IntersectionObserver((en) => { visible = en[0].isIntersecting && !document.hidden; }, { threshold: 0.01 });
  io.observe(renderer.domElement); cleanups.push(() => io.disconnect());
  listen(document, 'visibilitychange', () => { visible = !document.hidden; });

  const FLOW: StationId[] = ['salon', 'mutfak', 'depo', 'kasa', 'bulut'];
  const scratch = new THREE.Vector3(), anchor = new THREE.Vector3();
  let lastFrame = performance.now(), raf = 0;
  function animate(now: number) {
    raf = requestAnimationFrame(animate);
    const dt = Math.max(0, Math.min((now - lastFrame) / 1000, 0.045)); lastFrame = now;
    if (playing) simTime += dt;
    // Sahne ekran dışındayken çizim yapılmaz ama sipariş zamanı işler; sayfadaki adım şeridi takılı kalmaz.
    if (!visible) {
      const ph = (simTime / 24) % 1, u = ((ph - 0.15) / 0.85) * bulutU;
      const st = ph < 0.15 ? 0 : u < depoU * 0.7 ? 1 : u < kasaU * 0.96 ? 2 : u < bulutU * 0.83 ? 3 : 4;
      if (st !== prevJourney) { prevJourney = st; activeStation = FLOW[st]; opts.onStage?.(st); }
      return;
    }
    const t = simTime, beat = (t / 4) % 1, tact = (t * TAU) / 4, smooth = 1 - Math.exp(-dt * 5);
    spread = THREE.MathUtils.lerp(spread, mode === 'stations' ? 1 : 0, smooth);
    kit.cutPlane.constant = THREE.MathUtils.lerp(kit.cutPlane.constant, mode === 'cutaway' ? 0.99 : 10, smooth);
    stations.forEach((s, i) => {
      // Siparişin bulunduğu istasyon hafifçe yükselir ve parlar; göz akışı kendiliğinden takip eder.
      const active = activeStation === s.id;
      const lift = (s.group.userData.lift as number | undefined) ?? 0;
      const nextLift = THREE.MathUtils.lerp(lift, active ? 0.16 : hovered === s.id ? 0.08 : 0, smooth); s.group.userData.lift = nextLift;
      s.group.position.copy(s.base); s.group.position.x *= 1 + spread * 0.29; s.group.position.z *= 1 + spread * 0.37; s.group.position.y += spread * (i % 2 ? 0.32 : 0.55) + nextLift;
      const lit = hovered === s.id || (cameraMode === 'station' && selected === s.id);
      const breathe = active ? 2.4 + Math.sin(t * 4) * 0.6 : 0.45;
      s.glowMat.emissiveIntensity = THREE.MathUtils.lerp(s.glowMat.emissiveIntensity, lit ? 3.5 : breathe, smooth);
    });
    belt.scale.set(1 + spread * 0.12, 1, 1 + spread * 0.15); pipes.scale.set(1 + spread * 0.25, 1, 1 + spread * 0.3);
    kit.gears.forEach((g, i) => { g.rotation.y = t * (i % 2 ? -1 : 1) * 1.1; });
    A.steam.forEach((s) => { const seed = s.userData.seed as number, k = (t * 0.35 + seed) % 1; s.position.set(-0.42 + Math.sin(k * 9 + seed * 20) * 0.08, 1.45 + k, -0.3 + Math.cos(k * 7) * 0.06); s.scale.setScalar(0.6 + k * 1.6); });
    A.flames.forEach((f, i) => f.scale.setScalar(1 + Math.sin(t * 9 + i) * 0.06));
    A.lid.rotation.z = Math.sin(t * 11) * 0.03; A.lid.position.y = 1.38 + Math.max(0, Math.sin(t * 5)) * 0.015;
    A.lot.position.z = Math.max(0, Math.sin(tact)) * 0.55;
    const orderPhase = (t / 24) % 1, cashBeat = mode === 'order' ? THREE.MathUtils.clamp((orderPhase - 0.62) / 0.2, 0, 1) : beat;
    A.drawer.position.z = 0.12 + Math.sin(Math.min(1, cashBeat * 1.4) * Math.PI) * 0.32;
    A.receipt.scale.y = 0.2 + Math.min(1, cashBeat * 1.5) * 0.8;
    A.coin.position.set(1.04, 2.7 - Math.min(1, cashBeat * 1.7) ** 2 * 2.17, 0.55); A.coin.rotation.y = t * 3.5;
    A.coin.scale.setScalar(cashBeat > 0.9 ? Math.max(0.05, 1 - (cashBeat - 0.9) * 8) : 1);
    const cardBeat = mode === 'order' ? Math.min(1, orderPhase / 0.15) : beat;
    A.card.visible = mode !== 'order' || orderPhase < 0.15;
    A.card.position.set(0.2 + Math.sin(cardBeat * Math.PI) * 0.24, 1.1 + cardBeat * 1.8, -0.1 + cardBeat * 0.3); A.card.rotation.y = Math.sin(cardBeat * Math.PI) * -0.3;
    A.card.scale.setScalar(Math.min(1, cardBeat * 8 + 0.15, (1 - cardBeat) * 7 + 0.1));
    const nowOnline = mode === 'order' ? orderPhase > 0.9 : Math.sin(t * 0.4) > 0.55;
    if (nowOnline !== online) {
      online = nowOnline; T.drawSync(online);
      A.syncMat.color.setHex(online ? 0x3fbf6f : 0xf59f00); A.syncMat.emissive.setHex(online ? 0x2fae5f : 0xf59f00);
    }
    A.rings.forEach((r, i) => { r.rotation.z = t * (i % 2 ? -0.8 : 0.6); r.scale.setScalar(1 + Math.max(0, Math.sin(t * 3 - i)) * (online ? 0.08 : 0.02)); });
    if (t - lastDraw > 1 / 12 || lastDraw < 0) { T.drawKds(t); updateBelt(t); lastDraw = t; }
    packets.forEach((pk, i) => {
      const phase = (t / 24 + i / 6) % 1; pk.phase = phase; let stage: number;
      if (phase < 0.15) {
        stage = 0; const f = phase / 0.15;
        pk.group.position.copy(at('salon')).add(new THREE.Vector3(0, 1.6, 0.6)); scratch.copy(at('mutfak')).add(new THREE.Vector3(0, 1.3, 0.65));
        pk.group.position.lerp(scratch, f); pk.group.position.y += Math.sin(f * Math.PI) * 2;
        pk.group.rotation.set(0, Math.sin(f * Math.PI) * 0.28, Math.sin(f * Math.PI) * -0.1);
      } else {
        const u = ((phase - 0.15) / 0.85) * bulutU; path.getPointAt(u, pk.group.position);
        pk.group.position.x *= 1 + spread * 0.12; pk.group.position.z *= 1 + spread * 0.15; pk.group.position.y += 0.43; pk.group.rotation.set(0, 0.18, 0);
        stage = u < depoU * 0.7 ? 1 : u < kasaU * 0.96 ? 2 : u < bulutU * 0.83 ? 3 : 4;
      }
      if (pk.stage !== stage) { pk.faces.forEach((f, j) => (f.visible = j === stage)); pk.stage = stage; }
      pk.group.visible = mode !== 'order' || i === 0; pk.halo.visible = i === 0;
      if (i === 0) { const hm = pk.halo.material as THREE.MeshBasicMaterial; hm.opacity = 0.55 + Math.sin(t * 5) * 0.3; pk.halo.scale.setScalar(1 + Math.sin(t * 5) * 0.08); }
      pk.group.scale.setScalar(i === 0 ? 1.25 : 0.9); if (phase > 0.94) pk.group.scale.multiplyScalar(Math.max(0.05, (1 - phase) / 0.06));
    });
    // Öndeki sipariş istasyon değiştirdiğinde etiket, dalga ve sayfadaki adım şeridi birlikte güncellenir.
    const lead = packets[0];
    if (lead.stage !== prevJourney) {
      prevJourney = lead.stage; activeStation = FLOW[lead.stage]; opts.onStage?.(lead.stage);
      const r = ripples.find((x) => x.age >= 1) ?? ripples[0]; r.age = 0; r.mesh.visible = true;
      r.mesh.position.copy(at(activeStation)).setY(0.36);
    }
    ripples.forEach((r) => {
      if (r.age >= 1) { r.mesh.visible = false; return; }
      r.age = Math.min(1, r.age + dt / 1.4); r.mesh.scale.setScalar(1 + r.age * 1.6);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - r.age) * 0.7;
    });
    // İstasyona yaklaşan kamera bir süre dokunulmazsa genel görünüme döner.
    if (cameraMode === 'station' && !dragging && (idleFocus += dt) > 9) { cameraMode = 'overview'; goal(); cameraAnimating = true; }
    if (mode === 'order') {
      const pk = lead;
      if (!dragging && playing) { desiredTarget.copy(pk.group.position); desiredPos.copy(desiredTarget).addScaledVector(viewDir, mobile ? 10 : 15); cameraAnimating = true; }
    } else if (cameraMode === 'station' && cameraAnimating) goal();
    if (cameraAnimating && !dragging) {
      const k = 1 - Math.exp(-dt * (mode === 'order' ? 2.2 : 3)); camera.position.lerp(desiredPos, k); controls.target.lerp(desiredTarget, k);
      if (mode !== 'order' && camera.position.distanceTo(desiredPos) < 0.015 && controls.target.distanceTo(desiredTarget) < 0.015) cameraAnimating = false;
    }
    controls.autoRotate = playing && !reduceMotion && !dragging && !cameraAnimating && mode !== 'order' && cameraMode === 'overview' && now - lastInteraction > 6500;
    controls.autoRotateSpeed = 0.24; controls.update(dt);
    stations.forEach((s) => {
      s.label.dataset.visible = 'true'; s.label.dataset.active = String(s.id === activeStation);
      anchor.copy(s.group.position).add(s.anchor).project(camera);
      const x = THREE.MathUtils.clamp((anchor.x * 0.5 + 0.5) * width - 20, mobile || !embedded ? 9 : width * 0.44, width - (mobile ? 110 : 150));
      const y = THREE.MathUtils.clamp((-anchor.y * 0.5 + 0.5) * height - 60, 70, height - 150);
      s.label.style.transform = `translate(${x}px,${y}px)`;
    });
    renderer.render(scene, camera);
    if (!readySent && sized) { readySent = true; opts.onReady?.(); }
  }
  raf = requestAnimationFrame(animate);
  renderer.compile(scene, camera);

  // Sahne kaldırılırken GPU'daki her kaynak serbest bırakılır; sayfa geçişlerinde bellek birikmez.
  const dispose = () => {
    cancelAnimationFrame(raf); controls.dispose();
    const textures = new Set<THREE.Texture>();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const mat of mats) { for (const v of Object.values(mat)) if (v instanceof THREE.Texture) textures.add(v); mat.dispose(); }
    });
    kit.geometries.forEach((g) => g.dispose()); textures.forEach((t) => t.dispose()); c.env.dispose();
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    cleanups.reverse().forEach((f) => f()); cleanups.length = 0;
  };
  return { setMode, focusStation, dispose };
}
