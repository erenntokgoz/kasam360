import React from 'react';

const LEFT = 30;
const RIGHT = 130;
const TOP = 26;
const BOTTOM = 74;
const CHAIR_DEPTH = 8;

/** Uzun kenarlar önce dolar; kısa kenar yalnız kalabalık masada kullanılır. */
export function seatLayout(seats: number) {
  const count = Math.max(1, seats);
  const ends = count >= 6 ? Math.max(1, Math.round(count * 0.14)) : 0;
  const rest = count - ends * 2;
  return { top: Math.ceil(rest / 2), bottom: Math.floor(rest / 2), ends };
}

const along = (amount: number, from: number, to: number) =>
  Array.from({ length: amount }, (_, index) => from + ((index + 0.5) * (to - from)) / amount);

const chairLength = (amount: number, side: number) => Math.min(22, (side / amount) * 0.72);

/** Sandalye sayısı kapasitedir: hepsi çizimin içinde kalır, çok kişide daralır. */
export const TableOutline: React.FC<{ seats: number }> = ({ seats }) => {
  const { top, bottom, ends } = seatLayout(seats);
  const sideLength = RIGHT - LEFT;
  const endLength = BOTTOM - TOP;
  const flat = (x: number, y: number, amount: number) => {
    const width = chairLength(amount, sideLength);
    return <rect key={`${x}-${y}`} className="table-chair" x={x - width / 2} y={y} width={width} height={CHAIR_DEPTH} rx={3.5} />;
  };
  const upright = (x: number, y: number) => {
    const height = chairLength(ends, endLength);
    return <rect key={`${x}-${y}`} className="table-chair" x={x} y={y - height / 2} width={CHAIR_DEPTH} height={height} rx={3.5} />;
  };

  return (
    <svg viewBox="0 0 160 100" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      {along(top, LEFT, RIGHT).map((x) => flat(x, TOP - CHAIR_DEPTH - 3, top))}
      {along(bottom, LEFT, RIGHT).map((x) => flat(x, BOTTOM + 3, bottom))}
      {ends > 0 ? along(ends, TOP, BOTTOM).flatMap((y) => [upright(LEFT - CHAIR_DEPTH - 3, y), upright(RIGHT + 3, y)]) : null}
      <rect className="table-top" x={LEFT} y={TOP} width={sideLength} height={endLength} rx={10} />
      <rect className="table-edge" x={LEFT + 4} y={TOP + 4} width={sideLength - 8} height={endLength - 8} rx={7} />
    </svg>
  );
};
