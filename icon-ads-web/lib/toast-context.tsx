'use client';

import { createContext, useCallback, useContext, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
interface Toast { id: number; message: string; type: ToastType; }

interface ToastCtx { show: (message: string, type?: ToastType) => void; }
const ToastContext = createContext<ToastCtx>({ show: () => {} });

let _id = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++_id;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const icons: Record<ToastType, string> = {
    success: '✓', error: '✕', info: 'ℹ', warning: '⚠',
  };
  const colors: Record<ToastType, string> = {
    // Avisos con la paleta: fondo de superficie y borde/acento del estado.
    success: 'bg-[var(--surface-2)] border border-[color-mix(in_srgb,var(--ok)_45%,transparent)] [&>span:first-child]:text-[var(--ok)]',
    error: 'bg-[var(--surface-2)] border border-[var(--danger-border)] [&>span:first-child]:text-[var(--danger)]',
    info: 'bg-[var(--surface-2)] border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] [&>span:first-child]:text-[var(--accent)]',
    warning: 'bg-[var(--surface-2)] border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] [&>span:first-child]:text-[var(--warn)]',
  };

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id}
            className={`${colors[t.type]} text-[var(--text)] text-sm px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 animate-slide-up`}>
            <span className="font-bold text-base leading-none">{icons[t.type]}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
