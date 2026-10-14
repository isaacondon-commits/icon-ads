'use client';

// Botón de "Actualizar" reutilizable: re-consulta los datos de la sección sin
// recargar toda la página.
export default function RefreshButton({
  onClick,
  loading = false,
  label = 'Actualizar',
}: {
  onClick: () => void | Promise<void>;
  loading?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick()}
      disabled={loading}
      title="Actualizar datos de esta sección"
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 text-sm font-medium text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-50"
    >
      <span className={loading ? 'inline-block animate-spin' : 'inline-block'}>↻</span>
      {label}
    </button>
  );
}
