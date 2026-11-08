import React from 'react';
import darkMark from '../assets/brand/kasam360-ikon-kucuk-koyu-zemin.svg';
import lightMark from '../assets/brand/kasam360-ikon-kucuk-renkli.svg';
import { useUIStore } from '../stores/uiStore';

export interface BrandMarkProps {
  className?: string;
  surface: 'desk' | 'paper';
}

/** İkon zemine göre seçilir: kapı ekranları ve kenar çubuğu temayla birlikte değişir. */
export const BrandMark: React.FC<BrandMarkProps> = ({ className, surface }) => {
  const theme = useUIStore((state) => state.theme);
  const mark = surface === 'paper' || theme === 'light' ? lightMark : darkMark;
  return <img src={mark} alt="" aria-hidden="true" draggable={false} className={className} />;
};
