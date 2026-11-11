export interface ChartPoint {
  x: number;
  y: number;
}

const fixed = (value: number) => (Math.round(value * 10) / 10).toString();

/**
 * Noktalardan yumuşak eğri çizer (tek yönlü kübik, Fritsch-Carlson). Eğri noktaların
 * arasında taşmaz: ciro sıfırın altına sarkıyormuş gibi görünmez.
 */
export function smoothPath(points: ChartPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${fixed(points[0].x)} ${fixed(points[0].y)}`;
  const count = points.length;
  const slopes: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const run = points[index + 1].x - points[index].x;
    slopes.push(run === 0 ? 0 : (points[index + 1].y - points[index].y) / run);
  }
  const tangents: number[] = [slopes[0]];
  for (let index = 1; index < count - 1; index += 1) {
    const before = slopes[index - 1];
    const after = slopes[index];
    tangents.push(before * after <= 0 ? 0 : (before + after) / 2);
  }
  tangents.push(slopes[count - 2]);
  for (let index = 0; index < count - 1; index += 1) {
    if (slopes[index] === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const a = tangents[index] / slopes[index];
    const b = tangents[index + 1] / slopes[index];
    const size = Math.hypot(a, b);
    if (size > 3) {
      tangents[index] = (3 * a * slopes[index]) / size;
      tangents[index + 1] = (3 * b * slopes[index]) / size;
    }
  }
  let path = `M${fixed(points[0].x)} ${fixed(points[0].y)}`;
  for (let index = 0; index < count - 1; index += 1) {
    const run = (points[index + 1].x - points[index].x) / 3;
    path +=
      ` C${fixed(points[index].x + run)} ${fixed(points[index].y + tangents[index] * run)}` +
      ` ${fixed(points[index + 1].x - run)} ${fixed(points[index + 1].y - tangents[index + 1] * run)}` +
      ` ${fixed(points[index + 1].x)} ${fixed(points[index + 1].y)}`;
  }
  return path;
}

/** Eğrinin altını tabana kadar kapatır; dolgu için. */
export function areaPath(line: string, points: ChartPoint[], baseY: number): string {
  if (points.length < 2) return '';
  return `${line} L${fixed(points[points.length - 1].x)} ${fixed(baseY)} L${fixed(points[0].x)} ${fixed(baseY)} Z`;
}

/** Eksen için 4 aralıklı "yuvarlak" üst sınır. Lira cinsinden tamsayıdır. */
export function niceAxisMaxLira(peakCents: number): number {
  const peakLira = Math.max(4, Math.ceil(peakCents / 100));
  const rawStep = Math.ceil(peakLira / 4);
  let magnitude = 1;
  while (magnitude * 10 <= rawStep) magnitude *= 10;
  const step = [1, 2, 5, 10].map((multiple) => multiple * magnitude).find((candidate) => candidate >= rawStep) ?? rawStep;
  return step * 4;
}

/** Eksen etiketi: 1.250 lira "1,2B", 2.000.000 lira "2M". Yalnız görünümdür, tutar hesabı değildir. */
export function axisLabel(lira: number): string {
  if (lira < 1000) return String(lira);
  const unit = lira >= 1_000_000 ? 1_000_000 : 1000;
  const suffix = unit === 1_000_000 ? 'M' : 'B';
  const whole = Math.floor(lira / unit);
  const tenth = Math.floor(((lira % unit) * 10) / unit);
  return tenth === 0 ? `${whole}${suffix}` : `${whole},${tenth}${suffix}`;
}
