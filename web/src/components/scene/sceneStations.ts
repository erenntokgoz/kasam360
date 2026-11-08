// İstasyon gövdeleri. Her blok kendi grubunun yerel koordinatında çizer; zemin plakasının üstü y ≈ 0.3.
// Hareketli parçalar "moving" işaretlenir ki durağan geometri birleştirilirken animasyonları kaybolmasın.
import * as THREE from 'three';
import type { Kit } from './sceneKit';
import type { SceneTextures } from './sceneTextures';

export type StationId = 'salon' | 'mutfak' | 'depo' | 'kasa' | 'bulut';
export type MovingParts = {
  card: THREE.Group; flames: THREE.Mesh[]; lid: THREE.Group; steam: THREE.Mesh[]; lot: THREE.Group;
  drawer: THREE.Group; receipt: THREE.Group; coin: THREE.Group; syncMat: THREE.MeshStandardMaterial; rings: THREE.Mesh[];
};

const moving = <T extends THREE.Object3D>(o: T): T => { o.userData.moving = true; return o; };

export function buildStationBodies(kit: Kit, T: SceneTextures, groups: Record<StationId, THREE.Group>): MovingParts {
  const { M, S, box, cyl, ball, screen, tube } = kit;

  // 01 Salon: masa, dört sandalye, salon terminali; masadan adisyon kalkar.
  const salon = groups.salon;
  cyl(salon, 0.28, 0.04, 0.2, 0.33, -0.1, M.dark); cyl(salon, 0.055, 0.56, 0.2, 0.63, -0.1, M.chrome);
  cyl(salon, 0.5, 0.06, 0.2, 0.94, -0.1, S.ivory, 0.5, 40);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2, ch = new THREE.Group();
    ch.position.set(0.2 + Math.cos(a) * 0.66, 0, -0.1 + Math.sin(a) * 0.66); ch.rotation.y = Math.atan2(Math.cos(a), Math.sin(a)); salon.add(ch);
    cyl(ch, 0.03, 0.26, 0, 0.45, 0, M.chrome); box(ch, 0.32, 0.05, 0.32, 0, 0.6, 0, S.body, 0.02); box(ch, 0.32, 0.36, 0.045, 0, 0.82, 0.15, S.body, 0.02);
    cyl(salon, 0.11, 0.015, 0.2 + Math.cos(a) * 0.3, 0.98, -0.1 + Math.sin(a) * 0.3, M.chrome);
    ball(salon, 0.045, 0.2 + Math.cos(a) * 0.3, 1.01, -0.1 + Math.sin(a) * 0.3, M.copper);
  }
  cyl(salon, 0.045, 1.0, -0.62, 0.95, -0.62, M.chrome);
  box(salon, 0.98, 0.66, 0.06, -0.62, 1.62, -0.6, S.body, 0.04);
  screen(salon, 0.92, 0.6, -0.62, 1.62, -0.565, T.salon);
  const card = moving(new THREE.Group()); salon.add(card);
  box(card, 0.4, 0.56, 0.03, 0, 0, 0, M.ivory, 0.02); screen(card, 0.38, 0.53, 0, 0, 0.017, T.order);

  // 02 Mutfak: ocak, tencereler, buhar, davlumbaz ve mutfak ekranı.
  const mutfak = groups.mutfak;
  box(mutfak, 1.74, 0.62, 1.33, 0, 0.65, -0.05, S.ivory, 0.13);
  box(mutfak, 1.5, 0.06, 1.16, 0, 0.99, -0.04, M.dark, 0.025);
  box(mutfak, 1.2, 0.34, 0.04, 0, 0.62, 0.63, M.dark, 0.02); box(mutfak, 0.9, 0.04, 0.05, 0, 0.83, 0.67, M.chrome, 0.01);
  for (let i = 0; i < 4; i++) cyl(mutfak, 0.05, 0.05, -0.5 + i * 0.33, 0.92, 0.62, M.chrome).rotation.x = Math.PI / 2;
  const flames: THREE.Mesh[] = [];
  for (const [x, z, on] of [[-0.42, -0.3, 1], [0.38, -0.3, 1], [-0.42, 0.25, 0], [0.38, 0.25, 1]] as const) {
    cyl(mutfak, 0.17, 0.02, x, 1.03, z, M.edge);
    if (!on) continue;
    const f = moving(new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 6, 24), M.flame));
    f.rotation.x = Math.PI / 2; f.position.set(x, 1.05, z); mutfak.add(f); flames.push(f);
  }
  cyl(mutfak, 0.22, 0.32, -0.42, 1.21, -0.3, M.chrome, 0.2);
  const lid = moving(new THREE.Group()); lid.position.set(-0.42, 1.38, -0.3); mutfak.add(lid);
  cyl(lid, 0.23, 0.03, 0, 0, 0, M.copper); ball(lid, 0.035, 0, 0.03, 0, M.dark);
  cyl(mutfak, 0.18, 0.42, 0.38, 1.26, -0.3, M.chrome, 0.17); cyl(mutfak, 0.19, 0.03, 0.38, 1.48, -0.3, M.copper);
  cyl(mutfak, 0.26, 0.07, 0.38, 1.08, 0.25, M.dark, 0.23); box(mutfak, 0.4, 0.03, 0.05, 0.82, 1.1, 0.25, M.dark, 0.01);
  for (const x of [-0.74, 0.74]) cyl(mutfak, 0.045, 1.55, x, 1.75, -0.6, M.chrome);
  box(mutfak, 1.86, 0.3, 0.64, 0, 2.62, -0.36, S.amber, 0.05);
  box(mutfak, 1.12, 0.66, 0.05, 0, 1.86, -0.64, M.dark, 0.03); screen(mutfak, 1.06, 0.62, 0, 1.86, -0.612, T.kds);
  const steam = Array.from({ length: 10 }, (_, i) => { const s = moving(ball(mutfak, 0.07, -0.42, 1.5, -0.3, M.steam)); s.userData.seed = i / 10; return s; });

  // 03 Depo: raf ve sandıklar; en eski parti (Lot A) önce dışarı kayar.
  const depo = groups.depo;
  for (const x of [-0.8, 0.8]) for (const z of [-0.45, 0.45]) cyl(depo, 0.035, 1.9, x, 1.25, z, M.chrome);
  for (const y of [0.62, 1.24, 1.86]) box(depo, 1.68, 0.04, 1.0, 0, y, 0, M.edge, 0.01);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 3; i++) {
    if (row === 0 && i === 0) continue;
    const y = [0.62, 1.24, 1.86][row] + 0.17;
    box(depo, 0.44, 0.3, 0.78, -0.52 + i * 0.52, y, 0, row === 0 ? M.wood : row === 1 ? S.ivory : M.copper, 0.03);
    if (row === 0) screen(depo, 0.3, 0.15, -0.52 + i * 0.52, y, 0.395, T.lot[i]);
  }
  const lot = moving(new THREE.Group()); lot.position.set(-0.52, 0.79, 0); depo.add(lot);
  box(lot, 0.44, 0.3, 0.78, 0, 0, 0, M.wood, 0.03); screen(lot, 0.3, 0.15, 0, 0, 0.395, T.lot[0]);

  // 04 Kasa: tezgâh, ekran, tuş takımı, çekmece, fiş ve düşen lira.
  const kasa = groups.kasa;
  box(kasa, 1.91, 0.63, 1.32, 0, 0.65, -0.06, S.ivory, 0.12); box(kasa, 1.96, 0.19, 1.38, 0, 0.42, -0.04, S.body, 0.04);
  const drawer = moving(new THREE.Group()); drawer.position.set(0, 0.6, 0.12); kasa.add(drawer);
  box(drawer, 1.2, 0.14, 0.9, 0, 0, 0, M.dark, 0.02); box(drawer, 1.3, 0.18, 0.04, 0, 0, 0.48, M.body, 0.02); box(drawer, 0.37, 0.04, 0.03, 0, 0, 0.51, M.chrome, 0.009);
  for (let i = 0; i < 4; i++) box(drawer, 0.22, 0.04, 0.3, -0.42 + i * 0.28, 0.06, 0.1, i % 2 ? M.green : M.copper, 0.01);
  box(kasa, 1.02, 0.25, 0.91, -0.33, 1.04, -0.03, S.body, 0.045);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) box(kasa, 0.19, 0.085, 0.17, -0.62 + c * 0.27, 1.21, 0.27 - r * 0.24, c === 2 && r === 2 ? M.amber : M.ivory, 0.022);
  box(kasa, 0.64, 0.6, 0.52, 0.58, 1.04, -0.15, S.body, 0.045); box(kasa, 0.48, 0.07, 0.09, 0.59, 1.37, -0.1, M.dark, 0.01);
  cyl(kasa, 0.06, 0.65, -0.35, 1.6, -0.56, M.chrome); box(kasa, 1.13, 0.46, 0.19, -0.35, 1.98, -0.56, S.body, 0.045);
  screen(kasa, 1.015, 0.349, -0.35, 1.98, -0.459, T.till);
  const receipt = moving(new THREE.Group()); receipt.position.set(0.59, 1.37, -0.1); receipt.rotation.x = -0.16; kasa.add(receipt);
  const paper = screen(receipt, 0.41, 0.83, 0, 0.415, 0.01, T.receipt); (paper.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
  const coin = moving(new THREE.Group()); kasa.add(coin);
  cyl(coin, 0.22, 0.065, 0, 0, 0, M.amber, 0.22, 32).rotation.x = Math.PI / 2;
  const lira = screen(coin, 0.28, 0.28, 0, 0, 0.04, T.coin); (lira.material as THREE.MeshBasicMaterial).transparent = true;
  cyl(kasa, 0.33, 0.09, 1.04, 0.39, 0.55, M.dark); cyl(kasa, 0.26, 0.025, 1.04, 0.445, 0.55, M.copper);

  // 05 Bulut: sunucu gövdesi ve anten halkaları; çevrimdışıyken turuncu, eşitlenince yeşil.
  const bulut = groups.bulut;
  const syncMat = M.light.clone();
  box(bulut, 1.5, 0.42, 1.0, 0, 0.55, -0.05, S.body, 0.08);
  for (let i = 0; i < 3; i++) { box(bulut, 1.36, 0.08, 0.04, 0, 0.44 + i * 0.11, 0.46, M.dark, 0.01); box(bulut, 0.5, 0.018, 0.012, -0.36, 0.44 + i * 0.11, 0.485, syncMat, 0.002); }
  box(bulut, 0.94, 0.44, 0.08, -0.22, 1.05, -0.25, S.body, 0.04); screen(bulut, 0.88, 0.344, -0.22, 1.05, -0.205, T.sync);
  cyl(bulut, 0.04, 1.3, 0.5, 1.4, -0.3, M.chrome); ball(bulut, 0.06, 0.5, 2.08, -0.3, syncMat);
  const rings = [0.16, 0.25, 0.34].map((r, i) => {
    const ring = moving(new THREE.Mesh(new THREE.TorusGeometry(r, 0.014, 6, 40), syncMat));
    ring.position.set(0.5, 1.45 + i * 0.22, -0.3); ring.rotation.x = Math.PI / 2; bulut.add(ring); return ring;
  });
  tube(bulut, [[0.5, 0.75, -0.3], [0.5, 0.62, 0.1], [0.2, 0.6, 0.3]], 0.02, M.dark);

  return { card, flames, lid, steam, lot, drawer, receipt, coin, syncMat, rings };
}
