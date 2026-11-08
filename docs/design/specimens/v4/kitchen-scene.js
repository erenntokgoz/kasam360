// KASAM360 restoran makinesi: masa, mutfak, servis, kasa ve eşitleme kutusu tek çelik plaka üzerinde.
// Bir sipariş bant üzerinde istasyondan istasyona gider. Model ve görsel yok; her şey kodla çizilir.
// Açık ve koyu tema aynı sahneyi farklı ışık ve malzemeyle gösterir.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const TAU = Math.PI * 2;
const tl = c => (c / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
// Sahnedeki tutarlar tek fixture'dan gelir.
const ORDER = { table: '12', qty: 4, item: 'Ev usulü mantı', note: 'biri acısız', unit: 12500, cash: 20000, card: 30000 };
const TOTAL = ORDER.qty * ORDER.unit;
if (ORDER.cash + ORDER.card !== TOTAL) throw new Error('Sahne toplamı tutmuyor');

export const STATIONS = [
  { id: 'salon', name: 'Salon', pos: [-4.05, 0.29, 0.45], port: [-3.2, 0.55], title: `Masa ${ORDER.table} sipariş verdi`, desc: `${ORDER.qty} ${ORDER.item}, ${ORDER.note}. Garson tabletten mutfağa gönderdi.` },
  { id: 'mutfak', name: 'Mutfak', pos: [-1.75, 0.29, -2.3], port: [-1.75, -1.25], title: 'Mutfak hazırlıyor', desc: 'Sipariş mutfak ekranına düştü ve süre saymaya başladı.' },
  { id: 'servis', name: 'Servis', pos: [1.45, 0.29, -2.3], port: [1.45, -1.25], title: 'Tabak pasoda', desc: 'Hazır olan tabak için garsona haber gitti.' },
  { id: 'kasa', name: 'Kasa', pos: [3.95, 0.29, 0.3], port: [3.2, 0.3], title: 'Hesap kapandı', desc: `Nakit ${tl(ORDER.cash)} ve kart ${tl(ORDER.card)}, toplam ${tl(TOTAL)} TL. İnternet yokken.` },
  { id: 'bulut', name: 'Eşitleme', pos: [0, 0.29, 0.2], port: [0.6, 1.65], title: 'Kayıt sırada', desc: 'Bağlantı dönünce kayıtlar sırasıyla buluta gider.' },
];

export function startKitchen(root, { font, onStage, onReady } = {}) {
  const host = root.querySelector('[data-scene]');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const W = () => host.clientWidth, H = () => host.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(W(), H());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, W() / H(), 0.1, 150);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = env.texture;
  const hemi = new THREE.HemisphereLight(0xdbe5f4, 0x29211a, 2);
  const key = new THREE.DirectionalLight(0xfff1d8, 4);
  key.position.set(-4, 12, 7); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 9, bottom: -9, near: .5, far: 35 });
  key.shadow.normalBias = .035;
  const rim = new THREE.DirectionalLight(0xc4d4ed, 2.6); rim.position.set(3, 7, -8);
  const warm = new THREE.PointLight(0xff8a3d, 22, 14, 2); warm.position.set(-2, 3.2, -1.6);
  scene.add(hemi, key, rim, warm);

  const mat = (color, metalness = .1, roughness = .4, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  const M = {
    base: mat(0, .85, .32), body: mat(0, .75, .3), steel: mat(0, .8, .26), edge: mat(0, .85, .24),
    chrome: mat(0xc3cad0, .92, .18), dark: mat(0x14181d, .45, .4), rubber: mat(0x0b1015, .1, .6),
    ivory: mat(0xf1efe8, .05, .5), wood: mat(0x7a5a3c, .1, .6), food: mat(0xe6cf9c, 0, .7), sauce: mat(0xc0461f, 0, .6),
    signal: mat(0xff5a1f, .2, .3, { emissive: 0xff5a1f, emissiveIntensity: 1.2 }),
    flame: mat(0xff7a2a, 0, .4, { emissive: 0xff6a1a, emissiveIntensity: 2.4 }),
    heat: mat(0xffd59a, 0, .3, { emissive: 0xffb15a, emissiveIntensity: 2 }),
    green: mat(0x3dd68c, 0, .4, { emissive: 0x3dd68c, emissiveIntensity: 1.4 }),
  };
  const geos = new Map();
  const boxGeo = (w, h, d, r) => { const k = `b${w},${h},${d},${r}`; if (!geos.has(k)) geos.set(k, r ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 3, h / 3, d / 3)) : new THREE.BoxGeometry(w, h, d)); return geos.get(k); };
  const mesh = (p, g, m, x, y, z) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; p.add(o); return o; };
  const box = (p, w, h, d, x, y, z, m = M.body, r = .04) => mesh(p, boxGeo(w, h, d, r), m, x, y, z);
  const cyl = (p, r, h, x, y, z, m = M.chrome, r2 = r) => mesh(p, new THREE.CylinderGeometry(r, r2, h, 28), m, x, y, z);
  const ball = (p, r, x, y, z, m) => mesh(p, new THREE.SphereGeometry(r, 14, 10), m, x, y, z);
  function paint(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    const redraw = (...a) => { draw(ctx, w, h, ...a); texture.needsUpdate = true; };
    redraw(0); return { texture, redraw };
  }
  const txt = (c, s, x, y, size, color, weight = 500) => { c.fillStyle = color; c.font = `${weight} ${size}px ${font}`; c.fillText(s, x, y); };
  const screen = (p, w, h, x, y, z, t) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t.texture, toneMapped: false })); o.position.set(x, y, z); p.add(o); return o; };

  const machine = new THREE.Group(); scene.add(machine);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.ShadowMaterial({ opacity: .22 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.43; floor.receiveShadow = true; scene.add(floor);
  // Katmanlı plaka, kauçuk ayaklar ve ön kenarda ince ışık şeridi.
  box(machine, 11.2, .38, 7.3, 0, -.09, 0, M.base, .17);
  box(machine, 11.0, .055, 7.13, 0, .13, 0, M.edge, .11);
  box(machine, 10.89, .09, 7.01, 0, .19, 0, M.body, .1);
  box(machine, 10.3, .026, .032, 0, -.17, 3.64, M.signal, .01);
  for (const x of [-4.8, 4.8]) for (const z of [-2.9, 2.9]) cyl(machine, .39, .25, x, -.31, z, M.rubber);
  const plate = paint(1400, 170, (c, w, h) => {
    c.fillStyle = '#23282e'; c.fillRect(0, 0, w, h); c.strokeStyle = '#4b525a'; c.lineWidth = 3; c.strokeRect(3, 3, w - 6, h - 6);
    txt(c, 'KASAM360', 44, 102, 64, '#e9e6dd', 800); txt(c, 'Salon, mutfak, servis ve kasa. İnternet olmadan da.', 470, 98, 30, '#9aa3ad', 500);
  });
  const nameplate = screen(machine, 5.6, .68, -2.25, .246, 3.08, plate); nameplate.rotation.x = -Math.PI / 2;

  const stations = STATIONS.map(def => {
    const g = new THREE.Group(); g.position.fromArray(def.pos); machine.add(g);
    const glow = M.signal.clone(); glow.emissiveIntensity = .4;
    box(g, 2.05, .12, 1.78, 0, .03, 0, M.dark, .1); box(g, 1.97, .03, 1.7, 0, .12, 0, glow, .09); box(g, 2.03, .17, 1.75, 0, .215, 0, M.body, .1);
    g.traverse(o => (o.userData.station = def.id));
    return { ...def, group: g, glow };
  });
  const S = Object.fromEntries(stations.map(s => [s.id, s.group]));

  // Salon: masa, dört sandalye ve garson tableti.
  cyl(S.salon, .56, .06, -.15, .95, -.05, M.wood); cyl(S.salon, .06, .6, -.15, .63, -.05, M.chrome); cyl(S.salon, .3, .04, -.15, .32, -.05, M.chrome);
  for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + .4, x = -.15 + Math.cos(a) * .78, z = -.05 + Math.sin(a) * .62;
    const seat = box(S.salon, .34, .05, .34, x, .62, z, M.dark, .02); seat.rotation.y = -a;
    const back = box(S.salon, .34, .4, .05, x + Math.cos(a) * .17, .84, z + Math.sin(a) * .17, M.dark, .02); back.rotation.y = -a + Math.PI / 2;
    cyl(S.salon, .03, .3, x, .45, z, M.chrome); }
  for (const [x, z] of [[-.4, .1], [.1, -.2]]) { cyl(S.salon, .14, .015, x, .99, z, M.ivory); for (let k = 0; k < 4; k++) ball(S.salon, .035, x + Math.cos(k * 1.6) * .05, 1.015, z + Math.sin(k * 1.6) * .05, M.food); }
  cyl(S.salon, .03, .55, .78, .6, .55, M.chrome);
  const tablet = new THREE.Group(); tablet.position.set(.78, 1.02, .55); tablet.rotation.set(-.55, -.5, 0); S.salon.add(tablet);
  box(tablet, .64, .44, .04, 0, 0, 0, M.dark, .03);
  screen(tablet, .58, .38, 0, 0, .022, paint(480, 320, (c, w, h) => {
    c.fillStyle = '#12161b'; c.fillRect(0, 0, w, h); txt(c, `Masa ${ORDER.table}`, 26, 70, 54, '#f0eee8', 800);
    txt(c, `${ORDER.qty}  ${ORDER.item}`, 28, 140, 30, '#d8dbde'); txt(c, ORDER.note, 28, 180, 24, '#8d97a1');
    c.fillStyle = '#ff5a1f'; c.beginPath(); c.roundRect(26, 222, 428, 70, 12); c.fill(); txt(c, 'Mutfağa gönder', 46, 270, 32, '#14171a', 700);
  }));

  // Mutfak: ocak, tavalar, davlumbaz ve mutfak ekranı.
  box(S.mutfak, 1.82, .64, 1.3, 0, .63, .05, M.steel, .08); box(S.mutfak, 1.72, .04, 1.2, 0, .97, .05, M.dark, .02);
  const flames = [];
  for (const [x, z] of [[-.45, -.2], [.45, -.2], [-.45, .35], [.45, .35]]) {
    cyl(S.mutfak, .22, .02, x, .99, z, M.dark);
    const f = new THREE.Mesh(new THREE.TorusGeometry(.15, .022, 8, 28), M.flame.clone()); f.rotation.x = Math.PI / 2; f.position.set(x, 1.005, z); S.mutfak.add(f); flames.push(f);
  }
  const pan = new THREE.Group(); pan.position.set(-.45, 1.07, .35); S.mutfak.add(pan); pan.userData.moving = true;
  cyl(pan, .27, .1, 0, 0, 0, M.dark, .22); box(pan, .5, .04, .06, .45, .03, 0, M.dark, .015);
  for (let k = 0; k < 6; k++) ball(pan, .045, Math.cos(k) * .12, .06, Math.sin(k) * .12, M.food);
  cyl(S.mutfak, .21, .34, .45, 1.17, -.2, M.chrome); cyl(S.mutfak, .22, .03, .45, 1.35, -.2, M.chrome);
  box(S.mutfak, 1.82, 1.25, .1, 0, 1.6, -.62, M.steel, .03); box(S.mutfak, 1.95, .32, .72, 0, 2.38, -.35, M.steel, .06);
  const kds = paint(640, 360, (c, w, h, t = 0) => {
    c.fillStyle = '#101418'; c.fillRect(0, 0, w, h); txt(c, 'Mutfak', 24, 44, 28, '#f0eee8', 700);
    const rows = [[`Masa ${ORDER.table}`, 8 + Math.floor(t / 6) % 5, `${ORDER.qty} ${ORDER.item}`, ORDER.note, '#ff5a1f'], ['Masa 4', 15, '2 Kasap köfte', 'pilavsız', '#ff6b5e'], ['Bahçe 2', 3, '1 Mercimek çorbası', '', '#3dd68c']];
    rows.forEach(([n, m, a, b, col], i) => { const x = 20 + i * 206; c.fillStyle = '#1c2228'; c.beginPath(); c.roundRect(x, 66, 194, 270, 10); c.fill();
      c.fillStyle = col; c.fillRect(x, 66, 194, 8); txt(c, n, x + 14, 112, 26, '#f0eee8', 700); txt(c, `${m} dk`, x + 14, 146, 22, col, 600);
      txt(c, a.slice(0, 16), x + 14, 196, 19, '#d8dbde'); txt(c, a.slice(16), x + 14, 220, 19, '#d8dbde'); if (b) txt(c, b, x + 14, 252, 17, '#8d97a1'); });
  });
  screen(S.mutfak, 1.34, .75, 0, 1.68, -.565, kds);

  // Servis: ısıtma lambalı paso, tabaklar ve zil.
  box(S.servis, 1.9, .56, 1.1, 0, .6, .1, M.steel, .06); box(S.servis, 1.86, .03, 1.06, 0, .895, .1, M.dark, .01);
  for (const x of [-.85, .85]) cyl(S.servis, .045, 1.05, x, 1.4, -.25, M.chrome);
  box(S.servis, 1.92, .07, .62, 0, 1.94, -.05, M.steel, .03);
  const heat = [];
  for (const x of [-.55, 0, .55]) { cyl(S.servis, .14, .14, x, 1.83, -.05, M.dark, .2); const h = cyl(S.servis, .12, .01, x, 1.755, -.05, M.heat.clone()); heat.push(h); }
  for (const x of [-.55, 0, .55]) { cyl(S.servis, .21, .018, x, .92, .05, M.ivory, .19); for (let k = 0; k < 5; k++) ball(S.servis, .04, x + Math.cos(k * 1.3) * .07, .95, .05 + Math.sin(k * 1.3) * .07, M.food); ball(S.servis, .03, x, .965, .05, M.sauce); }
  const bell = new THREE.Mesh(new THREE.SphereGeometry(.12, 20, 10, 0, TAU, 0, Math.PI / 2), M.chrome); bell.position.set(.72, .91, .5); S.servis.add(bell);

  // Kasa: dokunmatik terminal, fiş yazıcısı ve kart okuyucu.
  box(S.kasa, 1.92, .62, 1.3, 0, .63, .02, M.body, .1); box(S.kasa, 1.2, .1, .04, -.2, .55, .68, M.dark, .01);
  box(S.kasa, .62, .1, .44, -.3, .99, -.1, M.dark, .03); cyl(S.kasa, .05, .38, -.3, 1.2, -.18, M.chrome);
  const term = new THREE.Group(); term.position.set(-.3, 1.48, -.16); term.rotation.x = -.28; S.kasa.add(term);
  box(term, 1.0, .66, .06, 0, 0, 0, M.dark, .03);
  screen(term, .92, .58, 0, 0, .032, paint(560, 352, (c, w, h) => {
    c.fillStyle = '#101418'; c.fillRect(0, 0, w, h); txt(c, `Masa ${ORDER.table}`, 26, 54, 34, '#f0eee8', 700);
    txt(c, 'Nakit', 28, 120, 24, '#8d97a1'); txt(c, tl(ORDER.cash), 370, 120, 26, '#d8dbde', 600);
    txt(c, 'Kart', 28, 162, 24, '#8d97a1'); txt(c, tl(ORDER.card), 370, 162, 26, '#d8dbde', 600);
    txt(c, `${tl(TOTAL)} TL`, 26, 248, 64, '#f0eee8', 800);
    c.fillStyle = '#3dd68c'; c.beginPath(); c.arc(40, 302, 9, 0, TAU); c.fill(); txt(c, 'Bu cihazda kaydedildi', 60, 311, 22, '#3dd68c', 600);
  }));
  box(S.kasa, .44, .3, .42, .62, 1.08, .12, M.dark, .05);
  const receipt = new THREE.Group(); receipt.position.set(.62, 1.24, .2); receipt.rotation.x = -.15; S.kasa.add(receipt); receipt.userData.moving = true;
  const rec = screen(receipt, .32, .62, 0, .31, 0, paint(220, 420, (c, w, h) => {
    c.fillStyle = '#f6f4ee'; c.fillRect(0, 0, w, h); txt(c, 'KASAM360', 20, 42, 24, '#24292e', 800); txt(c, `Masa ${ORDER.table}`, 20, 80, 20, '#4f5862');
    txt(c, `${ORDER.qty} ${ORDER.item.split(' ')[0]}…`, 20, 132, 18, '#24292e'); txt(c, tl(TOTAL), 130, 132, 18, '#24292e');
    txt(c, 'Nakit', 20, 178, 17, '#4f5862'); txt(c, tl(ORDER.cash), 130, 178, 17, '#4f5862'); txt(c, 'Kart', 20, 206, 17, '#4f5862'); txt(c, tl(ORDER.card), 130, 206, 17, '#4f5862');
    txt(c, 'Toplam', 20, 262, 22, '#24292e', 700); txt(c, tl(TOTAL), 122, 262, 22, '#24292e', 700);
    for (let i = 0; i < 36; i++) { c.fillStyle = '#24292e'; c.fillRect(20 + i * 5, 310, 1 + i % 3, 70); }
  }));
  rec.material.side = THREE.DoubleSide;
  box(S.kasa, .22, .06, .34, -.72, .97, .42, M.dark, .02); const cardLed = ball(S.kasa, .022, -.72, 1.01, .29, M.green.clone());

  // Eşitleme kutusu: internet yokken kayıtları sıraya alır.
  box(S.bulut, 1.05, .62, .72, -.1, .62, 0, M.dark, .06); cyl(S.bulut, .02, .55, .32, 1.2, -.2, M.chrome); ball(S.bulut, .04, .32, 1.48, -.2, M.chrome);
  const leds = [0, 1, 2, 3].map(i => ball(S.bulut, .035, -.5 + i * .13, .75, .365, M.signal.clone()));
  const sync = paint(400, 140, (c, w, h, online = false) => {
    c.fillStyle = '#101418'; c.fillRect(0, 0, w, h);
    txt(c, online ? 'Eşitlendi' : 'Çevrimdışı', 22, 58, 38, online ? '#3dd68c' : '#ff5a1f', 700);
    txt(c, online ? 'Bütün kayıtlar bulutta' : '2 kayıt sırada', 22, 104, 26, '#9aa3ad');
  });
  screen(S.bulut, .78, .28, -.1, .82, .365, sync).position.y = .52;

  // Bant: kapalı eğri, kayan basamaklar ve iki ray.
  const path = new THREE.CatmullRomCurve3([[-3.2, .84, .55], [-2.6, .84, -.85], [-1.4, .84, -1.25], [1.4, .84, -1.25], [2.9, .84, -.6], [3.2, .84, .35], [2.6, .84, 1.4], [1.2, .84, 1.65], [-.6, .84, 1.6], [-2.5, .84, 1.35]].map(p => new THREE.Vector3(...p)), true, 'catmullrom', .3);
  const frame = new THREE.Mesh(new THREE.TubeGeometry(path, 160, .35, 8, true), M.dark); frame.scale.y = .3; frame.position.y = .51; machine.add(frame);
  const slatCount = 140, slats = new THREE.InstancedMesh(boxGeo(.13, .065, .62, .012), M.steel, slatCount); slats.receiveShadow = true; machine.add(slats);
  const dummy = new THREE.Object3D(), pv = new THREE.Vector3(), tv = new THREE.Vector3();
  const updateBelt = t => { for (let i = 0; i < slatCount; i++) { const u = (i / slatCount + t * .012) % 1; path.getPointAt(u, pv); path.getTangentAt(u, tv);
    dummy.position.copy(pv); dummy.rotation.set(0, -Math.atan2(tv.z, tv.x), 0); dummy.updateMatrix(); slats.setMatrixAt(i, dummy.matrix); } slats.instanceMatrix.needsUpdate = true; };
  for (const side of [-1, 1]) { const pts = []; for (let i = 0; i <= 160; i++) { path.getPointAt(i / 160, pv); path.getTangentAt(i / 160, tv); pts.push(pv.clone().add(new THREE.Vector3(-tv.z * .36 * side, .09, tv.x * .36 * side))); }
    machine.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, .028, 6, false), M.chrome)); }
  const port = (x, z) => { let best = 0, d = Infinity; for (let i = 0; i < 400; i++) { const p = path.getPointAt(i / 400), e = (p.x - x) ** 2 + (p.z - z) ** 2; if (e < d) { d = e; best = i / 400; } } return best; };
  const ports = stations.map(s => port(s.port[0], s.port[1]));

  // Bantta giden sipariş: her istasyondan sonra yüzü değişir.
  const faces = [
    paint(240, 340, (c, w, h) => { c.fillStyle = '#ff5a1f'; c.fillRect(0, 0, w, h); txt(c, `Masa ${ORDER.table}`, 20, 64, 40, '#14171a', 800); txt(c, `${ORDER.qty} ${ORDER.item.split(' ')[0]}`, 20, 140, 26, '#14171a', 600); txt(c, ORDER.item.split(' ').slice(1).join(' '), 20, 172, 26, '#14171a', 600); txt(c, ORDER.note, 20, 220, 22, '#4a1a06'); }),
    paint(240, 340, (c, w, h) => { c.fillStyle = '#f1efe8'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffffff'; c.beginPath(); c.arc(120, 150, 92, 0, TAU); c.fill(); c.strokeStyle = '#d6d2c8'; c.lineWidth = 4; c.stroke();
      c.fillStyle = '#e6cf9c'; for (let k = 0; k < 9; k++) { c.beginPath(); c.arc(120 + Math.cos(k * .8) * (k % 3) * 22, 150 + Math.sin(k * .8) * (k % 3) * 22, 15, 0, TAU); c.fill(); } c.fillStyle = '#c0461f'; c.beginPath(); c.arc(120, 150, 10, 0, TAU); c.fill(); txt(c, 'Hazır', 20, 300, 30, '#14171a', 700); }),
    paint(240, 340, (c, w, h) => { c.fillStyle = '#14181d'; c.fillRect(0, 0, w, h); txt(c, 'Hesap', 20, 56, 30, '#9aa3ad', 600); txt(c, tl(TOTAL), 20, 140, 46, '#f0eee8', 800); txt(c, 'TL', 20, 182, 26, '#9aa3ad'); txt(c, `Nakit ${tl(ORDER.cash)}`, 20, 250, 20, '#d8dbde'); txt(c, `Kart ${tl(ORDER.card)}`, 20, 282, 20, '#d8dbde'); }),
    paint(240, 340, (c, w, h) => { c.fillStyle = '#f6f4ee'; c.fillRect(0, 0, w, h); txt(c, 'Kayıt', 20, 60, 34, '#14171a', 800); txt(c, `Masa ${ORDER.table}`, 20, 104, 24, '#4f5862'); for (let i = 0; i < 6; i++) { c.fillStyle = '#c9ccc8'; c.fillRect(20, 140 + i * 22, 180 - i % 3 * 30, 6); } txt(c, 'Sırada', 20, 310, 28, '#c4410e', 700); }),
  ];
  const packets = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group(); machine.add(g);
    box(g, .47, .7, .04, 0, 0, 0, M.ivory, .02);
    const f = faces.map(t => { const s = screen(g, .43, .62, 0, 0, .024, t); s.material.side = THREE.DoubleSide; s.visible = false; return s; });
    const halo = new THREE.Mesh(new THREE.RingGeometry(.42, .44, 40), new THREE.MeshBasicMaterial({ color: 0xff5a1f, side: THREE.DoubleSide, transparent: true, opacity: .9 }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = -.37; halo.visible = false; g.add(halo);
    packets.push({ g, f, halo, stage: -1 });
  }

  // Tema: aynı sahne, gündüz alüminyum ya da gece grafit.
  const themes = {
    light: { base: 0xaeb5bc, body: 0xc9cfd5, steel: 0xd9dee2, edge: 0x8f98a2, exposure: 1.02, hemi: 2.4, shadow: .16, warm: 10 },
    dark: { base: 0x262b32, body: 0x30363e, steel: 0x8e979f, edge: 0x6c7581, exposure: 1.12, hemi: 1.6, shadow: .3, warm: 26 },
  };
  function applyTheme() {
    const forced = document.documentElement.dataset.theme;
    const dark = forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const t = themes[dark ? 'dark' : 'light'];
    M.base.color.setHex(t.base); M.body.color.setHex(t.body); M.steel.color.setHex(t.steel); M.edge.color.setHex(t.edge);
    renderer.toneMappingExposure = t.exposure; hemi.intensity = t.hemi; floor.material.opacity = t.shadow; warm.intensity = t.warm;
    scene.environmentIntensity = dark ? .6 : .9;
  }
  applyTheme();
  const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', applyTheme);

  // Kamera: geniş ekranda makine sağda durur, başlık solda kalır.
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: .065, enablePan: false, enableZoom: false, minPolarAngle: .2, maxPolarAngle: Math.PI * .46, rotateSpeed: .45 });
  if (matchMedia('(pointer: coarse)').matches) controls.enableRotate = false;
  const viewDir = new THREE.Vector3(10.5, 10.8, 17).normalize();
  const goalPos = new THREE.Vector3(), goalTarget = new THREE.Vector3(0, 1, 0);
  let base = 25, focus = null, follow = false, moving = true, lastTouch = performance.now();
  function layout() {
    const w = W(), h = H(); if (!w || !h) return;
    const wideFrame = w > 900;
    renderer.setSize(w, h); camera.aspect = w / h;
    camera.setViewOffset(w, h, wideFrame ? -w * .2 : 0, wideFrame ? h * .06 : 0, w, h);
    const fov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 2;
    base = Math.max(11.6 / (fov * camera.aspect * (wideFrame ? .56 : .96)), 8.4 / (fov * .86));
    camera.updateProjectionMatrix(); goal(); moving = true;
  }
  function goal() {
    if (focus) { const s = stations.find(x => x.id === focus); goalTarget.copy(s.group.position).add(new THREE.Vector3(0, 1.1, 0)); goalPos.copy(goalTarget).addScaledVector(viewDir, 8.5); }
    else { goalTarget.set(0, .9, 0); goalPos.copy(viewDir).multiplyScalar(base).add(goalTarget); }
  }
  layout(); camera.position.copy(goalPos); controls.target.copy(goalTarget); controls.update(); moving = false;
  const ro = new ResizeObserver(layout); ro.observe(host);
  controls.addEventListener('start', () => { moving = false; lastTouch = performance.now(); });

  const api = {
    focusStation(id) { focus = id; follow = false; goal(); moving = true; lastTouch = performance.now(); },
    overview() { focus = null; follow = false; goal(); moving = true; },
    followOrder() { follow = true; focus = null; simStart = sim; prevStage = -1; moving = true; },
  };
  // Fareyle gelinen istasyon parlar; tıklanınca kamera oraya gider.
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let hovered = null;
  const pick = e => { const r = renderer.domElement.getBoundingClientRect(); ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(stations.map(s => s.group), true)[0]; return hit ? hit.object.userData.station : null; };
  renderer.domElement.addEventListener('pointermove', e => { hovered = pick(e); renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab'; });
  renderer.domElement.addEventListener('click', e => { const id = pick(e); if (id) { api.focusStation(id); onStage?.(STATIONS.findIndex(s => s.id === id), false); } });

  let sim = reduce ? 9.5 : 0, simStart = 0, last = performance.now(), prevStage = -1, ready = false;
  function frameLoop(now) {
    raf = requestAnimationFrame(frameLoop);
    const dt = Math.min((now - last) / 1000, .05); last = now;
    if (!reduce) sim += dt;
    const t = sim;
    flames.forEach((f, i) => (f.material.emissiveIntensity = 2 + Math.sin(t * 9 + i * 2) * .5 + Math.sin(t * 23 + i) * .3));
    heat.forEach((h, i) => (h.material.emissiveIntensity = 1.8 + Math.sin(t * 2 + i) * .2));
    pan.position.y = 1.07 + Math.max(0, Math.sin(t * 2.4)) ** 6 * .12; pan.rotation.z = Math.max(0, Math.sin(t * 2.4)) ** 6 * .15;
    const online = (t % 20) > 13;
    leds.forEach((l, i) => { l.material.color.setHex(online ? 0x3dd68c : 0xff5a1f); l.material.emissive.setHex(online ? 0x3dd68c : 0xff5a1f); l.material.emissiveIntensity = online ? 1.2 : .6 + (Math.sin(t * 4 - i) > 0 ? 1 : 0); });
    if (Math.floor(t * 4) !== Math.floor((t - dt) * 4) || prevStage === -1) { kds.redraw(t); sync.redraw(online); updateBelt(t); }
    cardLed.material.emissiveIntensity = Math.sin(t * 5) > 0 ? 1.6 : .3;
    const recBeat = (t / 6) % 1; receipt.scale.y = .25 + Math.min(1, recBeat * 1.4) * .75;
    stations.forEach(s => (s.glow.emissiveIntensity = THREE.MathUtils.lerp(s.glow.emissiveIntensity, s.id === hovered || s.id === focus ? 3 : .45, .12)));
    packets.forEach((p, i) => {
      const u = ((follow && i === 0 ? (t - simStart) / 30 : t / 30 + i / 5) + ports[0]) % 1;
      path.getPointAt(u, p.g.position); p.g.position.y += .43; p.g.rotation.set(0, .35, 0);
      const rel = (u - ports[0] + 1) % 1; let stage = 0;
      ports.forEach((pu, k) => { if (k && rel >= (pu - ports[0] + 1) % 1) stage = k; });
      if (stage !== p.stage) { p.f.forEach((m, k) => (m.visible = k === Math.min(stage, 3))); p.stage = stage; }
      const vis = stage < 4; p.g.scale.setScalar(vis ? (follow && i === 0 ? 1.4 : 1) : .001);
      p.g.visible = !follow || i === 0; p.halo.visible = follow && i === 0;
    });
    if (follow) { const p = packets[0]; if (p.stage !== prevStage) { prevStage = p.stage; onStage?.(p.stage, true); }
      goalTarget.copy(p.g.position); goalPos.copy(goalTarget).addScaledVector(viewDir, 12.5); moving = true; }
    else if (prevStage === -1) prevStage = 0;
    if (moving) { const k = 1 - Math.exp(-dt * 2.6); camera.position.lerp(goalPos, k); controls.target.lerp(goalTarget, k); if (!follow && camera.position.distanceTo(goalPos) < .02) moving = false; }
    controls.autoRotate = !reduce && !follow && !focus && !moving && now - lastTouch > 7000; controls.autoRotateSpeed = .22;
    controls.update(dt); renderer.render(scene, camera);
    if (!ready) { ready = true; onReady?.(); }
  }
  let raf = requestAnimationFrame(frameLoop);
  api.dispose = () => { cancelAnimationFrame(raf); ro.disconnect(); mq.removeEventListener('change', applyTheme); controls.dispose(); renderer.dispose(); env.dispose(); pmrem.dispose(); renderer.domElement.remove(); };
  api.applyTheme = applyTheme;
  return api;
}
