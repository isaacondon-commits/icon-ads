'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast-context';
import { sunTimes, fmtMin, brightnessAt, DEFAULT_SCHEDULE, type SchedulePoint } from '@/lib/sun';

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

  const handleUploadApk = async () => {
    if (!apkFile) { show('Seleccioná el archivo .apk', 'error'); return; }
    const versionCode = Number(apkVersionCode);
    if (!versionCode || versionCode <= 0) { show('Versión (código) inválida', 'error'); return; }
    if (!apkVersionName.trim()) { show('Falta el nombre de versión', 'error'); return; }
    setUploadingApk(true);
    try {
      const res = await api.uploadApk(apkFile, versionCode, apkVersionName.trim());
      setSettings((s) => ({ ...s, apk_version_code: String(res.versionCode), apk_version_name: res.versionName, apk_url: res.url }));
      setApkFile(null);
      show(`APK v${res.versionCode} publicada — las tablets la van a bajar solas`);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al subir el APK', 'error');
    } finally { setUploadingApk(false); }
  };

  const maintenanceOn = settings['maintenance_mode'] === 'true';
  const retentionDays = settings['metrics_retention_days'] ?? '90';
  const webhookUrl = settings['webhook_url'] ?? '';
  const gaId = settings['ga_measurement_id'] ?? '';
  const callmebotPhone = settings['callmebot_phone'] ?? '';
  const callmebotApikey = settings['callmebot_apikey'] ?? '';
  const autoArchive = settings['auto_archive_expired'] === 'true';
  const batteryAlertPct = settings['battery_alert_pct'] ?? '20';

  const [retentionInput, setRetentionInput] = useState('');
  const [batteryInput, setBatteryInput] = useState('');
  const [webhookInput, setWebhookInput] = useState('');
  const [gaInput, setGaInput] = useState('');
  const [callmebotPhoneInput, setCallmebotPhoneInput] = useState('');
  const [callmebotApikeyInput, setCallmebotApikeyInput] = useState('');
  const [apkFile, setApkFile] = useState<File | null>(null);
  const [apkVersionCode, setApkVersionCode] = useState('');
  const [apkVersionName, setApkVersionName] = useState('');
  const [uploadingApk, setUploadingApk] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local form inputs from loaded settings, not a compiler target
    setRetentionInput(settings['metrics_retention_days'] ?? '90');
    setBatteryInput(settings['battery_alert_pct'] ?? '20');
    setWebhookInput(settings['webhook_url'] ?? '');
    setGaInput(settings['ga_measurement_id'] ?? '');
    setCallmebotPhoneInput(settings['callmebot_phone'] ?? '');
    setCallmebotApikeyInput(settings['callmebot_apikey'] ?? '');
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
                onWheel={(e) => e.currentTarget.blur()}
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

          {/* Alerta de batería baja */}
          <div className="card p-6">
            <h2 className="font-semibold mb-1">Alerta de batería baja</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              Se avisa (syslog + webhook + WhatsApp) cuando una tablet online baja de este nivel, para hablar con el taxista y que la enchufe. Se rearma cuando la batería sube {Number(batteryInput || 20) + 10}%.
            </p>
            <div className="flex gap-3 items-center">
              <input
                type="number"
                min="5"
                max="90"
                className="input w-28"
                value={batteryInput}
                onChange={(e) => setBatteryInput(e.target.value)}
                onWheel={(e) => e.currentTarget.blur()}
              />
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>% de batería</span>
              <button
                onClick={() => save('battery_alert_pct', batteryInput)}
                disabled={saving === 'battery_alert_pct' || batteryInput === batteryAlertPct}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium"
              >
                {saving === 'battery_alert_pct' ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>

          {/* Brillo por horario solar */}
          <BrightnessScheduleCard
            value={settings['brightness_schedule']}
            saving={saving === 'brightness_schedule'}
            onSave={(json) => save('brightness_schedule', json)}
          />

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

          {/* #48 — Google Analytics GA4 */}
          <div className="card p-6">
            <h2 className="font-semibold mb-1">Google Analytics 4</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              Measurement ID de GA4 (ej: G-XXXXXXXXXX). Dejar vacío para deshabilitar el tracking.
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                className="input flex-1"
                placeholder="G-XXXXXXXXXX"
                value={gaInput}
                onChange={(e) => setGaInput(e.target.value)}
              />
              <button
                onClick={() => save('ga_measurement_id', gaInput)}
                disabled={saving === 'ga_measurement_id' || gaInput === gaId}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium"
              >
                {saving === 'ga_measurement_id' ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>

          {/* #53 + #61 — WhatsApp via CallMeBot */}
          <div className="card p-6">
            <h2 className="font-semibold mb-1">WhatsApp — alertas via CallMeBot</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              Envía WhatsApp al número configurado cuando: (1) una tablet lleva más de 2h offline, (2) una campaña vence hoy.
              Antes de configurar, enviá &quot;I allow callmebot to send me messages&quot; al +34644605090 en WhatsApp.
            </p>
            <div className="space-y-3">
              <div className="flex gap-3">
                <input
                  type="text"
                  className="input flex-1"
                  placeholder="Teléfono internacional (ej: 59899123456)"
                  value={callmebotPhoneInput}
                  onChange={(e) => setCallmebotPhoneInput(e.target.value)}
                />
                <button
                  onClick={() => save('callmebot_phone', callmebotPhoneInput)}
                  disabled={saving === 'callmebot_phone' || callmebotPhoneInput === callmebotPhone}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium"
                >
                  {saving === 'callmebot_phone' ? 'Guardando...' : 'Guardar teléfono'}
                </button>
              </div>
              <div className="flex gap-3">
                <input
                  type="text"
                  className="input flex-1"
                  placeholder="API Key de CallMeBot"
                  value={callmebotApikeyInput}
                  onChange={(e) => setCallmebotApikeyInput(e.target.value)}
                />
                <button
                  onClick={() => save('callmebot_apikey', callmebotApikeyInput)}
                  disabled={saving === 'callmebot_apikey' || callmebotApikeyInput === callmebotApikey}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium"
                >
                  {saving === 'callmebot_apikey' ? 'Guardando...' : 'Guardar API key'}
                </button>
              </div>
            </div>
          </div>

          {/* #4 — Auto-archive expired campaigns */}
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold mb-1">Auto-archivar campañas vencidas</h2>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Archiva automáticamente cada 24h las campañas cuya fecha de fin ya pasó. Se pueden restaurar desde la página Archivo.
                </p>
              </div>
              <button
                onClick={() => save('auto_archive_expired', autoArchive ? 'false' : 'true')}
                disabled={saving === 'auto_archive_expired'}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${autoArchive ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoArchive ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>

          {/* Auto-actualización de la APK Android */}
          <div className="card p-6">
            <h2 className="font-semibold mb-1">Actualización de la app Android</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              Al subir un APK nuevo, todas las tablets lo detectan solas en su próximo sync, lo descargan por WiFi
              y muestran el diálogo de instalación de Android — solo hace falta tocar &quot;Instalar&quot; una vez por tablet
              (la primera vez, además, hay que habilitar &quot;Instalar apps desconocidas&quot; para esta app en cada tablet).
            </p>
            {settings['apk_version_code'] && (
              <p className="text-sm mb-4">
                Versión publicada actual: <span className="font-medium">v{settings['apk_version_name']}</span>
                {' '}(código {settings['apk_version_code']})
              </p>
            )}
            <div className="space-y-3">
              <input
                type="file"
                accept=".apk"
                className="input"
                onChange={(e) => setApkFile(e.target.files?.[0] ?? null)}
              />
              <div className="flex gap-3">
                <input
                  type="number"
                  min="1"
                  className="input w-40"
                  placeholder="versionCode"
                  value={apkVersionCode}
                  onChange={(e) => setApkVersionCode(e.target.value)}
                  onWheel={(e) => e.currentTarget.blur()}
                />
                <input
                  type="text"
                  className="input flex-1"
                  placeholder="versionName (ej: 1.6)"
                  value={apkVersionName}
                  onChange={(e) => setApkVersionName(e.target.value)}
                />
                <button
                  onClick={handleUploadApk}
                  disabled={uploadingApk}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium whitespace-nowrap"
                >
                  {uploadingApk ? 'Subiendo...' : 'Publicar APK'}
                </button>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                versionCode y versionName tienen que coincidir con los que pusiste en app/build.gradle.kts al compilar.
              </p>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

function parseSchedule(value: string | undefined): SchedulePoint[] {
  if (!value) return DEFAULT_SCHEDULE;
  try {
    const arr = JSON.parse(value)?.points;
    if (!Array.isArray(arr) || arr.length < 2) return DEFAULT_SCHEDULE;
    return arr.map((p: { ref: string; offsetMin: number; pct: number }) => ({
      ref: p.ref === 'sunset' ? 'sunset' : 'sunrise',
      offsetMin: Math.round(Number(p.offsetMin) || 0),
      pct: Math.max(0, Math.min(100, Math.round(Number(p.pct) || 0))),
    }));
  } catch {
    return DEFAULT_SCHEDULE;
  }
}

function BrightnessScheduleCard({ value, saving, onSave }: {
  value: string | undefined; saving: boolean; onSave: (json: string) => Promise<void>;
}) {
  const [pts, setPts] = useState<SchedulePoint[]>(() => parseSchedule(value));
  const sun = useMemo(() => sunTimes(new Date()), []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resync local editor when saved value changes
    setPts(parseSchedule(value));
  }, [value]);

  const set = (i: number, patch: Partial<SchedulePoint>) =>
    setPts((cur) => cur.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const addRow = () => setPts((cur) => [...cur, { ref: 'sunset', offsetMin: 0, pct: 50 }]);
  const delRow = (i: number) => setPts((cur) => cur.filter((_, idx) => idx !== i));
  const dirty = JSON.stringify({ points: pts }) !== JSON.stringify({ points: parseSchedule(value) });

  // Curva de hoy, cada 30 min.
  const preview = Array.from({ length: 48 }, (_, k) => {
    const min = k * 30;
    return { min, pct: brightnessAt(min, pts, sun) };
  });

  return (
    <div className="card p-6">
      <h2 className="font-semibold mb-1">Brillo por horario solar</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
        Las tablets no tienen sensor de luz, así que el brillo sigue el amanecer y el atardecer reales de Montevideo (se calculan en cada tablet).
        Cada punto es relativo a uno de esos dos eventos; entre puntos el brillo cambia gradual. Aplica sólo con el brillo en modo automático.
      </p>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Hoy en Montevideo: <b>amanecer {fmtMin(sun.sunriseMin)}</b> · <b>atardecer {fmtMin(sun.sunsetMin)}</b>.
      </p>

      {/* Preview 24 h */}
      <div className="mb-1 flex items-end gap-px h-16">
        {preview.map((p) => (
          <div key={p.min} className="flex-1 rounded-t" title={`${fmtMin(p.min)} → ${Math.round(p.pct)}%`}
            style={{ height: `${Math.max(p.pct, 3)}%`, background: '#3b82f6', opacity: 0.3 + 0.7 * (p.pct / 100) }} />
        ))}
      </div>
      <div className="flex justify-between text-[10px] mb-4" style={{ color: 'var(--text-xs)' }}>
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
      </div>

      <div className="space-y-2">
        {pts.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select className="input w-32" value={p.ref} onChange={(e) => set(i, { ref: e.target.value as SchedulePoint['ref'] })}>
              <option value="sunrise">Amanecer</option>
              <option value="sunset">Atardecer</option>
            </select>
            <div className="flex items-center gap-1">
              <input type="number" step={5} className="input w-24 text-right" value={p.offsetMin}
                onChange={(e) => set(i, { offsetMin: Math.round(Number(e.target.value) || 0) })}
                onWheel={(e) => e.currentTarget.blur()} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>min (− antes / + después)</span>
            </div>
            <div className="flex items-center gap-1">
              <input type="number" min={0} max={100} className="input w-20 text-right" value={p.pct}
                onChange={(e) => set(i, { pct: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })}
                onWheel={(e) => e.currentTarget.blur()} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>% brillo</span>
            </div>
            <span className="text-xs tabular-nums" style={{ color: 'var(--text-xs)' }}>
              ≈ {fmtMin((p.ref === 'sunset' ? sun.sunsetMin : sun.sunriseMin) + p.offsetMin)}
            </span>
            <button onClick={() => delRow(i)} disabled={pts.length <= 2}
              className="text-red-500 hover:underline text-xs disabled:opacity-30 ml-auto">Quitar</button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <button onClick={addRow} className="text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: 'var(--border-md)' }}>
          + Agregar punto
        </button>
        <button onClick={() => setPts(DEFAULT_SCHEDULE)} className="text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: 'var(--border-md)' }}>
          Restaurar valores por defecto
        </button>
        <button
          onClick={() => onSave(JSON.stringify({ points: pts }))}
          disabled={saving || !dirty}
          className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium ml-auto">
          {saving ? 'Guardando...' : 'Guardar tabla'}
        </button>
      </div>
    </div>
  );
}
