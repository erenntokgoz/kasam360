import React from 'react';

const MAX_SEATS = 12;

/** Masa kalemle çizilir; üst ve alt kenardaki kısa çizgiler sandalyedir, süs değil kapasitedir. */
export const TableOutline: React.FC<{ seats: number }> = ({ seats }) => {
  const count = Math.min(Math.max(seats, 1), MAX_SEATS);
  const top = Math.ceil(count / 2);
  const bottom = count - top;
  const chairs = (amount: number, y: number) =>
    Array.from({ length: amount }, (_, index) => {
      const x = 24 + ((index + 0.5) * 112) / amount;
      return <path key={`${y}-${index}`} d={`M${x - 8} ${y} q8 ${y < 50 ? -3 : 3} 16 0`} />;
    });

  return (
    <svg viewBox="0 0 160 100" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M26 22 C60 19 104 21 134 20 C136 40 135 60 136 79 C100 81 58 78 25 80 C23 60 25 42 26 22 Z" />
      {chairs(top, 12)}
      {chairs(bottom, 89)}
    </svg>
  );
};
