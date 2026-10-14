'use client';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, message, confirmLabel = 'Confirmar', onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <h2 className="mb-2 text-lg font-semibold text-[var(--text)]">{title}</h2>
        <p className="mb-6 text-sm text-[var(--text-2)]">{message}</p>
        <div className="flex gap-2">
          <button onClick={onConfirm}
            className="h-10 flex-1 rounded-full border border-[var(--danger-border)] bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-sm font-medium text-[var(--danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--danger)_24%,transparent)]">
            {confirmLabel}
          </button>
          <button onClick={onCancel}
            className="h-10 flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
