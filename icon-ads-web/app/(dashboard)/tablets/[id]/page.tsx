'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, TabletDetail, SyncLog, PlaylistVersion, Playlist, BASE } from '@/lib/api';
import { useToast } from '@/lib/toast-context';
import ConfirmDialog from '@/components/ConfirmDialog';
import RefreshButton from '@/components/RefreshButton';
import ScreenshotViewer from '@/components/ScreenshotViewer';

type Tab = 'errors' | 'sync' | 'playlist';

const TIMEZONES = ['America/Montevideo', 'America/Argentina/Buenos_Aires', 'America/Sao_Paulo', 'UTC'];

function fmtDur(min: number): string {
  if (!min || min < 1) return '0m';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export default function TabletDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { show } = useToast();
  const [tablet, setTablet] = useState<TabletDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('sync');
  const [syncs, setSyncs] = useState<SyncLog[]>([]);
  const [uptimePct7d, setUptimePct7d] = useState<number | null>(null);
  const [loadingSync, setLoadingSync] = useState(false);
  const [playlistVersions, setPlaylistVersions] = useState<PlaylistVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [togglingBlock, setTogglingBlock] = useState(false);
  const [waking, setWaking] = useState(false);
  const [forcingSync, setForcingSync] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editErr, setEditErr] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [form, setForm] = useState({
    name: '', zone: '', playlistId: '', timezone: 'America/Montevideo', scheduleAt: '',
    notes: '', maintenanceUntil: '', driverName: '', licensePlate: '', spotPrice: '',
    manualStatus: 'activa', rotated180: false,
  });

  const load = () => api.getTablet(Number(id)).then(setTablet).catch(() => router.push('/monitor')).finally(() => setLoading(false));
  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
      const { syncs: s, uptimePct7d: u } = await api.getSyncHistory(Number(id));
      setSyncs(s); setUptimePct7d(u);
    } catch { /* ignore */ } finally { setRefreshing(false); }
  };

  useEffect(() => {
    load();
    api.getPlaylists().then(setPlaylists).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, router]);

  useEffect(() => {
    if (!tablet) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch when tablet id changes, not a compiler target
    setLoadingSync(true);
    api.getSyncHistory(tablet.id)
      .then(({ syncs: s, uptimePct7d: u }) => { setSyncs(s); setUptimePct7d(u); })
      .catch(() => {})
      .finally(() => setLoadingSync(false));
    // Narrowed to tablet.id on purpose — only re-fetch when the tablet identity changes, not on every field update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablet?.id]);

  useEffect(() => {
    if (tab !== 'playlist' || !tablet?.playlistId || playlistVersions.length > 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch when the playlist tab is opened, not a compiler target
    setLoadingVersions(true);
    api.getPlaylistVersions(tablet.playlistId)
      .then(setPlaylistVersions)
      .catch(() => {})
      .finally(() => setLoadingVersions(false));
  }, [tab, tablet?.playlistId, playlistVersions.length]);

  const handleResync = async () => {
    if (!tablet) return;
    setResyncing(true);
    try {
      const res = await api.resyncTablet(tablet.id);
      show(res.message, res.hasPlaylist ? 'success' : 'error');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al forzar la re-descarga', 'error');
    } finally { setResyncing(false); }
  };

  const handleForceSync = async () => {
    if (!tablet) return;
    setForcingSync(true);
    try {
      const res = await api.forceSync(tablet.id);
      show(res.message);
    } catch (e) {
      show(e instanceof Error ? `Error: ${e.message}` : 'Error al forzar sync', 'error');
    } finally { setForcingSync(false); }
  };

  const openEdit = () => {
    if (!tablet) return;
    setForm({
      name: tablet.name,
      zone: tablet.zone ?? '',
      playlistId: tablet.playlistId?.toString() ?? '',
      timezone: tablet.timezone ?? 'America/Montevideo',
      scheduleAt: tablet.scheduleAt ? tablet.scheduleAt.slice(0, 16) : '',
      notes: tablet.notes ?? '',
      maintenanceUntil: tablet.maintenanceUntil ? tablet.maintenanceUntil.slice(0, 16) : '',
      driverName: tablet.driverName ?? '',
      licensePlate: tablet.licensePlate ?? '',
      spotPrice: tablet.spotPrice != null ? String(tablet.spotPrice) : '',
      manualStatus: tablet.manualStatus ?? 'activa',
      rotated180: tablet.rotated180 ?? false,
    });
    setEditErr('');
    setShowEdit(true);
  };

  const handleSave = async () => {
    if (!tablet) return;
    setSaving(true); setEditErr('');
    try {
      await api.updateTablet(tablet.id, {
        name: form.name,
        zone: form.zone || undefined,
        timezone: form.timezone || undefined,
        playlistId: form.playlistId ? Number(form.playlistId) : null,
        scheduleAt: form.scheduleAt ? new Date(form.scheduleAt).toISOString() : null,
        notes: form.notes || null,
        maintenanceUntil: form.maintenanceUntil ? new Date(form.maintenanceUntil).toISOString() : null,
        driverName: form.driverName || null,
        licensePlate: form.licensePlate || null,
        spotPrice: form.spotPrice ? Number(form.spotPrice) : null,
        manualStatus: form.manualStatus as 'activa' | 'mantenimiento' | 'bloqueada',
        rotated180: form.rotated180,
      });
      setShowEdit(false);
      await load();
      show('Tablet actualizada');
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Error');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!tablet) return;
    try {
      await api.deleteTablet(tablet.id);
      show('Tablet eliminada', 'info');
      router.push('/monitor');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al eliminar', 'error');
      setShowDelete(false);
    }
  };

  const handleToggleBlock = async () => {
    if (!tablet) return;
    const blocking = tablet.manualStatus !== 'bloqueada';
    setTogglingBlock(true);
    try {
      const res = await api.blockTablet(tablet.id, blocking);
      show(res.message);
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al cambiar el estado', 'error');
    } finally { setTogglingBlock(false); }
  };

  const handleWake = async () => {
    if (!tablet) return;
    setWaking(true);
    try {
      const res = await api.wakeTablet(tablet.id);
      show(res.message);
    } catch (e) {
      show(e instanceof Error ? e.message : 'No se pudo enviar la orden de encendido', 'error');
    } finally { setWaking(false); }
  };

  // Desde el Monitor, "Editar" llega con ?editar=1: abrir el formulario directo.
  useEffect(() => {
    if (!tablet) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('editar') !== '1') return;
    params.delete('editar');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- abre el modal una vez al llegar con ?editar=1
    openEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablet?.id]);

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>;
  if (!tablet) return null;

  // eslint-disable-next-line react-hooks/purity -- online status reads wall-clock time; no React Compiler in use, no SSR of this data
  const now = Date.now();
  const lastSyncMs = tablet.lastSync ? new Date(tablet.lastSync).getTime() : 0;
  const offlineMin = lastSyncMs ? Math.floor((now - lastSyncMs) / 60000) : null;
  const isOnline = offlineMin !== null && offlineMin < 70;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => router.back()} className="text-sm hover:underline flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
          ← Volver
        </button>
        <RefreshButton onClick={refresh} loading={refreshing} />
      </div>

      {/* Header card */}
      <div className="card p-6 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5 mb-1">
              <span className={`w-3 h-3 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-gray-400'}`} />
              <h1 className="text-2xl font-bold">{tablet.name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isOnline
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300'}`}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
              {tablet.manualStatus === 'bloqueada' && (
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  🔒 Bloqueada — no muestra publicidad
                </span>
              )}
              {isOnline && (tablet.playerOk === false || tablet.onFallback === true) && (
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                  {tablet.onFallback === true
                    ? 'No cargó su playlist (mostrando respaldo)'
                    : `No reproduce${tablet.lastAdAgoS != null ? ` (hace ${Math.round(tablet.lastAdAgoS / 60)} min)` : ''}`}
                </span>
              )}
            </div>
            <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{tablet.deviceId}</p>
          </div>
        </div>

        {/* Acciones: todas a la vista, mismo estilo que Anuncios / Monitor */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ScreenshotViewer tabletId={tablet.id} tabletName={tablet.name} pill />
          <ActionButton icon="power" tone="blue" onClick={handleWake} disabled={waking}
            title="Enciende la pantalla y trae el player al frente aunque el auto esté sin contacto (necesita señal / datos móviles)">
            {waking ? 'Enviando…' : 'Prender pantalla'}
          </ActionButton>
          <ActionButton icon="sync" onClick={handleForceSync} disabled={forcingSync} title="Fuerza a la tablet a sincronizar ahora">
            {forcingSync ? 'Sincronizando…' : 'Forzar sync'}
          </ActionButton>
          {isOnline && (tablet.playerOk === false || tablet.onFallback === true) && tablet.playlistId && (
            <ActionButton icon="download" tone="amber" onClick={handleResync} disabled={resyncing}
              title="Fuerza a la tablet a volver a descargar su playlist ahora">
              {resyncing ? 'Forzando…' : 'Forzar re-descarga'}
            </ActionButton>
          )}
          {tablet.manualStatus === 'bloqueada' ? (
            <ActionButton icon="unlock" tone="emerald" onClick={handleToggleBlock} disabled={togglingBlock} title="Vuelve a mostrar publicidad ahora">
              {togglingBlock ? 'Desbloqueando…' : 'Desbloquear'}
            </ActionButton>
          ) : (
            <ActionButton icon="lock" tone="amber" onClick={handleToggleBlock} disabled={togglingBlock} title="Frena la publicidad sin desarmar el kiosco">
              {togglingBlock ? 'Aplicando…' : 'Bloquear'}
            </ActionButton>
          )}
          <ActionButton icon="edit" onClick={openEdit}>Editar</ActionButton>
          <div className="ml-auto">
            <ActionButton icon="trash" tone="red" onClick={() => setShowDelete(true)} title="Elimina la tablet del sistema">Eliminar</ActionButton>
          </div>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t" style={{ borderColor: 'var(--border-md)' }}>
          {[
            { label: 'Zona', value: tablet.zone || '—' },
            { label: 'Timezone', value: tablet.timezone || '—' },
            { label: 'Playlist', value: tablet.playlist?.name || '—' },
            { label: 'Versión', value: tablet.playlist ? `v${tablet.playlist.version}` : '—' },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-xs mb-0.5" style={{ color: 'var(--text-xs)' }}>{s.label}</p>
              <p className="font-medium text-sm">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-md)' }}>
          <div>
            <p className="text-2xl font-bold">{tablet.playsToday}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Reproducciones hoy</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{tablet.playsAllTime.toLocaleString()}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Total histórico</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{tablet.lastSync ? new Date(tablet.lastSync).toLocaleString('es-AR') : 'Nunca'}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Última sincronía</p>
          </div>
          <div>
            <p className={`text-2xl font-bold ${uptimePct7d !== null ? (uptimePct7d >= 80 ? 'text-emerald-600' : uptimePct7d >= 50 ? 'text-amber-500' : 'text-red-500') : ''}`}>
              {uptimePct7d !== null ? `${uptimePct7d}%` : '—'}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Uptime 7 días</p>
          </div>
          <div title="Tiempo que el taxi estuvo parado hoy, estimado del rastro GPS">
            <p className="text-2xl font-bold">{fmtDur(tablet.standbyToday?.standbyMinutes ?? 0)}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Standby hoy
              {tablet.standbyToday?.segments?.length ? ` · ${tablet.standbyToday.segments.length} paradas` : ''}
            </p>
          </div>
        </div>

        {/* Extra info */}
        {(tablet.batteryLevel != null || tablet.temperatureC != null || tablet.appVersion || tablet.lastIp || tablet.osVersion || tablet.deviceModel || tablet.brightness != null || tablet.serial) && (
          <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t text-xs" style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}>
            {tablet.batteryLevel != null && (
              <span className={`font-medium ${tablet.batteryLevel <= 20 ? 'text-red-500' : tablet.batteryLevel <= 50 ? 'text-amber-500' : 'text-emerald-600'}`}>
                Batería: {tablet.batteryLevel}%
              </span>
            )}
            {tablet.brightness != null && (
              <span className={tablet.brightnessAuto === false ? 'text-amber-500 font-medium' : ''}
                title={tablet.brightnessAuto === false ? 'El brillo está en manual — debería estar en automático' : 'Brillo en automático'}>
                Brillo: {tablet.brightness}% {tablet.brightnessAuto === false ? '(MANUAL)' : tablet.brightnessAuto ? '(auto)' : ''}
                {tablet.lux != null && ` · ${Math.round(tablet.lux)} lx`}
              </span>
            )}
            {tablet.lightSensor === false && (
              <span className="text-red-500 font-medium" title="La tablet no tiene sensor de luz — el brillo automático no puede adaptar, queda al máximo">
                Sin sensor de luz
              </span>
            )}
            {tablet.serial && <span className="font-mono" title="Nº de serie del hardware — identifica la tablet física">SN: {tablet.serial}</span>}
            {tablet.temperatureC != null && <span>Temp: {tablet.temperatureC.toFixed(1)}°C</span>}
            {tablet.appVersion && <span className="font-mono">APK: {tablet.appVersion}</span>}
            {tablet.lastIp && <span className="font-mono" title="Última IP registrada al sincronizar">IP: {tablet.lastIp}</span>}
            {/* #2 — OS/device model */}
            {tablet.deviceModel && <span className="font-mono">{tablet.deviceModel}</span>}
            {tablet.osVersion && <span>Android {tablet.osVersion}</span>}
          </div>
        )}
      </div>

      {/* QR code card */}
      <div className="card p-6 mb-6 flex items-start gap-6">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${BASE}/api/tablets/${tablet.id}/qr`} alt="QR Code" width={150} height={150} className="rounded-lg border" style={{ borderColor: 'var(--border-md)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold mb-1">Código QR de registro</h2>
          <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
            Escaneá este código desde la app Android para registrar la tablet automáticamente.
          </p>
          <a href={`${BASE}/api/tablets/${tablet.id}/qr`} download={`qr-${tablet.deviceId}.png`}
            className="inline-block text-xs border px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
            style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}>
            ↓ Descargar PNG
          </a>
        </div>
      </div>

      {/* Tabbed log section */}
      <div className="card overflow-hidden">
        <div className="flex border-b" style={{ borderColor: 'var(--border-md)' }}>
          {(['sync', 'errors', 'playlist'] as Tab[]).map((t) => {
            const label =
              t === 'sync' ? `Historial de sync (${syncs.length})`
              : t === 'errors' ? `Errores (${tablet.errorLogs.length})`
              : 'Historial playlist';
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent'}`}
                style={tab !== t ? { color: 'var(--text-muted)' } : undefined}
              >
                {label}
              </button>
            );
          })}
        </div>

        {tab === 'sync' && (
          loadingSync ? (
            <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
          ) : syncs.length === 0 ? (
            <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Sin registros de sincronización aún.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ background: 'var(--bg)', borderColor: 'var(--border-md)' }}>
                  {['Estado', 'Versión local', 'Fecha'].map((h) => (
                    <th key={h} className="text-left px-5 py-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {syncs.map((s) => (
                  <tr key={s.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-5 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.success ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-700'}`}>
                        {s.success ? 'OK' : 'Error'}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>v{s.version}</td>
                    <td className="px-5 py-2.5 text-xs" style={{ color: 'var(--text-xs)' }}>
                      {new Date(s.createdAt).toLocaleString('es-AR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === 'errors' && (
          tablet.errorLogs.length === 0 ? (
            <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Sin errores registrados.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ background: 'var(--bg)', borderColor: 'var(--border-md)' }}>
                  <th className="text-left px-5 py-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Tipo</th>
                  <th className="text-left px-5 py-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Mensaje</th>
                  <th className="text-left px-5 py-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {tablet.errorLogs.map((e) => (
                  <tr key={e.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-5 py-2.5">
                      <span className="text-xs bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 px-2 py-0.5 rounded font-mono">{e.errorType}</span>
                    </td>
                    <td className="px-5 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{e.message}</td>
                    <td className="px-5 py-2.5 text-xs" style={{ color: 'var(--text-xs)' }}>
                      {new Date(e.occurredAt).toLocaleString('es-AR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === 'playlist' && (
          !tablet.playlistId ? (
            <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Esta tablet no tiene playlist asignada.</p>
          ) : loadingVersions ? (
            <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
          ) : playlistVersions.length === 0 ? (
            <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Sin historial de versiones.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ background: 'var(--bg)', borderColor: 'var(--border-md)' }}>
                  {['Versión', 'Anuncios', 'Fecha'].map((h) => (
                    <th key={h} className="text-left px-5 py-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {playlistVersions.map((v) => (
                  <tr key={v.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-5 py-2.5 font-mono text-xs">
                      v{v.version}
                      {v.snapshot.revertedFrom != null && (
                        <span className="ml-1.5 text-xs px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-sans">
                          revert de v{v.snapshot.revertedFrom}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {v.snapshot.ads.length} anuncio{v.snapshot.ads.length !== 1 ? 's' : ''}
                    </td>
                    <td className="px-5 py-2.5 text-xs" style={{ color: 'var(--text-xs)' }}>
                      {new Date(v.createdAt).toLocaleString('es-AR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      {showDelete && (
        <ConfirmDialog title="Eliminar tablet" message={`¿Eliminar "${tablet.name}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar" onConfirm={handleDelete} onCancel={() => setShowDelete(false)} />
      )}

      {showEdit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" style={{ background: 'var(--card)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">Editar tablet</h2>
              <button onClick={() => setShowEdit(false)} className="text-xl leading-none" style={{ color: 'var(--text-muted)' }} title="Cerrar">×</button>
            </div>
            <div className="space-y-4">
              <Field label="Nombre"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Zona (opcional)"><input className="input" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} placeholder="Planta baja" /></Field>
              <Field label="Zona horaria">
                <select className="input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </Field>
              <Field label="Playlist (opcional)">
                <select className="input" value={form.playlistId} onChange={(e) => setForm({ ...form, playlistId: e.target.value })}>
                  <option value="">Sin playlist</option>
                  {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Programar activación (opcional)">
                <input type="datetime-local" className="input" value={form.scheduleAt} onChange={(e) => setForm({ ...form, scheduleAt: e.target.value })} />
              </Field>
              <Field label="Mantenimiento hasta (opcional)">
                <input type="datetime-local" className="input" value={form.maintenanceUntil} onChange={(e) => setForm({ ...form, maintenanceUntil: e.target.value })} />
              </Field>
              <Field label="Notas (opcional)">
                <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Observaciones internas..." style={{ resize: 'vertical' }} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Conductor (opcional)">
                  <input className="input" value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} placeholder="Nombre del conductor" />
                </Field>
                <Field label="Patente (opcional)">
                  <input className="input" value={form.licensePlate} onChange={(e) => setForm({ ...form, licensePlate: e.target.value })} placeholder="ABC 1234" />
                </Field>
              </div>
              <Field label="Precio por spot (USD, opcional)">
                <input type="number" min="0" step="0.01" className="input" value={form.spotPrice} onChange={(e) => setForm({ ...form, spotPrice: e.target.value })} onWheel={(e) => e.currentTarget.blur()} placeholder="0.00" />
              </Field>
              <Field label="Estado operativo">
                <select className="input" value={form.manualStatus} onChange={(e) => setForm({ ...form, manualStatus: e.target.value })}>
                  <option value="activa">Activa</option>
                  <option value="mantenimiento">En mantenimiento</option>
                  <option value="bloqueada">Bloqueada (kiosco)</option>
                </select>
              </Field>
              <Field label="Pantalla">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.rotated180} onChange={(e) => setForm({ ...form, rotated180: e.target.checked })} />
                  Voltear 180° extra (ajuste manual para montajes planos)
                </label>
              </Field>
              {editErr && <p className="text-red-600 text-sm">{editErr}</p>}
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 rounded-lg text-sm font-medium">
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
                <button onClick={() => setShowEdit(false)} className="flex-1 border hover:bg-gray-50 dark:hover:bg-gray-800 py-2 rounded-lg text-sm" style={{ borderColor: 'var(--border-md)' }}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  );
}

const ACTION_ICONS = {
  power: 'M12 3v8M6.3 7.3a8 8 0 1 0 11.4 0',
  sync: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
} as const;

const ACTION_TONES = {
  neutral: 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700',
  blue: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50',
  amber: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50',
  red: 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40',
} as const;

function ActionButton({ icon, tone = 'neutral', onClick, disabled, title, children }: {
  icon: keyof typeof ACTION_ICONS; tone?: keyof typeof ACTION_TONES;
  onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-40 ${ACTION_TONES[tone]}`}
      style={tone === 'neutral' ? { borderColor: 'var(--border-md)' } : undefined}>
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={ACTION_ICONS[icon]} />
      </svg>
      {children}
    </button>
  );
}
