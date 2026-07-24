'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, TabletDetail, SyncLog, PlaylistVersion, BASE } from '@/lib/api';
import { useToast } from '@/lib/toast-context';
import ConfirmDialog from '@/components/ConfirmDialog';

type Tab = 'errors' | 'sync' | 'playlist';

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
  const [msgText, setMsgText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [showMsgModal, setShowMsgModal] = useState(false);
  const [playlistVersions, setPlaylistVersions] = useState<PlaylistVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    api.getTablet(Number(id))
      .then(setTablet)
      .catch(() => router.push('/tablets'))
      .finally(() => setLoading(false));
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

  const handleSendMessage = async () => {
    if (!tablet || !msgText.trim()) return;
    setSendingMsg(true);
    try {
      await api.sendTabletMessage(tablet.id, msgText.trim());
      show('Mensaje enviado — aparecerá en la tablet en el próximo ciclo');
      setShowMsgModal(false);
      setMsgText('');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al enviar', 'error');
    } finally { setSendingMsg(false); }
  };

  const handleRegenerateToken = async () => {
    if (!tablet) return;
    setRegenerating(true);
    try {
      const res = await api.regenerateTabletToken(tablet.id);
      show(res.message);
      setShowRegenConfirm(false);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al regenerar token', 'error');
    } finally { setRegenerating(false); }
  };

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>;
  if (!tablet) return null;

  // eslint-disable-next-line react-hooks/purity -- online status reads wall-clock time; no React Compiler in use, no SSR of this data
  const now = Date.now();
  const lastSyncMs = tablet.lastSync ? new Date(tablet.lastSync).getTime() : 0;
  const offlineMin = lastSyncMs ? Math.floor((now - lastSyncMs) / 60000) : null;
  const isOnline = offlineMin !== null && offlineMin < 70;

  return (
    <div>
      <button onClick={() => router.back()} className="text-sm mb-4 hover:underline flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
        ← Volver
      </button>

      {/* Header card */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className={`w-3 h-3 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-gray-400'}`} />
              <h1 className="text-2xl font-bold">{tablet.name}</h1>
            </div>
            <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{tablet.deviceId}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
              {isOnline ? 'online' : 'offline'}
            </span>
            <button
              onClick={() => setShowMsgModal(true)}
              className="text-xs px-3 py-1.5 rounded-lg border font-medium hover:bg-blue-50 dark:hover:bg-blue-950 text-blue-600 border-blue-200"
            >
              Enviar mensaje
            </button>
            <button
              onClick={() => setShowRegenConfirm(true)}
              title="Invalida el token actual — usar si la tablet se perdió o robó"
              className="text-xs px-3 py-1.5 rounded-lg border font-medium hover:bg-red-50 dark:hover:bg-red-950 text-red-600 border-red-200"
            >
              Regenerar token
            </button>
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-md)' }}>
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
        </div>

        {/* Extra info */}
        {(tablet.batteryLevel != null || tablet.temperatureC != null || tablet.appVersion || tablet.lastIp || tablet.osVersion || tablet.deviceModel) && (
          <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t text-xs" style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}>
            {tablet.batteryLevel != null && (
              <span className={`font-medium ${tablet.batteryLevel <= 20 ? 'text-red-500' : tablet.batteryLevel <= 50 ? 'text-amber-500' : 'text-emerald-600'}`}>
                Batería: {tablet.batteryLevel}%
              </span>
            )}
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
            <div className="overflow-x-auto">
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
            </div>
          )
        )}

        {tab === 'errors' && (
          tablet.errorLogs.length === 0 ? (
            <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Sin errores registrados.</p>
          ) : (
            <div className="overflow-x-auto">
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
            </div>
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
            <div className="overflow-x-auto">
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
            </div>
          )
        )}
      </div>

      {/* Send message modal (#4) */}
      {showMsgModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl shadow-xl w-full max-w-sm p-6" style={{ background: 'var(--card)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Enviar mensaje a {tablet.name}</h2>
              <button onClick={() => setShowMsgModal(false)} className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
            </div>
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              El mensaje aparece como overlay durante 10 segundos en la próxima consulta de la app (cada 5 min).
            </p>
            <textarea
              className="input w-full mb-3"
              rows={3}
              maxLength={200}
              placeholder="Escribe tu mensaje..."
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              style={{ resize: 'none' }}
            />
            <p className="text-xs text-right mb-3" style={{ color: 'var(--text-muted)' }}>{msgText.length}/200</p>
            <div className="flex gap-2">
              <button
                onClick={handleSendMessage}
                disabled={sendingMsg || !msgText.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 rounded-lg text-sm font-medium"
              >
                {sendingMsg ? 'Enviando...' : 'Enviar'}
              </button>
              <button onClick={() => setShowMsgModal(false)} className="flex-1 border py-2 rounded-lg text-sm" style={{ borderColor: 'var(--border-md)' }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showRegenConfirm && (
        <ConfirmDialog
          title="Regenerar token"
          message="El token actual queda inválido de inmediato. La tablet lo va a detectar solo (401 en su próximo sync) y se re-registra sin intervención, siempre que pueda alcanzar el mismo deviceId. Usar si la tablet se perdió, se robó, o sospechás que el token se filtró."
          confirmLabel={regenerating ? 'Regenerando...' : 'Regenerar'}
          onConfirm={handleRegenerateToken}
          onCancel={() => setShowRegenConfirm(false)}
        />
      )}
    </div>
  );
}
