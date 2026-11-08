// İstasyon ekranlarının dokuları. Tutarlar content/orderFixture'dan gelir ve kuruş tamsayısıdır.
import { ORDER_FIXTURE } from '@/content/orderFixture';
import { formatMoneyAmount as tl } from '@/lib/formatMoney';
import { TAU, type Kit, type Painted } from './sceneKit';

const FIX = { qty: ORDER_FIXTURE.qty, cash: ORDER_FIXTURE.cashCents, card: ORDER_FIXTURE.cardCents, total: ORDER_FIXTURE.totalCents,
  cost: ORDER_FIXTURE.costCents, lotA: ORDER_FIXTURE.lotA, lotB: ORDER_FIXTURE.lotB };

export type SceneTextures = {
  salon: Painted; order: Painted; kds: Painted; plate: Painted; stock: Painted; till: Painted; receipt: Painted;
  sync: Painted; syncCard: Painted; lot: Painted[]; coin: Painted;
  drawKds: (t: number) => void; drawSync: (online: boolean) => void;
};

export function buildTextures(kit: Kit): SceneTextures {
  const { canvasTexture: tex, print } = kit;
  const dash = (c: CanvasRenderingContext2D, y: number, x1: number, x2: number, color: string) => {
    c.strokeStyle = color; c.setLineDash([5, 6]); c.beginPath(); c.moveTo(x1, y); c.lineTo(x2, y); c.stroke(); c.setLineDash([]);
  };
  const salon = tex(640, 420, (c) => {
    c.fillStyle = '#10181b'; c.fillRect(0, 0, 640, 420);
    print(c, 'SALON', 26, 46, 22, '#a9b6b6', 600); print(c, '14:21', 614, 46, 20, '#4c6ef5', 500, 'right');
    for (let i = 0; i < 12; i++) {
      const x = 26 + (i % 4) * 150, y = 70 + Math.floor(i / 4) * 112, no = i + 1, busy = [2, 4, 7, 9, 12].includes(no);
      c.fillStyle = no === 12 ? '#4c6ef5' : busy ? '#24363a' : '#172225';
      c.beginPath(); c.roundRect(x, y, 136, 96, 10); c.fill();
      print(c, String(no), x + 16, y + 52, 38, no === 12 ? '#14171c' : busy ? '#e6ebe6' : '#55666a', 650);
      if (busy) print(c, no === 12 ? '4 kişi · 19 dk' : 'açık', x + 16, y + 80, 16, no === 12 ? '#3b1a08' : '#8fa39d');
    }
  });
  const order = tex(256, 352, (c) => {
    c.fillStyle = '#f4f4f1'; c.fillRect(0, 0, 256, 352);
    print(c, 'ADİSYON', 22, 40, 16, '#7a7f78', 600); print(c, '14.02', 234, 40, 16, '#7a7f78', 500, 'right');
    print(c, 'Masa 12', 22, 92, 40, '#14171c', 700); dash(c, 116, 22, 234, '#9aa09a');
    print(c, `${FIX.qty} × Ev usulü mantı`, 22, 154, 19, '#14171c', 600); print(c, 'biri acısız', 22, 182, 17, '#6b716b');
    dash(c, 214, 22, 234, '#9aa09a'); print(c, 'Mutfağa gidecek', 22, 318, 16, '#b23f0c', 600);
  });
  const kds = tex(512, 320, () => undefined);
  const drawKds = (t: number) => {
    const c = kds.ctx, s = 412 + Math.floor(t);
    c.fillStyle = '#0f1719'; c.fillRect(0, 0, 512, 320);
    print(c, 'MUTFAK', 24, 40, 20, '#9fb0ae', 600); print(c, '3 sipariş', 488, 40, 18, '#71837f', 500, 'right');
    c.fillStyle = '#1d2a2d'; c.beginPath(); c.roundRect(20, 62, 472, 236, 10); c.fill();
    c.fillStyle = '#4c6ef5'; c.fillRect(20, 62, 8, 236);
    print(c, 'Masa 12', 46, 112, 38, '#f2f2ef', 700);
    print(c, `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`, 470, 112, 36, '#4c6ef5', 600, 'right');
    print(c, `${FIX.qty} × Ev usulü mantı`, 46, 170, 26, '#e3e8e5', 500); print(c, 'biri acısız', 46, 206, 22, '#9fb0ae');
    c.fillStyle = '#2b3b3e'; c.fillRect(46, 252, 420, 10);
    c.fillStyle = '#4c6ef5'; c.fillRect(46, 252, 420 * ((t * 0.08) % 1), 10);
    kds.texture.needsUpdate = true;
  };
  drawKds(0);
  const plate = tex(256, 352, (c) => {
    c.fillStyle = '#1b2125'; c.fillRect(0, 0, 256, 352);
    print(c, 'HAZIR', 22, 40, 16, '#7fd39b', 650); print(c, 'Masa 12', 234, 40, 16, '#c6ccd2', 500, 'right');
    c.fillStyle = '#f4f4f1'; c.beginPath(); c.arc(128, 178, 96, 0, TAU); c.fill();
    c.fillStyle = '#eceae2'; c.beginPath(); c.arc(128, 178, 70, 0, TAU); c.fill();
    c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(128, 182, 52, 40, 0, 0, TAU); c.fill();
    for (let i = 0; i < 14; i++) { const a = i * 2.4, r = 10 + (i % 4) * 9; c.fillStyle = '#e1c18e'; c.beginPath(); c.ellipse(128 + Math.cos(a) * r, 180 + Math.sin(a) * r * 0.8, 9, 6, a, 0, TAU); c.fill(); }
    c.fillStyle = '#c0392b';
    for (let i = 0; i < 18; i++) { const a = i * 1.7, r = 8 + (i % 5) * 8; c.beginPath(); c.arc(128 + Math.cos(a) * r, 178 + Math.sin(a) * r * 0.8, 2.4, 0, TAU); c.fill(); }
    print(c, `${FIX.qty} × Ev usulü mantı`, 22, 318, 17, '#c6ccd2', 500);
  });
  const stock = tex(256, 352, (c) => {
    c.fillStyle = '#e9ece6'; c.fillRect(0, 0, 256, 352);
    print(c, 'STOK DÜŞÜMÜ', 22, 40, 16, '#5f665e', 650); print(c, 'En eski parti önce', 22, 70, 15, '#7a7f78');
    ([['Lot A', FIX.lotA], ['Lot B', FIX.lotB]] as const).forEach(([n, [q, unit]], i) => {
      const y = 116 + i * 58; c.fillStyle = i ? '#d9ddd6' : '#dbe4ff'; c.beginPath(); c.roundRect(18, y - 30, 220, 46, 6); c.fill();
      print(c, n, 32, y, 19, '#14171c', 650); print(c, `${q} × ${tl(unit)}`, 224, y, 18, '#14171c', 500, 'right');
    });
    dash(c, 240, 22, 234, '#9aa09a');
    print(c, 'Maliyet', 22, 282, 18, '#5f665e'); print(c, `${tl(FIX.cost)} TL`, 234, 282, 22, '#14171c', 700, 'right');
  });
  const till = tex(512, 176, (c) => {
    c.fillStyle = '#10201b'; c.fillRect(0, 0, 512, 176);
    print(c, 'Masa 12 · tahsilat', 22, 40, 20, '#98b19f', 500);
    print(c, `${tl(FIX.total)} TL`, 22, 112, 58, '#eef2df', 600);
    print(c, `Nakit ${tl(FIX.cash)}   Kart ${tl(FIX.card)}`, 22, 154, 18, '#98b19f');
  });
  const receipt = tex(280, 540, (c) => {
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
  const sync = tex(512, 200, () => undefined);
  const drawSync = (online: boolean) => {
    const c = sync.ctx;
    c.fillStyle = '#0f1719'; c.fillRect(0, 0, 512, 200);
    c.fillStyle = online ? '#3fbf6f' : '#f59f00'; c.beginPath(); c.arc(40, 52, 12, 0, TAU); c.fill();
    print(c, online ? 'Eşitlendi' : 'Çevrimdışı', 66, 62, 30, '#f2f2ef', 650);
    print(c, online ? '0 kayıt sırada · 14:52' : '2 kayıt sırada', 28, 128, 26, online ? '#7fd39b' : '#ffd480', 500);
    print(c, 'Satış bu cihazda sürüyor', 28, 170, 18, '#71837f');
    sync.texture.needsUpdate = true;
  };
  drawSync(false);
  const syncCard = tex(256, 352, (c) => {
    c.fillStyle = '#13202a'; c.fillRect(0, 0, 256, 352);
    print(c, 'BULUT', 22, 40, 16, '#8fb1c9', 650);
    print(c, 'Masa 12', 22, 100, 34, '#f2f2ef', 700); print(c, 'kaydı sırada', 22, 132, 20, '#b8c8d4');
    for (let i = 0; i < 5; i++) { c.fillStyle = i < 2 ? '#4c6ef5' : '#2a3c4a'; c.fillRect(22 + i * 44, 180, 36, 36); }
    print(c, 'İnternet gelince gider', 22, 318, 16, '#8fb1c9', 500);
  });
  const lot = ['A', 'B', 'C'].map((l, i) => tex(160, 80, (c) => {
    c.fillStyle = i === 0 ? '#4c6ef5' : '#e9e6dc'; c.fillRect(0, 0, 160, 80);
    print(c, `Lot ${l}`, 80, 36, 26, '#14171c', 700, 'center'); print(c, 'kıyma', 80, 64, 18, '#3b3f3a', 500, 'center');
  }));
  const coin = tex(128, 128, (c) => { c.clearRect(0, 0, 128, 128); print(c, '₺', 64, 96, 88, '#7a3c12', 650, 'center'); });
  return { salon, order, kds, plate, stock, till, receipt, sync, syncCard, lot, coin, drawKds, drawSync };
}
