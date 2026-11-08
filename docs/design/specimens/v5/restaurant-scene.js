// KASAM360 restoran makinesi: tek plaka üstünde beş istasyon, aralarında dönen bant.
// Masa 12'nin siparişi salondan kalkar, mutfakta tabağa, depoda stok kaydına, kasada fişe, bulutta eşitleme kaydına dönüşür.
// Kaynak: kullanıcının verdiği "Agentic Factory" three.js sahnesi; geometri yaklaşımı ve zamanlama korunarak restorana uyarlandı.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createKit, PALETTES, TAU } from './scene-kit.js';
import { buildTextures, buildStationBodies } from './scene-stations.js';

const DEFS = [
  { id: 'mutfak', name: 'Mutfak', step: 2, output: 'tabak', pos: [-4.15, 0.29, -0.65], desc: 'Sipariş mutfak ekranına düşer, süre sayılır.' },
  { id: 'depo', name: 'Depo', step: 3, output: 'stok', pos: [-1.65, 0.29, -2.03], desc: 'Malzeme en eski partiden düşülür.' },
  { id: 'kasa', name: 'Kasa', step: 4, output: 'fiş', pos: [1.5, 0.29, -2.08], desc: 'Hesap parçalı alınır; nakit ve kart ayrı sayılır.' },
  { id: 'salon', name: 'Salon', step: 1, output: 'sipariş', pos: [4.03, 0.29, 0.12], desc: 'Garson masayı açar, siparişi terminalden girer.' },
  { id: 'bulut', name: 'Bulut', step: 5, output: 'eşitleme', pos: [0.93, 0.29, 1.85], desc: 'İnternet yokken kayıtlar sırada bekler, gelince gider.' },
];
const JOURNEY = [
  ['Masa 12 sipariş verdi', '4 × Ev usulü mantı, biri acısız'],
  ['Mutfak hazırlıyor', 'Ekranda süre sayıyor'],
  ['Stoktan düştü', 'En eski parti önce, maliyet 14,00 TL'],
  ['Hesap kapandı', 'Nakit 200,00 + kart 300,00 = 500,00 TL'],
  ['Kayıt sırada', 'İnternet gelince buluta gider'],
];

