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
      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
      style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}
    >
      <span className={loading ? 'inline-block animate-spin' : 'inline-block'}>↻</span>
      {label}
    </button>
  );
}
