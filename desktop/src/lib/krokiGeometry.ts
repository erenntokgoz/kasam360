/**
 * Kroki koordinat sistemi: salon ekranı ve kroki editörü aynı fonksiyonları kullanır.
 * Birim "dünya pikselidir": masa 110x110, oda içi başlangıç sol-üst köşedir (başlığın altı).
 * Ekran ölçeği (zoom), kaydırma ve pencere boyutu yalnız çizimi etkiler; kayıtlı değeri değiştirmez.
 */

/** Backend floor360 kontratındaki tuval sınırı; bu aralık dışı konum kayıtta reddedilir. */
export const CANVAS_WIDTH = 4000;
export const CANVAS_HEIGHT = 3000;
export const SNAP = 10;
export const ROTATION_STEP = 45;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Her dokunuş/tıklama saat yönünde sabit adım döndürür; açı 0-359 aralığında kalır. */
export function rotateByStep(rotation: number): number {
  return (((rotation + ROTATION_STEP) % 360) + 360) % 360;
}

/** Döndürülmüş kutunun kapladığı eksen hizalı sınır; dönüş kutunun merkezi etrafındadır. */
export function rotatedBounds(box: Box, rotation: number): Box {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = box.width * cos + box.height * sin;
  const height = box.width * sin + box.height * cos;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/**
 * Ekran noktasını dünya koordinatına çevirir. `origin`, oda içeriğinin sol-üst köşesinin
 * ekrandaki yeridir (getBoundingClientRect); kaydırma ve konteyner kayması bu değerde zaten vardır.
 */
export function pointerToWorld(client: Point, origin: Point, scale: number): Point {
  return { x: (client.x - origin.x) / scale, y: (client.y - origin.y) / scale };
}

export function snapToGrid(value: number): number {
  return Math.round(value / SNAP) * SNAP;
}

/** Döndürülmüş sınırı tuval içinde tutacak en yakın sol-üst konum. */
export function clampToCanvas(position: Point, size: { width: number; height: number }, rotation: number): Point {
  const bounds = rotatedBounds({ ...position, ...size }, rotation);
  const shiftX = Math.min(Math.max(bounds.x, 0), CANVAS_WIDTH - bounds.width) - bounds.x;
  const shiftY = Math.min(Math.max(bounds.y, 0), CANVAS_HEIGHT - bounds.height) - bounds.y;
  return { x: position.x + shiftX, y: position.y + shiftY };
}

/**
 * Sürükleme sırasındaki yeni kayıt konumu. İmleç tutulduğu noktayı korur (`grab`), yani ölçek,
 * kaydırma veya pencere boyutu sürükleme ortasında değişse de nesne imleçten kopmaz.
 * (0,0) "yerleştirilmemiş" anlamına geldiğinden bu kareye bırakılan masa bir ızgara adımı kaydırılır.
 */
export function dragPosition(pointer: Point, grab: Point, size: { width: number; height: number }, rotation: number): Point {
  const raw = { x: pointer.x - grab.x, y: pointer.y - grab.y };
  const snapped = clampToCanvas({ x: snapToGrid(raw.x), y: snapToGrid(raw.y) }, size, rotation);
  const x = Math.round(snapped.x);
  const y = Math.round(snapped.y);
  return x === 0 && y === 0 ? { x: SNAP, y } : { x, y };
}