export function initRestaurantScene(root, opts = {}) {
  const cleanups = [];
  const $ = (id) => root.querySelector('#' + id);
  const listen = (t, type, fn, o) => { t.addEventListener(type, fn, o); cleanups.push(() => t.removeEventListener(type, fn, o)); };
  const fail = (msg) => { $('loading')?.classList.add('done'); const e = $('error'); if (e) { e.hidden = false; if (msg) e.querySelector('p').textContent = msg; } };
  const W = () => root.clientWidth, H = () => root.clientHeight;
  const embedded = !!opts.embedded;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { fail('Tarayıcıda WebGL kapalı. Donanım hızlandırmayı açıp sayfayı yenileyin.'); return () => { }; }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, W() < 900 ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  $('scene').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, Math.max(W(), 1) / Math.max(H(), 1), 0.1, 150);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, {
    enableDamping: true, dampingFactor: 0.065, enablePan: false, minDistance: 7, maxDistance: 55,
    minPolarAngle: 0.09, maxPolarAngle: Math.PI * 0.475, rotateSpeed: 0.48, zoomSpeed: 0.7
  });
  if (embedded) { controls.enableZoom = false; if (matchMedia('(pointer:coarse)').matches) controls.enableRotate = false; }

  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04); scene.environment = env.texture; room.dispose(); pmrem.dispose();
  const hemi = new THREE.HemisphereLight(0xdbe5f4, 0x29211a, 2); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff1d8, 4.2); key.position.set(-4, 12, 7); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -10, right: 10, top: 9, bottom: -9, near: 0.5, far: 35 });
  key.shadow.normalBias = 0.035; key.shadow.bias = -0.0002; scene.add(key);
  const rim = new THREE.DirectionalLight(0xc4d4ed, 3.1); rim.position.set(3, 7, -8); scene.add(rim);
  const warm = new THREE.PointLight(0xffb070, 28, 20, 2); warm.position.set(-4, 5, 3); scene.add(warm);
  const front = new THREE.DirectionalLight(0xffffff, 1); front.position.set(5, 3, 10); scene.add(front);

  const fontFamily = getComputedStyle(root).fontFamily;
  const kit = createKit(renderer, fontFamily);
  const { M, box, cyl, screw, screen, canvasTexture, print, gear, tube } = kit;
  const T = buildTextures(kit);
  const machine = new THREE.Group(); scene.add(machine);

  const floorMat = new THREE.ShadowMaterial({ opacity: 0.23 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.43; floor.receiveShadow = true; scene.add(floor);
  const blob = canvasTexture(128, 128, (c) => { const g = c.createRadialGradient(64, 64, 12, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,.8)'); g.addColorStop(0.55, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 128, 128); });
  const contactMat = new THREE.MeshBasicMaterial({ map: blob.texture, transparent: true, depthWrite: false, opacity: 0.65 });
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(18, 13), contactMat); contact.rotation.x = -Math.PI / 2; contact.position.y = -0.415; scene.add(contact);

  // Plaka: katmanlı, vidalı, önünde kazınmış ürün adı.
  box(machine, 12.8, 0.38, 8.25, 0, -0.09, 0, M.base, 0.17); box(machine, 12.6, 0.055, 8.08, 0, 0.13, 0, M.edge, 0.11);
  box(machine, 12.49, 0.09, 7.96, 0, 0.19, 0, M.body, 0.1); box(machine, 12.55, 0.027, 8.02, 0, -0.19, 0, M.dark, 0.06);
  box(machine, 11.9, 0.026, 0.032, 0, -0.17, 4.115, M.light, 0.01);
  for (const x of [-5.6, 5.6]) for (const z of [-3.35, 3.35]) { cyl(machine, 0.39, 0.25, x, -0.31, z, M.rubber); screw(machine, x, 0.253, z); }
  for (const x of [-6.02, 6.02]) for (const z of [-3.73, 3.73]) screw(machine, x, 0.255, z);
  const engraving = canvasTexture(1536, 176, (c, w, h) => {
    c.fillStyle = '#252b32'; c.fillRect(0, 0, w, h); c.strokeStyle = '#4d545c'; c.lineWidth = 2; c.strokeRect(2, 2, w - 4, h - 4);
    print(c, 'KASAM360', 45, 82, 44, '#e6e6df', 700); print(c, 'İşletmenizin Çözüm Ortağı ', 330, 80, 32, '#b8bdc1', 450);
    print(c, 'İş Yükünüz Sorunsuz Hafiflesin', 47, 136, 19, '#737e88', 500); print(c, 'No. 360', 1490, 134, 23, '#ff5a1f', 500, 'right');
  });
  screen(machine, 7.35, 0.84, -0.4, 0.25, 3.51, engraving).rotation.x = -Math.PI / 2;

  const draftMat = new THREE.LineBasicMaterial({ color: 0x69717a, transparent: true, opacity: 0.12 });
  const dp = [];
  for (const r of [7.5, 8.1]) for (let i = 0; i < 120; i++) for (const j of [i, i + 1]) { const a = (j / 120) * TAU; dp.push(new THREE.Vector3(Math.cos(a) * r, -0.4, Math.sin(a) * r * 0.72)); }
  for (let i = 0; i < 52; i++) { const a = (i / 52) * TAU, l = i % 4 ? 0.07 : 0.16; dp.push(new THREE.Vector3(Math.cos(a) * 8.1, -0.395, Math.sin(a) * 8.1 * 0.72), new THREE.Vector3(Math.cos(a) * (8.1 + l), -0.395, Math.sin(a) * (8.1 + l) * 0.72)); }
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(dp), draftMat));

  // İstasyon kaideleri: ortak plaka, ışık şeridi, içte dişliler, önde numaralı levha, ekranda etiket.
  const stations = [], groups = {};
  DEFS.forEach((d, i) => {
    const group = new THREE.Group(); group.position.fromArray(d.pos); machine.add(group); groups[d.id] = group;
    const glowMat = M.light.clone(); glowMat.emissiveIntensity = 0.5;
    box(group, 2.05, 0.12, 1.78, 0, 0.03, 0, M.dark, 0.1); box(group, 1.97, 0.03, 1.7, 0, 0.12, 0, glowMat, 0.09); box(group, 2.03, 0.17, 1.75, 0, 0.215, 0, M.body, 0.1);
    for (const x of [-0.85, 0.85]) for (const z of [-0.7, 0.7]) screw(group, x, 0.311, z);
    gear(group, -0.35, 0.45, 0, 0.27); gear(group, 0.22, 0.45, 0.12, 0.21);
    tube(group, [[-0.7, 0.4, -0.4], [-0.55, 0.48, 0.4], [0.35, 0.45, 0.6], [0.7, 0.58, 0.23]], 0.023, M.light);
    const order = DEFS.slice().sort((a, b) => a.step - b.step).findIndex((x) => x.id === d.id);
    screen(group, 1.54, 0.345, 0, 0.27, 0.891, T.plaque(order, d.name));
    const label = document.createElement('div'); label.className = 'station-label';
    label.innerHTML = `<i></i><div><b><span>${String(order + 1).padStart(2, '0')}</span>${d.name}</b><small>${d.output}</small></div>`;
    $('labels').appendChild(label); cleanups.push(() => label.remove());
    stations.push({ ...d, order, group, base: new THREE.Vector3(...d.pos), glowMat, label, anchor: new THREE.Vector3(0, 2.6, 0) });
  });
  const A = buildStationBodies(kit, T, groups);

  // Bant: kapalı eğri, örneklenmiş paletler, iki ray ve taşınan sipariş kartları.
  const path = new THREE.CatmullRomCurve3([[-3.95, 0.84, 0.65], [-3.1, 0.84, -0.12], [-1.45, 0.84, -0.79], [1.32, 0.84, -0.8], [3.3, 0.84, 0.19], [3.43, 0.84, 1.21], [1.35, 0.84, 2.7], [-1.4, 0.84, 2.52], [-3.54, 0.84, 1.65]].map((p) => new THREE.Vector3(...p)), true, 'catmullrom', 0.25);
  const belt = new THREE.Group(); machine.add(belt);
  const frameMesh = new THREE.Mesh(new THREE.TubeGeometry(path, 150, 0.35, 8, true), M.dark); frameMesh.scale.y = 0.3; frameMesh.position.y = 0.51; belt.add(frameMesh);
  const beltCount = 148, slats = new THREE.InstancedMesh(kit.boxGeo(0.135, 0.065, 0.63, 0.012), M.body, beltCount);
  slats.receiveShadow = true; slats.instanceMatrix.setUsage(THREE.DynamicDrawUsage); belt.add(slats);
  const dummy = new THREE.Object3D(), pV = new THREE.Vector3(), tV = new THREE.Vector3();
  function updateBelt(t) {
    for (let i = 0; i < beltCount; i++) {
      const u = (i / beltCount + t * 0.012) % 1; path.getPointAt(u, pV); path.getTangentAt(u, tV);
      dummy.position.copy(pV); dummy.rotation.set(0, -Math.atan2(tV.z, tV.x), 0); dummy.updateMatrix(); slats.setMatrixAt(i, dummy.matrix);
    }
    slats.instanceMatrix.needsUpdate = true;
  }
  updateBelt(0);
  for (const side of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 160; i++) { path.getPointAt(i / 160, pV); path.getTangentAt(i / 160, tV); pts.push(pV.clone().add(new THREE.Vector3(-tV.z * 0.36 * side, 0.09, tV.x * 0.36 * side))); }
    belt.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.028, 6, false), M.chrome));
  }
  for (let i = 0; i < 16; i++) { const p = path.getPointAt(i / 16); cyl(belt, 0.045, 0.43, p.x, 0.53, p.z, M.chrome); }
  const pipes = new THREE.Group(); machine.add(pipes);
  const flow = DEFS.slice().sort((a, b) => a.step - b.step).map((d) => stations.find((s) => s.id === d.id));
  for (let i = 0; i < 4; i++) {
    const a = flow[i].base, b = flow[i + 1].base;
    pipes.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a.clone().add(new THREE.Vector3(0.4, 0.12, 0)), a.clone().lerp(b, 0.35).add(new THREE.Vector3(0, 0.1, -0.6)), a.clone().lerp(b, 0.65).add(new THREE.Vector3(0, 0.1, -0.6)), b.clone().add(new THREE.Vector3(-0.4, 0.12, 0))]), 30, 0.054, 8, false), M.copper));
  }
  const faces = [T.order, T.plate, T.stock, T.receipt, T.syncCard];
  const packets = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group(); g.userData.moving = true; machine.add(g);
    box(g, 0.47, 0.71, 0.04, 0, 0, 0, M.ivory, 0.022);
    const fs = faces.map((tx) => { const s = screen(g, 0.43, 0.665, 0, 0, 0.024, tx); s.material.side = THREE.DoubleSide; s.visible = false; return s; });
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.414, 40), new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = -0.37; halo.visible = false; g.add(halo);
    packets.push({ group: g, faces: fs, halo, stage: -1, phase: 0 });
  }
  const port = (x, z) => { let best = 0, dist = Infinity; for (let i = 0; i < 300; i++) { const p = path.getPointAt(i / 300), d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < dist) { dist = d; best = i / 300; } } return best; };
  const depoU = port(-1.65, -0.7), kasaU = port(1.5, -0.7), bulutU = port(0.93, 2.65);

  // Durağan parçalar malzemeye göre birleştirilir; hareketli gruplar ayrı kalır.
  function compact(group) {
    for (const ch of [...group.children]) if (ch.isGroup) compact(ch);
    const buckets = new Map();
    for (const ch of group.children) { if (!ch.isMesh || ch.isInstancedMesh || ch.userData.moving || Array.isArray(ch.material)) continue; const k = ch.material.uuid; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(ch); }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => { m.updateMatrix(); const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); return g.applyMatrix4(m.matrix); });
      const merged = mergeGeometries(geos, false); geos.forEach((g) => g.dispose()); if (!merged) continue;
      const mesh = new THREE.Mesh(merged, list[0].material); mesh.castShadow = true; mesh.receiveShadow = true;
      list.forEach((m) => group.remove(m)); group.add(mesh);
    }
  }
  compact(machine);
  stations.forEach((s) => s.group.traverse((o) => { o.userData.station = s.id; }));

  // Tema: malzeme renkleri, ışık ve gölge yoğunluğu aynı anda değişir.
  function applyTheme(name) {
    const p = PALETTES[name] || PALETTES.dark;
    kit.applyPalette(p); hemi.color.setHex(p.hemiSky); hemi.groundColor.setHex(p.hemiGround); hemi.intensity = p.hemi;
    renderer.toneMappingExposure = p.exposure; scene.environmentIntensity = p.env; floorMat.opacity = p.floor; contactMat.opacity = p.contact;
    draftMat.color.setHex(p.draft); draftMat.opacity = p.draftOpacity;
  }
  applyTheme(document.documentElement.dataset.theme);
  listen(window, 'themechange', (e) => applyTheme(e.detail));

  // Durum, kamera ve dış API.
  let mode = 'assembled', cameraMode = 'overview', playing = !reduceMotion, simTime = 0, spread = 0, selected = 'mutfak', hovered = null;
  let width = W(), height = H(), mobile = width <= 900, lastInteraction = performance.now(), dragging = false, wasDragged = false, downX = 0, downY = 0;
  let cameraAnimating = true, lastDraw = -1, visible = true, sized = false, readySent = false, baseDistance = 25, online = false;
  const desiredPos = new THREE.Vector3(), desiredTarget = new THREE.Vector3(0, 1, 0), viewDir = new THREE.Vector3(10.5, 10.8, 17).normalize();
  function layout() {
    if (!W() || !H()) return;
    const first = !sized; sized = true; width = W(); height = H(); mobile = width <= 900;
    renderer.setSize(width, height); camera.aspect = width / height;
    camera.setViewOffset(width, height, mobile || !embedded ? 0 : -width * 0.21, 0, width, height);
    const aspect = width / height, avail = mobile ? 0.91 : 0.55;
    const hFit = 17.3 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect * avail);
    const vFit = 11.5 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (embedded ? 0.85 : 0.62));
    baseDistance = (Math.max(hFit, vFit) * (mobile ? 0.97 : 1)) / (embedded ? (mobile ? 1.4 : 1.2) : 1);
    controls.maxDistance = Math.max(55, baseDistance * 1.6); camera.updateProjectionMatrix(); goal(); cameraAnimating = true;
    if (first) { camera.position.copy(desiredPos); controls.target.copy(desiredTarget); controls.update(); cameraAnimating = false; }
  }
  function goal() {
    if (cameraMode === 'station') {
      const s = stations.find((x) => x.id === selected); desiredTarget.copy(s.group.position).add(new THREE.Vector3(0, 1.25, 0));
      desiredPos.copy(desiredTarget).addScaledVector(viewDir, mobile ? 9 : 12); return;
    }
    desiredTarget.set(0, 1, 0); const d = baseDistance * (mode === 'stations' ? 1.2 : 1);
    if (cameraMode === 'top') desiredPos.set(0.01, d, 0.8).add(desiredTarget); else desiredPos.copy(viewDir).multiplyScalar(d).add(desiredTarget);
  }
  function sync() {
    root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('journey')?.classList.toggle('visible', mode === 'order');
  }
  // instant: hareket azaltma açıksa veya mod adresten geliyorsa kesit ve açılım beklemeden uygulanır.
  function setMode(next, instant = reduceMotion) {
    if (!['assembled', 'cutaway', 'stations', 'order'].includes(next)) return false;
    mode = next; lastInteraction = performance.now(); cameraMode = 'overview';
    if (instant) { kit.cutPlane.constant = mode === 'cutaway' ? 0.99 : 10; spread = mode === 'stations' ? 1 : 0; }
    if (mode === 'order') { simTime = 0; lastDraw = -1; playing = true; }
    goal(); cameraAnimating = true; sync(); return true;
  }
  function focusStation(id) { if (!stations.some((s) => s.id === id)) return false; selected = id; if (mode === 'order') mode = 'assembled'; cameraMode = 'station'; goal(); cameraAnimating = true; sync(); return true; }
  const api = {
    setMode, focusStation, overview: () => { cameraMode = 'overview'; goal(); cameraAnimating = true; return true; }, play: () => (playing = true), pause: () => !(playing = false),
    state: () => ({ mode, simTime, cut: kit.cutPlane.constant, spread, clipping: renderer.localClippingEnabled })
  };
  window.__restaurant = api; cleanups.push(() => { if (window.__restaurant === api) delete window.__restaurant; });
  root.querySelectorAll('[data-mode]').forEach((b) => listen(b, 'click', () => setMode(b.dataset.mode)));
  layout(); listen(window, 'resize', layout);
  const ro = new ResizeObserver(layout); ro.observe(root); cleanups.push(() => ro.disconnect());
  controls.addEventListener('start', () => { dragging = true; cameraAnimating = false; lastInteraction = performance.now(); });
  controls.addEventListener('end', () => { dragging = false; lastInteraction = performance.now(); });

  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), tip = $('tooltip');
  const local = (e) => { const r = root.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const hit = (x, y) => { ptr.set((x / width) * 2 - 1, (-y / height) * 2 + 1); ray.setFromCamera(ptr, camera); const h = ray.intersectObjects(stations.map((s) => s.group), true); return h.length ? stations.find((s) => s.id === h[0].object.userData.station) : null; };
  listen(renderer.domElement, 'pointermove', (e) => {
    const [x, y] = local(e); if (Math.hypot(x - downX, y - downY) > 5) wasDragged = true; if (dragging) return;
    const s = hit(x, y); hovered = s ? s.id : null; renderer.domElement.style.cursor = s ? 'pointer' : 'grab'; tip.classList.toggle('visible', !!s);
    if (s) {
      tip.querySelector('b').innerHTML = `<span>${String(s.order + 1).padStart(2, '0')}</span>${s.name}`; tip.querySelector('p').textContent = s.desc;
      tip.style.left = Math.min(width - 255, Math.max(10, x + 16)) + 'px'; tip.style.top = Math.max(10, Math.min(height - 95, y - 65)) + 'px';
    }
  });
  listen(renderer.domElement, 'pointerleave', () => { hovered = null; tip.classList.remove('visible'); });
  listen(renderer.domElement, 'pointerdown', (e) => { [downX, downY] = local(e); wasDragged = false; tip.classList.remove('visible'); });
  listen(renderer.domElement, 'pointerup', (e) => { if (wasDragged) return; const s = hit(...local(e)); if (!s) return; focusStation(s.id); opts.onStation?.(s.id); });
  const io = new IntersectionObserver((en) => { visible = en[0].isIntersecting && !document.hidden; }, { threshold: 0.01 }); io.observe(renderer.domElement); cleanups.push(() => io.disconnect());
  listen(document, 'visibilitychange', () => { visible = !document.hidden; });

  const scratch = new THREE.Vector3(), anchor = new THREE.Vector3();
  let prevJourney = -1, lastFrame = performance.now(), raf = 0;
  const at = (id) => stations.find((s) => s.id === id).group.position;
  function animate(now) {
    raf = requestAnimationFrame(animate);
    const dt = Math.max(0, Math.min((now - lastFrame) / 1000, 0.045)); lastFrame = now;
    if (!visible) return;
    if (playing) simTime += dt;
    const t = simTime, beat = (t / 4) % 1, tact = (t * TAU) / 4, smooth = 1 - Math.exp(-dt * 5);
    spread = THREE.MathUtils.lerp(spread, mode === 'stations' ? 1 : 0, smooth);
    kit.cutPlane.constant = THREE.MathUtils.lerp(kit.cutPlane.constant, mode === 'cutaway' ? 0.99 : 10, smooth);
    stations.forEach((s, i) => {
      s.group.position.copy(s.base); s.group.position.x *= 1 + spread * 0.29; s.group.position.z *= 1 + spread * 0.37; s.group.position.y += spread * (i % 2 ? 0.32 : 0.55);
      const pulse = Math.pow(Math.max(0, Math.sin(tact - s.order * 0.9)), 7);
      s.glowMat.emissiveIntensity = THREE.MathUtils.lerp(s.glowMat.emissiveIntensity, hovered === s.id || (cameraMode === 'station' && selected === s.id) ? 3.5 : 0.55 + pulse * 0.65, smooth);
    });
    belt.scale.set(1 + spread * 0.12, 1, 1 + spread * 0.15); pipes.scale.set(1 + spread * 0.25, 1, 1 + spread * 0.3);
    kit.gears.forEach((g, i) => { g.rotation.y = t * (i % 2 ? -1 : 1) * 1.1; });
    // İstasyon hareketleri: buhar, alev, kapak, FIFO sandığı, çekmece, fiş, para, eşitleme halkaları.
    A.steam.forEach((s) => { const k = (t * 0.35 + s.userData.seed) % 1; s.position.set(-0.42 + Math.sin(k * 9 + s.userData.seed * 20) * 0.08, 1.45 + k * 1.0, -0.3 + Math.cos(k * 7) * 0.06); s.scale.setScalar(0.6 + k * 1.6); });
    A.flames.forEach((f, i) => { f.scale.setScalar(1 + Math.sin(t * 9 + i) * 0.06); });
    A.lid.rotation.z = Math.sin(t * 11) * 0.03; A.lid.position.y = 1.38 + Math.max(0, Math.sin(t * 5)) * 0.015;
    const slide = Math.max(0, Math.sin(tact)); A.lot.position.z = slide * 0.55;
    const orderPhase = (t / 24) % 1, cashBeat = mode === 'order' ? THREE.MathUtils.clamp((orderPhase - 0.62) / 0.2, 0, 1) : beat;
    A.drawer.position.z = 0.12 + Math.sin(Math.min(1, cashBeat * 1.4) * Math.PI) * 0.32;
    A.receipt.scale.y = 0.2 + Math.min(1, cashBeat * 1.5) * 0.8;
    A.coin.position.set(1.04, 2.7 - Math.min(1, cashBeat * 1.7) ** 2 * 2.17, 0.55); A.coin.rotation.y = t * 3.5; A.coin.scale.setScalar(cashBeat > 0.9 ? Math.max(0.05, 1 - (cashBeat - 0.9) * 8) : 1);
    const cardBeat = mode === 'order' ? Math.min(1, orderPhase / 0.15) : beat;
    A.card.visible = mode !== 'order' || orderPhase < 0.15;
    A.card.position.set(0.2 + Math.sin(cardBeat * Math.PI) * 0.24, 1.1 + cardBeat * 1.8, -0.1 + cardBeat * 0.3); A.card.rotation.y = Math.sin(cardBeat * Math.PI) * -0.3;
    A.card.scale.setScalar(Math.min(1, cardBeat * 8 + 0.15, (1 - cardBeat) * 7 + 0.1));
    const nowOnline = mode === 'order' ? orderPhase > 0.9 : Math.sin(t * 0.4) > 0.55;
    if (nowOnline !== online) { online = nowOnline; T.drawSync(online); A.syncMat.color.setHex(online ? 0x3fbf6f : 0xff5a1f); A.syncMat.emissive.setHex(online ? 0x2fae5f : 0xff5a1f); }
    A.rings.forEach((r, i) => { r.rotation.z = t * (i % 2 ? -0.8 : 0.6); r.scale.setScalar(1 + Math.max(0, Math.sin(t * 3 - i)) * (online ? 0.08 : 0.02)); });
    if (t - lastDraw > 1 / 12 || lastDraw < 0) { T.drawKds(t); updateBelt(t); lastDraw = t; }
    packets.forEach((pk, i) => {
      const phase = (t / 24 + i / 6) % 1; pk.phase = phase; let stage;
      if (phase < 0.15) {
        stage = 0; const f = phase / 0.15;
        pk.group.position.copy(at('salon')).add(new THREE.Vector3(0, 1.6, 0.6)); scratch.copy(at('mutfak')).add(new THREE.Vector3(0, 1.3, 0.65));
        pk.group.position.lerp(scratch, f); pk.group.position.y += Math.sin(f * Math.PI) * 2; pk.group.rotation.set(0, Math.sin(f * Math.PI) * 0.28, Math.sin(f * Math.PI) * -0.1);
      } else {
        const u = ((phase - 0.15) / 0.85) * bulutU; path.getPointAt(u, pk.group.position);
        pk.group.position.x *= 1 + spread * 0.12; pk.group.position.z *= 1 + spread * 0.15; pk.group.position.y += 0.43; pk.group.rotation.set(0, 0.18, 0);
        stage = u < depoU * 0.7 ? 1 : u < kasaU * 0.96 ? 2 : u < bulutU * 0.83 ? 3 : 4;
      }
      if (pk.stage !== stage) { pk.faces.forEach((f, j) => (f.visible = j === stage)); pk.stage = stage; }
      pk.group.visible = mode !== 'order' || i === 0; pk.halo.visible = mode === 'order' && i === 0;
      pk.group.scale.setScalar(mode === 'order' ? 1.35 : 1); if (phase > 0.94) pk.group.scale.multiplyScalar(Math.max(0.05, (1 - phase) / 0.06));
    });
    if (mode === 'order') {
      const pk = packets[0];
      if (pk.stage !== prevJourney) { $('journey-title').textContent = JOURNEY[pk.stage][0]; $('journey-detail').textContent = JOURNEY[pk.stage][1]; prevJourney = pk.stage; }
      $('journey-progress').style.width = pk.phase * 100 + '%';
      if (!dragging && playing) { desiredTarget.copy(pk.group.position); desiredPos.copy(desiredTarget).addScaledVector(viewDir, mobile ? 10 : 15); cameraAnimating = true; }
    } else if (cameraMode === 'station' && cameraAnimating) goal();
    if (cameraAnimating && !dragging) {
      const k = 1 - Math.exp(-dt * (mode === 'order' ? 2.2 : 3)); camera.position.lerp(desiredPos, k); controls.target.lerp(desiredTarget, k);
      if (mode !== 'order' && camera.position.distanceTo(desiredPos) < 0.015 && controls.target.distanceTo(desiredTarget) < 0.015) cameraAnimating = false;
    }
    controls.autoRotate = playing && !reduceMotion && !dragging && !cameraAnimating && mode !== 'order' && cameraMode === 'overview' && now - lastInteraction > 6500;
    controls.autoRotateSpeed = 0.24; controls.update(dt);
    stations.forEach((s) => {
      const show = mode === 'stations'; s.label.classList.toggle('visible', show); if (!show) return;
      anchor.copy(s.group.position).add(s.anchor).project(camera);
      let x = (anchor.x * 0.5 + 0.5) * width - 20, y = (-anchor.y * 0.5 + 0.5) * height - 60;
      x = THREE.MathUtils.clamp(x, mobile || !embedded ? 9 : width * 0.44, width - (mobile ? 110 : 150)); y = THREE.MathUtils.clamp(y, 70, height - 150);
      s.label.style.transform = `translate(${x}px,${y}px)`;
    });
    renderer.render(scene, camera);
    if (!readySent && sized) { readySent = true; $('loading')?.classList.add('done'); opts.onReady?.(); }
  }
  raf = requestAnimationFrame(animate);
  cleanups.push(() => {
    cancelAnimationFrame(raf); controls.dispose();
    const tx = new Set(); scene.traverse((o) => { o.geometry?.dispose();[].concat(o.material || []).forEach((m) => { Object.values(m).forEach((v) => v?.isTexture && tx.add(v)); m.dispose(); }); });
    kit.geometries.forEach((g) => g.dispose()); tx.forEach((t) => t.dispose()); env.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  });
  renderer.compile(scene, camera);
  $('loading')?.classList.add('done');
  return () => { cleanups.reverse().forEach((f) => f()); cleanups.length = 0; };
}
