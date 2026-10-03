/**
 * Faz 13 · Kroki geometri yardımcıları (saf fonksiyonlar).
 *
 * Bu dosya React bilmez ve DOM bilmez. Sürükleme, ızgara, döndürme ve
 * tuval sınırı kurallarının **tek** yeridir. Aynı kuralların kroki bileşeninde
 * ve kaydetme doğrulamasında ayrı ayrı yazılması, sürüklemede hizalı görünen
 * masanın kaydedildiğinde kaymasına yol açar.
 *
 * Backend bu kuralların karşılığını `floor360/types.rs` içinde tutar. Testler
 * iki tarafın aynı sonucu verdiğini doğrular.
 */

/** Değeri ızgara adımına yuvarlar. Yarım adım yukarı/aşağı gider. */
export function snapToGrid(value: number, grid: number): number {
  if (grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

/** Konumu ızgaraya oturtur. */
export function snapPoint(
  x: number,
  y: number,
  grid: number,
  bounds: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: clampToCanvas(snapToGrid(x, grid), bounds.width),
    y: clampToCanvas(snapToGrid(y, grid), bounds.height),
  };
}

/**
 * Değeri tuvale sınırlar.
 *
 * Neden gerekli: kroki kaydırılabilir olduğu için son sütunun masa sağ kenarı
 * tuvalin dışına taşabilir. Backend `validate_position` sınır dışını reddeder;
 * burada reddetmek yerine kenara dayamak, kullanıcının kaydedemediği bir konuma
 * sürüklenmesini engeller.
 */
export function clampToCanvas(value: number, size: number): number {
  if (value < 0) return 0;
  if (value > size) return size;
  return value;
}

/** Açıyı 0-360 aralığına indirger. -15 -> 345, 375 -> 15. */
export function normalizeAngle(degrees: number): number {
  const mod = degrees % 360;
  return mod < 0 ? mod + 360 : mod;
}

/**
 * Açıyı döndürme adımına oturtur.
 *
 * Neden 360 -> 0: 360 derece görsel olarak 0'ın aynısıdır. Reddedilirse kullanıcı
 * "masa 360 döndü" dediğinde masa kaymaz ama bir sonraki kaydetmede 0'a döner ve
 * kroki zıplar.
 */
export function snapRotation(degrees: number, step: number): number {
  if (step <= 0) return normalizeAngle(degrees);
  const snapped = Math.round(degrees / step) * step;
  return normalizeAngle(snapped);
}

/** Döndürme düğmesine basıldığında bir sonraki adıma geçer. */
export function rotateByStep(current: number, step: number, direction: 1 | -1): number {
  return snapRotation(current + direction * step, step);
}

/** Sandalye sayısı katalogda mı? */
export function isAllowedSeats(seats: number): boolean {
  return [2, 4, 6, 8].includes(seats);
}

/** Obje türü katalogda mı? */
export function isAllowedObjectKind(kind: string): boolean {
  return (['DOOR', 'BAR', 'WALL', 'COLUMN'] as const).includes(kind as 'DOOR');
}

/**
 * Ekran pikseli -> mantıksal kroki koordinatı çarpanı.
 *
 * Kroki 4000x3000 mantıksal tuvalde yaşar, ekranda daha küçük çizilir. Sürükleme
 * dnd-kit'ten **ekran pikseli** olarak geldiği için, ekran delta'sı bu çarpanla
 * mantıksal koordinata çevrilmelidir.
 *
 * Yanlış çeviri en sinsi hatadır: 100 piksel sürükleme 3 piksele dönüşürse masa
 * "kaymıyor" gibi görünür ve kullanıcı krokinin çalıştığını sanar. Bu yüzden
 * çarpan tek yerde hesaplanır ve testle doğrulanır.
 */
export function olcekOlustur(ekranGenislik: number, mantiksalGenislik: number): number {
  if (ekranGenislik <= 0 || mantiksalGenislik <= 0) {
    return 1;
  }
  return mantiksalGenislik / ekranGenislik;
}

/**
 * Bir düzen kaydı geçerli mi?
 *
 * Arayüz kaydetmeden önce bunu çağırır. Amaç kullanıcıyı sunucuya gidiş-dönüş
 * yapmadan hatayı göstermek; backend yine de son sözü söyler, bu bir güvenlik
 * sınırı değil bir kullanıcı kolaylığıdır.
 */
export function validateLayoutDraft(
  draft: { tables: { x: number; y: number; rotation: number; seats: number }[] },
  rules: {
    grid: number;
    rotationStep: number;
    canvasWidth: number;
    canvasHeight: number;
  },
): string | null {
  for (const masa of draft.tables) {
    if (masa.x < 0 || masa.x > rules.canvasWidth) {
      return `Masa x sınır dışı (${masa.x}); kroki ${rules.canvasWidth} piksel genişliğinde`;
    }
    if (masa.y < 0 || masa.y > rules.canvasHeight) {
      return `Masa y sınır dışı (${masa.y}); kroki ${rules.canvasHeight} piksel yüksekliğinde`;
    }
    if (masa.rotation % rules.rotationStep !== 0) {
      return `Masa döndürmesi ${rules.rotationStep} derece adımında olmalı (${masa.rotation})`;
    }
    if (!isAllowedSeats(masa.seats)) {
      return `Sandalye sayısı 2, 4, 6 veya 8 olmalı (${masa.seats})`;
    }
  }
  return null;
}