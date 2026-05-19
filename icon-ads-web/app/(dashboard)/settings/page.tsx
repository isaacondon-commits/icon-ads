'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast-context';

export default function SettingsPage() {
  const { show } = useToast();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = () =>
    api.getSettings().then(setSettings).catch(() => {}).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const save = async (key: string, value: string) => {
    setSaving(key);
    try {
      await api.setSetting(key, value);
      setSettings((s) => ({ ...s, [key]: value }));
      show('Configuración guardada');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al guardar', 'error');
    } finally { setSaving(null); }
  };

  const maintenanceOn = settings['maintenance_mode'] === 'true';
  const retentionDays = settings['metrics_retention_days'] ?? '90';
  const webhookUrl = settings['webhook_url'] ?? '';

  const [retentionInput, setRetentionInput] = useState('');
  const [webhookInput, setWebhookInput] = useState('');

  useEffect(() => {
    setRetentionInput(settings['metrics_retention_days'] ?? '90');
    setWebhookInput(settings['webhook_url'] ?? '');
  }, [settings]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Configuración del sistema</h1>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : (
        <div className="space-y-6 max-w-2xl">

          {/* Maintenance mode */}
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold mb-1">Modo mantenimiento</h2>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Cuando está activo, todas las rutas API devuelven 503 excepto /health, /auth y /device (las tablets siguen funcionando).
                </p>
              </div>
              <button
                onClick={() => save('maintenance_mode', maintenanceOn ? 'false' : 'true')}
                disabled={saving === 'maintenance_mode'}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${maintenanceOn ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${maintenanceOn ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            {maintenanceOn && (
              <p className="mt-3 text-sm font-semibold text-red-600">
                Sistema en mantenimiento — el panel web mostrará error 503 a todos los usuarios.
              </p>
            )}
          </div>

          {/* Metrics retention */}
          <div className="card p-6">
            <h2 className="font-semibold mb-1">Retención de métricas</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              Las métricas más antiguas que este número de días se eliminan automáticamente cada 24 horas.
            </p>
            <div className="flex gap-3 items-center">
              <input
                type="number"
                min="7"
                max="365"
                className="input w-28"
                value={retentionInput}
                onChange={(e) => setRetentionInput(e.target.value)}
              />
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>días</span>
              <button
                onClick={() => save('metrics_retention_days', retentionInput)}
                disabled={saving === 'metrics_retention_days' || retentionInput === retentionDays}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium"
              >
                {saving === 'metrics_retention_days' ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>

          {/* Webhook URL */}
          <div className="card p-6">
            <h2 className="font-semibold mb-1">Webhook — tablet offline</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              Se envía un POST a esta URL cuando una tablet lleva más de 2 horas offline. Dejar vacío para deshabilitar.
            </p>
            <div className="flex gap-3">
              <input
                type="url"
                className="input flex-1"
                placeholder="https://hooks.example.com/tablet-offline"
                value={webhookInput}
                onChange={(e) => setWebhookInput(e.target.value)}
              />
              <button
                onClick={() => save('webhook_url', webhookInput)}
                disabled={saving === 'webhook_url' || webhookInput === webhookUrl}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium"
              >
                {saving === 'webhook_url' ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              El cuerpo del POST incluye: event, tabletId, name, zone, lastSync.
            </p>
          </div>

        </div>
      )}
    </div>
  );
}
