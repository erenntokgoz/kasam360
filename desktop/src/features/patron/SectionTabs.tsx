import React from 'react';
import { Bar, BarTab } from '../../ui/Bar';

export interface SectionTab<T extends string> {
  id: T;
  label: string;
}

interface SectionTabsProps<T extends string> {
  label: string;
  tabs: SectionTab<T>[];
  active: T;
  onChange: (id: T) => void;
  actions?: React.ReactNode;
}

/** Bölüm içi ikincil gezinme: üst şeritle aynı dil, ayrı bir zemin taşımaz. */
export function SectionTabs<T extends string>({ label, tabs, active, onChange, actions }: SectionTabsProps<T>) {
  return (
    <Bar label={label} plain actions={actions}>
      {tabs.map((tab) => (
        <BarTab key={tab.id} active={active === tab.id} onClick={() => onChange(tab.id)}>
          {tab.label}
        </BarTab>
      ))}
    </Bar>
  );
}
