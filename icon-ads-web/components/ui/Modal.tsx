'use client';

import { useEffect, useRef } from 'react';

// Ventana modal con la paleta ICON. Cierra con Escape o tocando afuera.
// "Tocando afuera" = el click empieza Y termina en el fondo: seleccionar texto
// o arrastrar desde un campo y soltar afuera no la cierra. Los formularios
// largos pueden apagarlo del todo con closeOnBackdrop={false}.
export default function Modal({ title, children, onClose, wide = false, closeOnBackdrop = true }: {
  title: React.ReactNode; children: React.ReactNode; onClose: () => void; wide?: boolean; closeOnBackdrop?: boolean;
}) {
  const downOnBackdrop = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (closeOnBackdrop && downOnBackdrop.current && e.target === e.currentTarget) onClose();
        downOnBackdrop.current = false;
      }}>
      <div role="dialog" aria-modal="true"
        className={`max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--text)]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar"
            className="flex h-8 w-8 items-center justify-center rounded-full text-xl leading-none text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-[var(--text-2)]">{label}</label>
      {children}
    </div>
  );
}
