'use client';

export default function HelpPage() {
  const shortcuts = [
    { key: 'N', description: 'Crear nuevo ítem (en la página actual)' },
    { key: 'ESC', description: 'Cerrar modal abierto' },
  ];

  const sections = [
    {
      title: 'Tablets',
      items: [
        'Registrá cada tablet con un Device ID único.',
        'Asigná una playlist para que empiece a reproducir anuncios.',
        'Usá "Forzar Sync" para que la tablet actualice su contenido en la próxima conexión.',
        'El estado "online" significa que la tablet sincronizó en los últimos 10 minutos.',
        'El QR de cada tablet permite registrarla desde la app Android escaneando el código.',
        'Exportá el listado completo a CSV desde el botón "↓ CSV".',
      ],
    },
    {
      title: 'Campañas y Anuncios',
      items: [
        'Creá una campaña por cliente con fechas de inicio y fin.',
        'Subí anuncios (imagen o video) y asignálos a campañas.',
        'Los anuncios deben estar aprobados para aparecer en las playlists.',
        'Las campañas vencidas se marcan automáticamente como inactivas.',
      ],
    },
    {
      title: 'Playlists',
      items: [
        'Una playlist es una lista ordenada de anuncios.',
        'Asignás playlists a tablets para controlar qué se reproduce.',
        'Cada cambio en una playlist genera una nueva versión — podés revertir a versiones anteriores.',
        'Podés duplicar una playlist como punto de partida para otra.',
      ],
    },
    {
      title: 'Monitor',
      items: [
        'El monitor muestra el estado en tiempo real de todas las tablets.',
        'Se actualiza automáticamente cada 30 segundos.',
        'Las tablets offline hace más de 2 horas aparecen con alerta naranja.',
        'Hacé click en cualquier tablet para ver su detalle.',
      ],
    },
    {
      title: 'Estadísticas',
      items: [
        'El dashboard muestra el resumen ejecutivo con reproducciones de los últimos 7 días.',
        'En Estadísticas podés filtrar por rango de fechas y ver datos por campaña y tablet.',
        'Exportá métricas detalladas a CSV desde el botón correspondiente.',
      ],
    },
    {
      title: 'Logs y Auditoría',
      items: [
        'Los logs del sistema registran errores de las tablets.',
        'El log de auditoría registra todas las acciones administrativas (login, creaciones, cambios).',
      ],
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Ayuda y documentación</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Guía rápida del panel de administración Icon Ads.
      </p>

      {/* Keyboard shortcuts */}
      <div className="card p-6 mb-6">
        <h2 className="font-semibold mb-4">Atajos de teclado</h2>
        <div className="space-y-2">
          {shortcuts.map((s) => (
            <div key={s.key} className="flex items-center gap-4">
              <kbd className="px-2.5 py-1 rounded-lg text-xs font-mono font-semibold border" style={{ background: 'var(--bg)', borderColor: 'var(--border-md)', color: 'var(--text)' }}>
                {s.key}
              </kbd>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{s.description}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Feature guides */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {sections.map((section) => (
          <div key={section.title} className="card p-6">
            <h2 className="font-semibold mb-3">{section.title}</h2>
            <ul className="space-y-2">
              {section.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
