import React from 'react';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  /** Kilit ekranı uygulamanın üstünde kalır, giriş ekranları altında. */
  zIndexClass?: string;
  children: React.ReactNode;
}

/** Giriş, kilit ve kurulum aynı yaprağı paylaşır; tek bir iş sorulur. */
export const AuthLayout: React.FC<AuthLayoutProps> = ({ title, subtitle, zIndexClass = 'z-50', children }) => (
  <div className={`fixed inset-0 ${zIndexClass} overflow-y-auto bg-[var(--bg-canvas)] select-none`}>
    <div className="min-h-full max-w-6xl mx-auto px-8 py-10 grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-x-16 gap-y-8 items-center">
      <div>
        <h1 className="auth-title">{title}</h1>
        <p className="mt-4 text-xl text-[var(--text-secondary)]">{subtitle}</p>
      </div>
      <div className="paper slip !rounded-b-none px-6 pb-7 flex flex-col gap-4 w-full max-w-[520px] mx-auto">
        {children}
      </div>
    </div>
  </div>
);
