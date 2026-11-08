// Beş istasyon ve ekran dokuları. Sahnedeki tutarlar tek fixture'dan gelir:
// 4 × 125,00 = 500,00 TL; nakit 200,00 + kart 300,00; FIFO maliyet 2×2,00 + 2×5,00 = 14,00 TL.
import { TAU } from './scene-kit.js';

const tl = (c) => (c / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
export const FIX = { qty: 4, unit: 12500, cash: 20000, card: 30000, lotA: [2, 200], lotB: [2, 500] };
FIX.total = FIX.qty * FIX.unit;
FIX.cost = FIX.lotA[0] * FIX.lotA[1] + FIX.lotB[0] * FIX.lotB[1];
if (FIX.cash + FIX.card !== FIX.total) throw new Error('Sahne toplamı tutmuyor');

export function buildTextures(kit) {
  const { canvasTexture: tex, print } = kit;
  const dash = (c, y, x1, x2, color) => { c.strokeStyle = color; c.setLineDash([5, 6]); c.beginPath(); c.moveTo(x1, y); c.lineTo(x2, y); c.stroke(); c.setLineDash([]); };
  const T = {};
  T.salon = tex(640, 420, (c) => {
    c.fillStyle = '#10181b'; c.fillRect(0, 0, 640, 420);
    print(c, 'SALON', 26, 46, 22, '#a9b6b6', 600); print(c, '14:21', 614, 46, 20, '#ff5a1f', 500, 'right');
    for (let i = 0; i < 12; i++) {
      const x = 26 + (i % 4) * 150, y = 70 + Math.floor(i / 4) * 112, no = i + 1, busy = [2, 4, 7, 9, 12].includes(no);
      c.fillStyle = no === 12 ? '#ff5a1f' : busy ? '#24363a' : '#172225';
      c.beginPath(); c.roundRect(x, y, 136, 96, 10); c.fill();
      print(c, String(no), x + 16, y + 52, 38, no === 12 ? '#14171c' : busy ? '#e6ebe6' : '#55666a', 650);
      if (busy) print(c, no === 12 ? '4 kişi · 19 dk' : 'açık', x + 16, y + 80, 16, no === 12 ? '#3b1a08' : '#8fa39d');
    }
  });
  T.order = tex(256, 352, (c) => {
    c.fillStyle = '#f4f4f1'; c.fillRect(0, 0, 256, 352);
    print(c, 'ADİSYON', 22, 40, 16, '#7a7f78', 600); print(c, '14.02', 234, 40, 16, '#7a7f78', 500, 'right');
    print(c, 'Masa 12', 22, 92, 40, '#14171c', 700);
    dash(c, 116, 22, 234, '#9aa09a');
    print(c, `${FIX.qty} × Ev usulü mantı`, 22, 154, 19, '#14171c', 600); print(c, 'biri acısız', 22, 182, 17, '#6b716b');
    dash(c, 214, 22, 234, '#9aa09a');
    print(c, 'Mutfağa gidecek', 22, 318, 16, '#b23f0c', 600);
  });
  T.kds = tex(512, 320, () => {});
  T.drawKds = (t) => {
    const c = T.kds.ctx, s = 412 + Math.floor(t);
    c.fillStyle = '#0f1719'; c.fillRect(0, 0, 512, 320);
    print(c, 'MUTFAK', 24, 40, 20, '#9fb0ae', 600); print(c, '3 sipariş', 488, 40, 18, '#71837f', 500, 'right');
    c.fillStyle = '#1d2a2d'; c.beginPath(); c.roundRect(20, 62, 472, 236, 10); c.fill();
    c.fillStyle = '#ff5a1f'; c.fillRect(20, 62, 8, 236);
    print(c, 'Masa 12', 46, 112, 38, '#f2f2ef', 700);
    print(c, `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`, 470, 112, 36, '#ff5a1f', 600, 'right');
    print(c, `${FIX.qty} × Ev usulü mantı`, 46, 170, 26, '#e3e8e5', 500); print(c, 'biri acısız', 46, 206, 22, '#9fb0ae');
    c.fillStyle = '#2b3b3e'; c.fillRect(46, 252, 420, 10);
    c.fillStyle = '#ff5a1f'; c.fillRect(46, 252, 420 * ((t * 0.08) % 1), 10);
    T.kds.texture.needsUpdate = true;
  };
  T.drawKds(0);
  T.plate = tex(256, 352, (c) => {
    c.fillStyle = '#1b2125'; c.fillRect(0, 0, 256, 352);
    print(c, 'HAZIR', 22, 40, 16, '#7fd39b', 650); print(c, 'Masa 12', 234, 40, 16, '#c6ccd2', 500, 'right');
    c.fillStyle = '#f4f4f1'; c.beginPath(); c.arc(128, 178, 96, 0, TAU); c.fill();
    c.fillStyle = '#eceae2'; c.beginPath(); c.arc(128, 178, 70, 0, TAU); c.fill();
    c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(128, 182, 52, 40, 0, 0, TAU); c.fill();
    for (let i = 0; i < 14; i++) { const a = i * 2.4, r = 10 + (i % 4) * 9; c.fillStyle = '#e1c18e'; c.beginPath(); c.ellipse(128 + Math.cos(a) * r, 180 + Math.sin(a) * r * .8, 9, 6, a, 0, TAU); c.fill(); }
    c.fillStyle = '#c0392b'; for (let i = 0; i < 18; i++) { const a = i * 1.7, r = 8 + (i % 5) * 8; c.beginPath(); c.arc(128 + Math.cos(a) * r, 178 + Math.sin(a) * r * .8, 2.4, 0, TAU); c.fill(); }
    print(c, `${FIX.qty} × Ev usulü mantı`, 22, 318, 17, '#c6ccd2', 500);
  });
  T.stock = tex(256, 352, (c) => {
    c.fillStyle = '#e9ece6'; c.fillRect(0, 0, 256, 352);
    print(c, 'STOK DÜŞÜMÜ', 22, 40, 16, '#5f665e', 650);
    print(c, 'En eski parti önce', 22, 70, 15, '#7a7f78');
    [['Lot A', FIX.lotA], ['Lot B', FIX.lotB]].forEach(([n, [q, c1]], i) => {
      const y = 116 + i * 58; c.fillStyle = i ? '#d9ddd6' : '#ffd9c7'; c.beginPath(); c.roundRect(18, y - 30, 220, 46, 6); c.fill();
      print(c, n, 32, y, 19, '#14171c', 650); print(c, `${q} × ${tl(c1)}`, 224, y, 18, '#14171c', 500, 'right');
    });
    dash(c, 240, 22, 234, '#9aa09a');
    print(c, 'Maliyet', 22, 282, 18, '#5f665e'); print(c, `${tl(FIX.cost)} TL`, 234, 282, 22, '#14171c', 700, 'right');
  });
  T.till = tex(512, 176, (c) => {
    c.fillStyle = '#10201b'; c.fillRect(0, 0, 512, 176);
    print(c, 'Masa 12 · tahsilat', 22, 40, 20, '#98b19f', 500);
    print(c, `${tl(FIX.total)} TL`, 22, 112, 58, '#eef2df', 600);
    print(c, `Nakit ${tl(FIX.cash)}   Kart ${tl(FIX.card)}`, 22, 154, 18, '#98b19f');
  });
  T.receipt = tex(280, 540, (c) => {
    c.fillStyle = '#f4f4f1'; c.fillRect(0, 0, 280, 540);
    print(c, 'KASAM360', 140, 48, 24, '#2b312c', 700, 'center'); print(c, 'ÖRNEK FİŞ', 140, 76, 15, '#7a7f78', 600, 'center');
    dash(c, 100, 20, 260, '#8a9189');
    print(c, 'Masa 12', 22, 136, 20, '#2b312c', 650);
    print(c, `${FIX.qty} × Ev usulü mantı`, 22, 170, 17, '#2b312c'); print(c, tl(FIX.total), 258, 196, 18, '#2b312c', 600, 'right');
    dash(c, 220, 20, 260, '#8a9189');
    print(c, 'Nakit', 22, 256, 17, '#2b312c'); print(c, tl(FIX.cash), 258, 256, 17, '#2b312c', 500, 'right');
    print(c, 'Kart', 22, 286, 17, '#2b312c'); print(c, tl(FIX.card), 258, 286, 17, '#2b312c', 500, 'right');
    print(c, 'Toplam', 22, 330, 22, '#2b312c', 700); print(c, tl(FIX.total), 258, 330, 22, '#2b312c', 700, 'right');
    for (let i = 0; i < 44; i++) { c.fillStyle = '#2b312c'; c.fillRect(25 + i * 5, 380, 1 + (i % 3), 80); }
  });
  T.sync = tex(512, 200, () => {});
  T.drawSync = (online) => {
    const c = T.sync.ctx;
    c.fillStyle = '#0f1719'; c.fillRect(0, 0, 512, 200);
    c.fillStyle = online ? '#3fbf6f' : '#ff5a1f'; c.beginPath(); c.arc(40, 52, 12, 0, TAU); c.fill();
    print(c, online ? 'Eşitlendi' : 'Çevrimdışı', 66, 62, 30, '#f2f2ef', 650);
    print(c, online ? '0 kayıt sırada · 14:52' : '2 kayıt sırada', 28, 128, 26, online ? '#7fd39b' : '#ffb28f', 500);
    print(c, 'Satış bu cihazda sürüyor', 28, 170, 18, '#71837f');
    T.sync.texture.needsUpdate = true;
  };
  T.drawSync(false);
  T.syncCard = tex(256, 352, (c) => {
    c.fillStyle = '#13202a'; c.fillRect(0, 0, 256, 352);
    print(c, 'BULUT', 22, 40, 16, '#8fb1c9', 650);
    print(c, 'Masa 12', 22, 100, 34, '#f2f2ef', 700); print(c, 'kaydı sırada', 22, 132, 20, '#b8c8d4');
    for (let i = 0; i < 5; i++) { c.fillStyle = i < 2 ? '#ff5a1f' : '#2a3c4a'; c.fillRect(22 + i * 44, 180, 36, 36); }
    print(c, 'İnternet gelince gider', 22, 318, 16, '#8fb1c9', 500);
  });
  T.lot = ['A', 'B', 'C'].map((l, i) => tex(160, 80, (c) => {
    c.fillStyle = i === 0 ? '#ff5a1f' : '#e9e6dc'; c.fillRect(0, 0, 160, 80);
    print(c, `Lot ${l}`, 80, 36, 26, '#14171c', 700, 'center'); print(c, 'kıyma', 80, 64, 18, '#3b3f3a', 500, 'center');
  }));
  T.plaque = (i, name) => tex(512, 116, (c) => {
    c.fillStyle = '#151a20'; c.fillRect(0, 0, 512, 116);
    print(c, String(i + 1).padStart(2, '0'), 24, 76, 42, '#ff5a1f', 550); print(c, name.toLocaleUpperCase('tr-TR'), 111, 73, 35, '#d7d9d7', 550);
  });
  T.coin = tex(128, 128, (c) => { c.clearRect(0, 0, 128, 128); print(c, '₺', 64, 96, 88, '#7a3c12', 650, 'center'); });
  return T;
}

// İstasyon gövdeleri. Her fonksiyon yerel koordinatta çizer; zemin plakasının üstü y ≈ 0.3.
export function buildStationBodies(kit, T, groups) {
  const { THREE, M, S, box, cyl, ball, screen, tube } = kit;
  const A = {}; // hareketli parçalar
  // 01 Salon: masa, dört sandalye, salon terminali, masadan kalkan adisyon.
  {
    const g = groups.salon;
    cyl(g, 0.28, 0.04, 0.2, 0.33, -0.1, M.dark); cyl(g, 0.055, 0.56, 0.2, 0.63, -0.1, M.chrome);
    cyl(g, 0.5, 0.06, 0.2, 0.94, -0.1, S.ivory, 0.5, 40);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2, ch = new THREE.Group();
      ch.position.set(0.2 + Math.cos(a) * 0.66, 0, -0.1 + Math.sin(a) * 0.66); ch.rotation.y = Math.atan2(Math.cos(a), Math.sin(a)); g.add(ch);
      cyl(ch, 0.03, 0.26, 0, 0.45, 0, M.chrome); box(ch, 0.32, 0.05, 0.32, 0, 0.6, 0, S.body, 0.02); box(ch, 0.32, 0.36, 0.045, 0, 0.82, 0.15, S.body, 0.02);
      cyl(g, 0.11, 0.015, 0.2 + Math.cos(a) * 0.3, 0.98, -0.1 + Math.sin(a) * 0.3, M.chrome);
      ball(g, 0.045, 0.2 + Math.cos(a) * 0.3, 1.01, -0.1 + Math.sin(a) * 0.3, M.copper);
    }
    cyl(g, 0.045, 1.0, -0.62, 0.95, -0.62, M.chrome);
    box(g, 0.98, 0.66, 0.06, -0.62, 1.62, -0.6, S.body, 0.04);
    screen(g, 0.92, 0.6, -0.62, 1.62, -0.565, T.salon);
    const card = new THREE.Group(); card.userData.moving = true; g.add(card);
    box(card, 0.4, 0.56, 0.03, 0, 0, 0, M.ivory, 0.02); screen(card, 0.38, 0.53, 0, 0, 0.017, T.order);
    A.card = card;
  }
  // 02 Mutfak: ocak, tencereler, buhar, davlumbaz ve mutfak ekranı.
  {
    const g = groups.mutfak;
    box(g, 1.74, 0.62, 1.33, 0, 0.65, -0.05, S.ivory, 0.13);
    box(g, 1.5, 0.06, 1.16, 0, 0.99, -0.04, M.dark, 0.025);
    box(g, 1.2, 0.34, 0.04, 0, 0.62, 0.63, M.dark, 0.02); box(g, 0.9, 0.04, 0.05, 0, 0.83, 0.67, M.chrome, 0.01);
    for (let i = 0; i < 4; i++) cyl(g, 0.05, 0.05, -0.5 + i * 0.33, 0.92, 0.62, M.chrome).rotation.x = Math.PI / 2;
    A.flames = [];
    for (const [x, z, on] of [[-0.42, -0.3, 1], [0.38, -0.3, 1], [-0.42, 0.25, 0], [0.38, 0.25, 1]]) {
      cyl(g, 0.17, 0.02, x, 1.03, z, M.edge);
      if (on) { const f = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 6, 24), M.flame); f.rotation.x = Math.PI / 2; f.position.set(x, 1.05, z); f.userData.moving = true; g.add(f); A.flames.push(f); }
    }
    cyl(g, 0.22, 0.32, -0.42, 1.21, -0.3, M.chrome, 0.2);
    const lid = new THREE.Group(); lid.position.set(-0.42, 1.38, -0.3); lid.userData.moving = true; g.add(lid);
    cyl(lid, 0.23, 0.03, 0, 0, 0, M.copper); ball(lid, 0.035, 0, 0.03, 0, M.dark); A.lid = lid;
    cyl(g, 0.18, 0.42, 0.38, 1.26, -0.3, M.chrome, 0.17); cyl(g, 0.19, 0.03, 0.38, 1.48, -0.3, M.copper);
    cyl(g, 0.26, 0.07, 0.38, 1.08, 0.25, M.dark, 0.23); box(g, 0.4, 0.03, 0.05, 0.82, 1.1, 0.25, M.dark, 0.01);
    for (const x of [-0.74, 0.74]) cyl(g, 0.045, 1.55, x, 1.75, -0.6, M.chrome);
    box(g, 1.86, 0.3, 0.64, 0, 2.62, -0.36, S.amber, 0.05);
    box(g, 1.12, 0.66, 0.05, 0, 1.86, -0.64, M.dark, 0.03); screen(g, 1.06, 0.62, 0, 1.86, -0.612, T.kds);
    A.steam = [];
    for (let i = 0; i < 10; i++) { const s = ball(g, 0.07, -0.42, 1.5, -0.3, M.steam); s.userData.seed = i / 10; s.userData.moving = true; A.steam.push(s); }
  }
  // 03 Depo: raf, sandıklar; en eski parti (Lot A) önce dışarı kayar.
  {
    const g = groups.depo;
    for (const x of [-0.8, 0.8]) for (const z of [-0.45, 0.45]) cyl(g, 0.035, 1.9, x, 1.25, z, M.chrome);
    for (const y of [0.62, 1.24, 1.86]) box(g, 1.68, 0.04, 1.0, 0, y, 0, M.edge, 0.01);
    for (let row = 0; row < 3; row++) for (let i = 0; i < 3; i++) {
      if (row === 0 && i === 0) continue;
      const y = [0.62, 1.24, 1.86][row] + 0.17;
      box(g, 0.44, 0.3, 0.78, -0.52 + i * 0.52, y, 0, row === 0 ? M.wood : row === 1 ? S.ivory : M.copper, 0.03);
      if (row === 0) screen(g, 0.3, 0.15, -0.52 + i * 0.52, y, 0.395, T.lot[i]);
    }
    const lot = new THREE.Group(); lot.position.set(-0.52, 0.79, 0); lot.userData.moving = true; g.add(lot);
    box(lot, 0.44, 0.3, 0.78, 0, 0, 0, M.wood, 0.03); screen(lot, 0.3, 0.15, 0, 0, 0.395, T.lot[0]); A.lot = lot;
  }
  // 04 Kasa: tezgâh, ekran, tuş takımı, fiş, çekmece ve düşen para.
  {
    const g = groups.kasa;
    box(g, 1.91, 0.63, 1.32, 0, 0.65, -0.06, S.ivory, 0.12); box(g, 1.96, 0.19, 1.38, 0, 0.42, -0.04, S.body, 0.04);
    const drawer = new THREE.Group(); drawer.position.set(0, 0.6, 0.12); drawer.userData.moving = true; g.add(drawer);
    box(drawer, 1.2, 0.14, 0.9, 0, 0, 0, M.dark, 0.02); box(drawer, 1.3, 0.18, 0.04, 0, 0, 0.48, M.body, 0.02); box(drawer, 0.37, 0.04, 0.03, 0, 0, 0.51, M.chrome, 0.009);
    for (let i = 0; i < 4; i++) box(drawer, 0.22, 0.04, 0.3, -0.42 + i * 0.28, 0.06, 0.1, i % 2 ? M.green : M.copper, 0.01);
    A.drawer = drawer;
    box(g, 1.02, 0.25, 0.91, -0.33, 1.04, -0.03, S.body, 0.045);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) box(g, 0.19, 0.085, 0.17, -0.62 + c * 0.27, 1.21, 0.27 - r * 0.24, c === 2 && r === 2 ? M.amber : M.ivory, 0.022);
    box(g, 0.64, 0.6, 0.52, 0.58, 1.04, -0.15, S.body, 0.045); box(g, 0.48, 0.07, 0.09, 0.59, 1.37, -0.1, M.dark, 0.01);
    cyl(g, 0.06, 0.65, -0.35, 1.6, -0.56, M.chrome); box(g, 1.13, 0.46, 0.19, -0.35, 1.98, -0.56, S.body, 0.045);
    screen(g, 1.015, 0.349, -0.35, 1.98, -0.459, T.till);
    const receipt = new THREE.Group(); receipt.position.set(0.59, 1.37, -0.1); receipt.rotation.x = -0.16; receipt.userData.moving = true; g.add(receipt);
    screen(receipt, 0.41, 0.83, 0, 0.415, 0.01, T.receipt).material.side = THREE.DoubleSide; A.receipt = receipt;
    const coin = new THREE.Group(); coin.userData.moving = true; g.add(coin);
    cyl(coin, 0.22, 0.065, 0, 0, 0, M.amber, undefined, 32).rotation.x = Math.PI / 2;
    const lira = screen(coin, 0.28, 0.28, 0, 0, 0.04, T.coin); lira.material.transparent = true; A.coin = coin;
    cyl(g, 0.33, 0.09, 1.04, 0.39, 0.55, M.dark); cyl(g, 0.26, 0.025, 1.04, 0.445, 0.55, M.copper);
  }
  // 05 Bulut: sunucu gövdesi, anten halkaları; çevrimdışıyken turuncu, eşitlenince yeşil.
  {
    const g = groups.bulut;
    A.syncMat = M.light.clone();
    box(g, 1.5, 0.42, 1.0, 0, 0.55, -0.05, S.body, 0.08);
    for (let i = 0; i < 3; i++) { box(g, 1.36, 0.08, 0.04, 0, 0.44 + i * 0.11, 0.46, M.dark, 0.01); box(g, 0.5, 0.018, 0.012, -0.36, 0.44 + i * 0.11, 0.485, A.syncMat, 0.002); }
    box(g, 0.94, 0.44, 0.08, -0.22, 1.05, -0.25, S.body, 0.04); screen(g, 0.88, 0.344, -0.22, 1.05, -0.205, T.sync);
    cyl(g, 0.04, 1.3, 0.5, 1.4, -0.3, M.chrome); ball(g, 0.06, 0.5, 2.08, -0.3, A.syncMat);
    A.rings = [0.16, 0.25, 0.34].map((r, i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.014, 6, 40), A.syncMat);
      ring.position.set(0.5, 1.45 + i * 0.22, -0.3); ring.rotation.x = Math.PI / 2; ring.userData.moving = true; g.add(ring); return ring;
    });
    tube(g, [[0.5, 0.75, -0.3], [0.5, 0.62, 0.1], [0.2, 0.6, 0.3]], 0.02, M.dark);
  }
  return A;
}
