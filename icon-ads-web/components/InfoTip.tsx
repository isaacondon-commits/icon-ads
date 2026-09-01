'use client';

import { useState } from 'react';

// "ⓘ" con tooltip: explica qué mide una métrica y de dónde sale el dato.
export default function InfoTip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex items-center align-middle ml-1"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
    >
      <span
        className="w-4 h-4 rounded-full border text-[10px] leading-none flex items-center justify-center cursor-help select-none"
        style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}
        aria-label="Más información"
      >
        i
      </span>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 -translate-x-1/2 top-6 z-50 w-64 p-3 rounded-lg text-xs font-normal leading-relaxed shadow-xl normal-case"
          style={{ background: 'var(--card)', border: '1px solid var(--border-md)', color: 'var(--text-body, inherit)' }}
        >
          {children}
        </span>
      )}
    </span>
  );
}
