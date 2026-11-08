// Restoran makinesinin yapı kiti: malzemeler, parça yardımcıları ve tema paletleri.
// Bütün geometri ve doku kodla üretilir; dış model veya görsel indirilmez, sayfa ağırlığı yalnız kod kadar olur.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const TAU = Math.PI * 2;

type ThemedKey = 'body' | 'base' | 'edge' | 'dark' | 'ivory';
export type Palette = Record<ThemedKey, number> & {
  hemiSky: number; hemiGround: number; hemi: number; exposure: number; env: number;
  floor: number; contact: number; draft: number; draftOpacity: number;
};

// Açık tema paslanmaz mutfak çeliği, koyu tema gece servisi. Ekran dokuları iki temada da ekrandır.
export const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: { body: 0x30363f, base: 0x292f37, edge: 0x707986, dark: 0x12171d, ivory: 0xe0ded4, hemiSky: 0xdbe5f4, hemiGround: 0x29211a,
    hemi: 2, exposure: 1.12, env: 0.62, floor: 0.23, contact: 0.65, draft: 0x69717a, draftOpacity: 0.12 },
  light: { body: 0xb7bec6, base: 0x9aa2ab, edge: 0xdfe3e7, dark: 0x2a3038, ivory: 0xf4f4f1, hemiSky: 0xffffff, hemiGround: 0x8d96a0,
    hemi: 2.3, exposure: 1.0, env: 0.85, floor: 0.12, contact: 0.32, draft: 0x7d8690, draftOpacity: 0.18 },
};

export type Painted = { texture: THREE.CanvasTexture; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
type Mat = THREE.MeshStandardMaterial;

export function createKit(renderer: THREE.WebGLRenderer, fontFamily: string) {
  const themed: Array<[Mat, ThemedKey]> = [];
  const mat = (color: number, metalness = 0.1, roughness = 0.4, extra: THREE.MeshStandardMaterialParameters = {}): Mat =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  const M = {
    body: mat(0x30363f, 0.75, 0.29), base: mat(0x292f37, 0.85, 0.32), edge: mat(0x707986, 0.85, 0.24),
    chrome: mat(0xc3cad0, 0.92, 0.18), dark: mat(0x12171d, 0.45, 0.38), rubber: mat(0x0b1015, 0.1, 0.6),
    amber: mat(0x4c6ef5, 0.5, 0.3), ivory: mat(0xe0ded4, 0.48, 0.26), copper: mat(0xc57e45, 0.85, 0.3),
    wood: mat(0x8a5a36, 0.1, 0.62),
    light: mat(0x4c6ef5, 0.2, 0.25, { emissive: 0x4c6ef5, emissiveIntensity: 1.5 }),
    green: mat(0x9fe0b4, 0.1, 0.3, { emissive: 0x3fbf6f, emissiveIntensity: 0.9 }),
    flame: mat(0x6fb4ff, 0.1, 0.3, { emissive: 0x3f8cff, emissiveIntensity: 1.6 }),
    steam: mat(0xffffff, 0, 0.9, { transparent: true, opacity: 0.35, depthWrite: false }),
  };
  (['body', 'base', 'edge', 'dark', 'ivory'] as const).forEach((k) => themed.push([M[k], k]));

  const geometries = new Map<string, THREE.BufferGeometry>();
  function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    const found = geometries.get(key);
    if (found) return found;
    const g = make();
    geometries.set(key, g);
    return g;
  }
  const boxGeo = (w: number, h: number, d: number, r = 0.04) =>
    cached(`b${w},${h},${d},${r}`, () => (r ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 3, h / 3, d / 3)) : new THREE.BoxGeometry(w, h, d)));
  function place<T extends THREE.Mesh>(p: THREE.Object3D, o: T, x: number, y: number, z: number): T {
    o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; p.add(o); return o;
  }
  const box = (p: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material = M.body, r = 0.04) =>
    place(p, new THREE.Mesh(boxGeo(w, h, d, r), m), x, y, z);
  const cyl = (p: THREE.Object3D, r: number, h: number, x: number, y: number, z: number, m: THREE.Material = M.chrome, r2 = r, seg = 24) =>
    place(p, new THREE.Mesh(cached(`c${r},${r2},${h},${seg}`, () => new THREE.CylinderGeometry(r, r2, h, seg)), m), x, y, z);
  function ball(p: THREE.Object3D, r: number, x: number, y: number, z: number, m: THREE.Material = M.chrome) {
    const o = new THREE.Mesh(cached(`s${r}`, () => new THREE.SphereGeometry(r, 12, 8)), m);
    o.position.set(x, y, z); p.add(o); return o;
  }
  function tube(p: THREE.Object3D, pts: Array<[number, number, number]>, r: number, m: THREE.Material = M.chrome) {
    const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)));
    const o = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, pts.length * 7), r, 8, false), m);
    o.castShadow = true; p.add(o); return o;
  }
  function screw(p: THREE.Object3D, x: number, y: number, z: number) {
    cyl(p, 0.055, 0.026, x, y, z, M.chrome, 0.055, 12); box(p, 0.068, 0.005, 0.009, x, y + 0.014, z, M.dark, 0);
  }
  function canvasTexture(w: number, h: number, draw: Draw): Painted {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Tuval bağlamı alınamadı');
    draw(ctx, w, h);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return { texture, canvas, ctx };
  }
  function print(ctx: CanvasRenderingContext2D, txt: string, x: number, y: number, size = 20, color = '#f2f2ef', weight = 500, align: CanvasTextAlign = 'left') {
    ctx.fillStyle = color; ctx.textAlign = align; ctx.font = `${weight} ${size}px ${fontFamily}`; ctx.fillText(txt, x, y); ctx.textAlign = 'left';
  }
  function screen(p: THREE.Object3D, w: number, h: number, x: number, y: number, z: number, tex: Painted | THREE.Texture) {
    const map = tex instanceof THREE.Texture ? tex : tex.texture;
    const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map, toneMapped: false }));
    o.position.set(x, y, z); p.add(o); return o;
  }
  // Kesit modunda gövdeler bu düzlemle kesilir; içteki dişliler ve hatlar görünür.
  const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10);
  function shell(m: Mat): Mat {
    const s = m.clone(); s.clippingPlanes = [cutPlane]; s.clipShadows = true; s.side = THREE.DoubleSide;
    const key = themed.find(([x]) => x === m); if (key) themed.push([s, key[1]]);
    return s;
  }
  const S = { body: shell(M.body), ivory: shell(M.ivory), amber: shell(M.amber), edge: shell(M.edge) };
  const gears: THREE.Group[] = [];
  function gear(p: THREE.Object3D, x: number, y: number, z: number, r = 0.3) {
    const g = new THREE.Group(); g.position.set(x, y, z); p.add(g);
    cyl(g, r, 0.09, 0, 0, 0, M.copper); cyl(g, r * 0.66, 0.105, 0, 0, 0, M.dark); cyl(g, r * 0.22, 0.14, 0, 0, 0, M.chrome);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      box(g, r * 0.26, 0.085, r * 0.2, Math.cos(a) * r, 0, Math.sin(a) * r, M.copper, 0.008).rotation.y = -a;
    }
    g.userData.moving = true; gears.push(g); return g;
  }
  function applyPalette(p: Palette) { for (const [m, k] of themed) m.color.setHex(p[k]); }
  return { M, S, box, boxGeo, cyl, ball, tube, screw, canvasTexture, print, screen, gear, gears, geometries, cutPlane, applyPalette };
}

export type Kit = ReturnType<typeof createKit>;
