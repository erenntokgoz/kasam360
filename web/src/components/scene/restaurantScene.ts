// KASAM360 restoran makinesi: tek plaka üstünde beş istasyon, aralarında dönen bant.
// Masa 12'nin siparişi salondan kalkar; mutfakta tabağa, depoda stok kaydına, kasada fişe, bulutta eşitleme kaydına dönüşür.
// Kullanıcının verdiği three.js atölye sahnesinden uyarlandı; geometri yaklaşımı ve zamanlama korundu.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createKit, PALETTES, TAU } from './sceneKit';
import { buildStationBodies, type StationId } from './sceneStations';
import { buildTextures } from './sceneTextures';
import { runLoop } from './sceneLoop';
import type { Packet, Ripple, SceneApi, SceneDom, SceneOptions, Station, StationDef } from './sceneTypes';

export type { SceneApi, SceneDom, SceneMode, SceneOptions } from './sceneTypes';

const DEFS: StationDef[] = [
  { id: 'mutfak', name: 'Mutfak', step: 2, output: 'tabak', pos: [-4.15, 0.29, -0.65], desc: 'Sipariş mutfak ekranına düşer, süre sayılır.' },
  { id: 'depo', name: 'Depo', step: 3, output: 'stok', pos: [-1.65, 0.29, -2.03], desc: 'Malzeme en eski partiden düşülür.' },
  { id: 'kasa', name: 'Kasa', step: 4, output: 'fiş', pos: [1.5, 0.29, -2.08], desc: 'Hesap parçalı alınır; nakit ve kart ayrı sayılır.' },
  { id: 'salon', name: 'Salon', step: 1, output: 'sipariş', pos: [4.03, 0.29, 0.12], desc: 'Garson masayı açar, siparişi terminalden girer.' },
  { id: 'bulut', name: 'Bulut', step: 5, output: 'eşitleme', pos: [0.93, 0.29, 1.85], desc: 'İnternet yokken kayıtlar sırada bekler, gelince gider.' },
];
const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

