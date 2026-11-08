// Restoran makinesinin yapı kiti: malzemeler, parça yardımcıları ve tema paletleri.
// Bütün geometri ve doku kodla üretilir; dış model veya görsel yüklenmez.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const TAU = Math.PI * 2;

// Açık tema "paslanmaz mutfak çeliği", koyu tema "gece servisi". Ekranlar iki temada da ekrandır.
export const PALETTES = {
  dark: { body: 0x30363f, base: 0x292f37, edge: 0x707986, dark: 0x12171d, ivory: 0xe0ded4, hemiSky: 0xdbe5f4, hemiGround: 0x29211a,
    hemi: 2, exposure: 1.12, env: 0.62, floor: 0.23, contact: 0.65, draft: 0x69717a, draftOpacity: 0.12 },
  light: { body: 0xb7bec6, base: 0x9aa2ab, edge: 0xdfe3e7, dark: 0x2a3038, ivory: 0xf4f4f1, hemiSky: 0xffffff, hemiGround: 0x8d96a0,
    hemi: 2.3, exposure: 1.0, env: 0.85, floor: 0.12, contact: 0.32, draft: 0x7d8690, draftOpacity: 0.18 },
};

export function createKit(renderer, fontFamily) {
  const themed = []; // [malzeme, paletteki anahtar]
  const mat = (color, metalness = 0.1, roughness = 0.4, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  const M = {
    body: mat(0x30363f, 0.75, 0.29), base: mat(0x292f37, 0.85, 0.32), edge: mat(0x707986, 0.85, 0.24),
    chrome: mat(0xc3cad0, 0.92, 0.18), dark: mat(0x12171d, 0.45, 0.38), rubber: mat(0x0b1015, 0.1, 0.6),
    amber: mat(0xff5a1f, 0.5, 0.3), ivory: mat(0xe0ded4, 0.48, 0.26), copper: mat(0xc57e45, 0.85, 0.3),
    wood: mat(0x8a5a36, 0.1, 0.62),
    light: mat(0xff5a1f, 0.2, 0.25, { emissive: 0xff5a1f, emissiveIntensity: 1.5 }),
    green: mat(0x9fe0b4, 0.1, 0.3, { emissive: 0x3fbf6f, emissiveIntensity: 0.9 }),
    flame: mat(0x6fb4ff, 0.1, 0.3, { emissive: 0x3f8cff, emissiveIntensity: 1.6 }),
    steam: mat(0xffffff, 0, 0.9, { transparent: true, opacity: 0.35, depthWrite: false }),
  };
  for (const k of ['body', 'base', 'edge', 'dark', 'ivory']) themed.push([M[k], k]);

  const geometries = new Map();
  function boxGeo(w, h, d, r = 0.04) {
    const k = `b${w},${h},${d},${r}`;
    if (!geometries.has(k)) geometries.set(k, r ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 3, h / 3, d / 3)) : new THREE.BoxGeometry(w, h, d));
    return geometries.get(k);
  }
  function place(parent, o, x, y, z) { o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; }
  const box = (p, w, h, d, x, y, z, m = M.body, r = 0.04) => place(p, new THREE.Mesh(boxGeo(w, h, d, r), m), x, y, z);
  function cyl(p, r, h, x, y, z, m = M.chrome, r2 = r, seg = 24) {
    const k = `c${r},${r2},${h},${seg}`;
    if (!geometries.has(k)) geometries.set(k, new THREE.CylinderGeometry(r, r2, h, seg));
    return place(p, new THREE.Mesh(geometries.get(k), m), x, y, z);
  }
  function ball(p, r, x, y, z, m = M.chrome) {
    const k = `s${r}`;
    if (!geometries.has(k)) geometries.set(k, new THREE.SphereGeometry(r, 12, 8));
    const o = new THREE.Mesh(geometries.get(k), m); o.position.set(x, y, z); p.add(o); return o;
  }
  function tube(p, pts, r, m = M.chrome) {
    const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)));
    const o = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, pts.length * 7), r, 8, false), m);
    o.castShadow = true; p.add(o); return o;
  }
  function screw(p, x, y, z) { cyl(p, 0.055, 0.026, x, y, z, M.chrome, undefined, 12); box(p, 0.068, 0.005, 0.009, x, y + 0.014, z, M.dark, 0); }
  function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); draw(ctx, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return { texture: t, canvas: c, ctx };
  }
  function print(ctx, txt, x, y, size = 20, color = '#f2f2ef', weight = 500, align = 'left') {
    ctx.fillStyle = color; ctx.textAlign = align; ctx.font = `${weight} ${size}px ${fontFamily}`; ctx.fillText(txt, x, y); ctx.textAlign = 'left';
  }
  function screen(p, w, h, x, y, z, tex) {
    const map = tex.texture || tex;
    const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map, toneMapped: false }));
    o.position.set(x, y, z); p.add(o); return o;
  }
  // Kesit modunda gövdeler kesilir; içteki dişliler ve hatlar görünür.
  const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10);
  function shell(m) {
    const s = m.clone(); s.clippingPlanes = [cutPlane]; s.clipShadows = true; s.side = THREE.DoubleSide;
    const key = themed.find(([x]) => x === m); if (key) themed.push([s, key[1]]);
    return s;
  }
  const S = { body: shell(M.body), ivory: shell(M.ivory), amber: shell(M.amber), edge: shell(M.edge) };
  const gears = [];
  function gear(p, x, y, z, r = 0.3) {
    const g = new THREE.Group(); g.position.set(x, y, z); p.add(g);
    cyl(g, r, 0.09, 0, 0, 0, M.copper); cyl(g, r * 0.66, 0.105, 0, 0, 0, M.dark); cyl(g, r * 0.22, 0.14, 0, 0, 0, M.chrome);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      box(g, r * 0.26, 0.085, r * 0.2, Math.cos(a) * r, 0, Math.sin(a) * r, M.copper, 0.008).rotation.y = -a;
    }
    g.userData.moving = true; gears.push(g); return g;
  }
  function applyPalette(p) { for (const [m, k] of themed) m.color.setHex(p[k]); }
  return { THREE, M, S, box, boxGeo, cyl, ball, tube, screw, canvasTexture, print, screen, gear, gears, geometries, cutPlane, applyPalette };
}
