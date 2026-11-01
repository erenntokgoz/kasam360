import React from 'react';
import { cn } from '../lib/cn';

interface BarProps {
  label: string;
  plain?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/** Bütün ekranların tek ince menü şeridi: solda sekmeler, sağda işlemler. */
export const Bar: React.FC<BarProps> = ({ label, plain, actions, children }) => (
  <div className={cn('bar', plain && 'bar-plain')}>
    <div className="bar-tabs" role="tablist" aria-label={label}>{children}</div>
    {actions ? <div className="bar-actions">{actions}</div> : null}
  </div>
);

interface BarTabProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
}

export const BarTab: React.FC<BarTabProps> = ({ active, className, ...props }) => (
  <button type="button" role="tab" aria-selected={active} className={cn('bar-item', className)} {...props} />
);

interface BarActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'primary' | 'danger';
}

export const BarAction: React.FC<BarActionProps> = ({ tone, className, ...props }) => (
  <button
    type="button"
    className={cn('bar-item', tone === 'primary' && 'bar-primary', tone === 'danger' && 'bar-danger', className)}
    {...props}
  />
);