export function initRestaurantScene(dom: SceneDom, opts: SceneOptions): SceneApi {
  const cleanups: Array<() => void> = [];
  const listen = (t: EventTarget, type: string, fn: (e: never) => void) => {
    const h = fn as unknown as EventListener; t.addEventListener(type, h); cleanups.push(() => t.removeEventListener(type, h));
  };
  const W = () => dom.host.clientWidth, H = () => dom.host.clientHeight;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const embedded = opts.embedded;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, W() < 900 ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.localClippingEnabled = true;
  dom.canvasHost.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, Math.max(W(), 1) / Math.max(H(), 1), 0.1, 150);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.065, enablePan: false, minDistance: 7, maxDistance: 55,
    minPolarAngle: 0.09, maxPolarAngle: Math.PI * 0.475, rotateSpeed: 0.48, zoomSpeed: 0.7 });
  // Sayfaya gömülüyken tekerlek ve parmak sayfayı kaydırır; dokunmatikte döndürme kapalıdır.
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

  const kit = createKit(renderer, getComputedStyle(dom.host).fontFamily);
  const { M, box, cyl, screw, screen, canvasTexture, gear, tube } = kit;
  const T = buildTextures(kit);
  const machine = new THREE.Group(); scene.add(machine);

  const floorMat = new THREE.ShadowMaterial({ opacity: 0.23 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.43; floor.receiveShadow = true; scene.add(floor);
  const blob = canvasTexture(128, 128, (c) => { const g = c.createRadialGradient(64, 64, 12, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,.8)'); g.addColorStop(0.55, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 128, 128); });
  const contactMat = new THREE.MeshBasicMaterial({ map: blob.texture, transparent: true, depthWrite: false, opacity: 0.65 });
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(18, 13), contactMat); contact.rotation.x = -Math.PI / 2; contact.position.y = -0.415; scene.add(contact);

  // Plaka: katmanlı ve vidalı. Yazı sahneye basılmaz; küçük boyda okunmadığı için istasyon adları HTML etiketle verilir.
  box(machine, 12.8, 0.38, 8.25, 0, -0.09, 0, M.base, 0.17); box(machine, 12.6, 0.055, 8.08, 0, 0.13, 0, M.edge, 0.11);
  box(machine, 12.49, 0.09, 7.96, 0, 0.19, 0, M.body, 0.1); box(machine, 12.55, 0.027, 8.02, 0, -0.19, 0, M.dark, 0.06);
  box(machine, 11.9, 0.026, 0.032, 0, -0.17, 4.115, M.light, 0.01);
  for (const x of [-5.6, 5.6]) for (const z of [-3.35, 3.35]) { cyl(machine, 0.39, 0.25, x, -0.31, z, M.rubber); screw(machine, x, 0.253, z); }
  for (const x of [-6.02, 6.02]) for (const z of [-3.73, 3.73]) screw(machine, x, 0.255, z);
  const draftMat = new THREE.LineBasicMaterial({ color: 0x69717a, transparent: true, opacity: 0.12 });
  const dp: THREE.Vector3[] = [];
  for (const r of [7.5, 8.1]) for (let i = 0; i < 120; i++) for (const j of [i, i + 1]) { const a = (j / 120) * TAU; dp.push(new THREE.Vector3(Math.cos(a) * r, -0.4, Math.sin(a) * r * 0.72)); }
  for (let i = 0; i < 52; i++) { const a = (i / 52) * TAU, l = i % 4 ? 0.07 : 0.16; dp.push(new THREE.Vector3(Math.cos(a) * 8.1, -0.395, Math.sin(a) * 8.1 * 0.72), new THREE.Vector3(Math.cos(a) * (8.1 + l), -0.395, Math.sin(a) * (8.1 + l) * 0.72)); }
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(dp), draftMat));

  // İstasyon kaideleri: ışık şeridi, içte dişliler; adı ve numarası üstteki HTML etikette.
  const flowOrder = DEFS.slice().sort((a, b) => a.step - b.step).map((d) => d.id);
  const groups = {} as Record<StationId, THREE.Group>;
  const stations: Station[] = DEFS.map((d) => {
    const group = new THREE.Group(); group.position.fromArray(d.pos); machine.add(group); groups[d.id] = group;
    const glowMat = M.light.clone(); glowMat.emissiveIntensity = 0.5;
    box(group, 2.05, 0.12, 1.78, 0, 0.03, 0, M.dark, 0.1); box(group, 1.97, 0.03, 1.7, 0, 0.12, 0, glowMat, 0.09); box(group, 2.03, 0.17, 1.75, 0, 0.215, 0, M.body, 0.1);
    for (const x of [-0.85, 0.85]) for (const z of [-0.7, 0.7]) screw(group, x, 0.311, z);
    gear(group, -0.35, 0.45, 0, 0.27); gear(group, 0.22, 0.45, 0.12, 0.21);
    tube(group, [[-0.7, 0.4, -0.4], [-0.55, 0.48, 0.4], [0.35, 0.45, 0.6], [0.7, 0.58, 0.23]], 0.023, M.light);
    const order = flowOrder.indexOf(d.id);
    const label = document.createElement('div'); label.className = 'k5-station-label';
    const no = String(order + 1).padStart(2, '0');
    label.innerHTML = `<i></i><div><b><span>${no}</span>${d.name}</b><small>${d.output}</small></div>`;
    dom.labels.appendChild(label); cleanups.push(() => label.remove());
    return { ...d, order, group, base: new THREE.Vector3(...d.pos), glowMat, label, anchor: new THREE.Vector3(0, 2.6, 0) };
  });
  const A = buildStationBodies(kit, T, groups);
  const at = (id: StationId) => groups[id].position;

  // Bant: kapalı eğri, örneklenmiş paletler, iki ray ve taşınan sipariş kartları.
  const path = new THREE.CatmullRomCurve3(([[-3.95, 0.84, 0.65], [-3.1, 0.84, -0.12], [-1.45, 0.84, -0.79], [1.32, 0.84, -0.8], [3.3, 0.84, 0.19], [3.43, 0.84, 1.21], [1.35, 0.84, 2.7], [-1.4, 0.84, 2.52], [-3.54, 0.84, 1.65]] as Array<[number, number, number]>).map((p) => new THREE.Vector3(...p)), true, 'catmullrom', 0.25);
  const belt = new THREE.Group(); machine.add(belt);
  const frameMesh = new THREE.Mesh(new THREE.TubeGeometry(path, 150, 0.35, 8, true), M.dark); frameMesh.scale.y = 0.3; frameMesh.position.y = 0.51; belt.add(frameMesh);
  const beltCount = 148, slats = new THREE.InstancedMesh(kit.boxGeo(0.135, 0.065, 0.63, 0.012), M.body, beltCount);
  slats.receiveShadow = true; slats.instanceMatrix.setUsage(THREE.DynamicDrawUsage); belt.add(slats);
  const dummy = new THREE.Object3D(), pV = new THREE.Vector3(), tV = new THREE.Vector3();
  const updateBelt = (t: number) => {
    for (let i = 0; i < beltCount; i++) {
      const u = (i / beltCount + t * 0.012) % 1; path.getPointAt(u, pV); path.getTangentAt(u, tV);
      dummy.position.copy(pV); dummy.rotation.set(0, -Math.atan2(tV.z, tV.x), 0); dummy.updateMatrix(); slats.setMatrixAt(i, dummy.matrix);
    }
    slats.instanceMatrix.needsUpdate = true;
  };
  updateBelt(0);
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 160; i++) { path.getPointAt(i / 160, pV); path.getTangentAt(i / 160, tV); pts.push(pV.clone().add(new THREE.Vector3(-tV.z * 0.36 * side, 0.09, tV.x * 0.36 * side))); }
    belt.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.028, 6, false), M.chrome));
  }
  for (let i = 0; i < 16; i++) { const p = path.getPointAt(i / 16); cyl(belt, 0.045, 0.43, p.x, 0.53, p.z, M.chrome); }
  const pipes = new THREE.Group(); machine.add(pipes);
  for (let i = 0; i < 4; i++) {
    const a = at(flowOrder[i]).clone(), b = at(flowOrder[i + 1]).clone();
    const curve = new THREE.CatmullRomCurve3([a.clone().add(new THREE.Vector3(0.4, 0.12, 0)), a.clone().lerp(b, 0.35).add(new THREE.Vector3(0, 0.1, -0.6)), a.clone().lerp(b, 0.65).add(new THREE.Vector3(0, 0.1, -0.6)), b.clone().add(new THREE.Vector3(-0.4, 0.12, 0))]);
    pipes.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.054, 8, false), M.copper));
  }
  const faces = [T.order, T.plate, T.stock, T.receipt, T.syncCard];
  const packets: Packet[] = Array.from({ length: 6 }, () => {
    const g = new THREE.Group(); g.userData.moving = true; machine.add(g);
    box(g, 0.47, 0.71, 0.04, 0, 0, 0, M.ivory, 0.022);
    const fs = faces.map((tx) => { const s = screen(g, 0.43, 0.665, 0, 0, 0.024, tx); (s.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide; s.visible = false; return s; });
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.414, 40), new THREE.MeshBasicMaterial({ color: 0x4c6ef5, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = -0.37; halo.visible = false; g.add(halo);
    return { group: g, faces: fs, halo, stage: -1, phase: 0 };
  });
  // Varış dalgası: öndeki sipariş bir istasyona geçtiğinde kaidesinden genişleyip sönen halka.
  const ripples: Ripple[] = Array.from({ length: 3 }, () => {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), new THREE.MeshBasicMaterial({ color: 0x4c6ef5, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2; mesh.visible = false; mesh.userData.moving = true; machine.add(mesh); return { mesh, age: 1 };
  });
  const port = (x: number, z: number) => { let best = 0, dist = Infinity; for (let i = 0; i < 300; i++) { const p = path.getPointAt(i / 300), d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < dist) { dist = d; best = i / 300; } } return best; };
  const depoU = port(-1.65, -0.7), kasaU = port(1.5, -0.7), bulutU = port(0.93, 2.65);

  // Durağan parçalar malzemeye göre birleştirilir; çizim çağrısı azalır, hareketli gruplar ayrı kalır.
  function compact(group: THREE.Object3D) {
    for (const ch of [...group.children]) if ((ch as THREE.Group).isGroup) compact(ch);
    const buckets = new Map<string, THREE.Mesh[]>();
    for (const ch of group.children) {
      const m = ch as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || m.userData.moving || Array.isArray(m.material)) continue;
      const k = (m.material as THREE.Material).uuid; const list = buckets.get(k) ?? []; list.push(m); buckets.set(k, list);
    }
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

  // Tema: malzeme renkleri, ışık ve gölge yoğunluğu birlikte değişir.
  const applyTheme = () => {
    const p = PALETTES[currentTheme()];
    kit.applyPalette(p); hemi.color.setHex(p.hemiSky); hemi.groundColor.setHex(p.hemiGround); hemi.intensity = p.hemi;
    renderer.toneMappingExposure = p.exposure; scene.environmentIntensity = p.env; floorMat.opacity = p.floor; contactMat.opacity = p.contact;
    draftMat.color.setHex(p.draft); draftMat.opacity = p.draftOpacity;
  };
  applyTheme();
  const themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  cleanups.push(() => themeObserver.disconnect());

  return runLoop({ dom, opts, renderer, scene, camera, controls, kit, T, A, stations, packets, path, belt, pipes, updateBelt, at, depoU, kasaU, bulutU, reduceMotion, embedded, W, H, ripples, listen, cleanups, env });
}
