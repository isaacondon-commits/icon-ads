'use client';

import { useEffect, useState } from 'react';
import { api, Tablet, TabletDetail, SyncLog } from '@/lib/api';

interface TabletData {
  detail: TabletDetail;
  uptimePct7d: number;
  syncs: SyncLog[];
}

function StatRow({ label, a, b, format = (v: unknown) => String(v) }: {
  label: string;
  a: unknown;
  b: unknown;
  format?: (v: unknown) => string;
}) {
  return (
    <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
      <td className="px-4 py-3 text-xs font-medium w-36" style={{ color: 'var(--text-muted)' }}>{label}</td>
      <td className="px-4 py-3 text-sm font-medium text-center">{a != null ? format(a) : '—'}</td>
      <td className="px-4 py-3 text-sm font-medium text-center">{b != null ? format(b) : '—'}</td>
    </tr>
  );
}

export default function TabletComparePage() {
  const [tablets, setTablets] = useState<Tablet[]>([]);
  const [idA, setIdA] = useState('');
  const [idB, setIdB] = useState('');
  const [dataA, setDataA] = useState<TabletData | null>(null);
  const [dataB, setDataB] = useState<TabletData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.getTablets().then(setTablets).catch(() => {}); }, []);

  const loadTablet = async (id: number): Promise<TabletData> => {
    const [detail, history] = await Promise.all([
      api.getTablet(id),
      api.getSyncHistory(id),
    ]);
    return { detail, uptimePct7d: history.uptimePct7d, syncs: history.syncs };
  };

  const compare = async () => {
    if (!idA || !idB || idA === idB) return;
    setLoading(true);
    setDataA(null); setDataB(null);
    try {
      const [a, b] = await Promise.all([loadTablet(Number(idA)), loadTablet(Number(idB))]);
      setDataA(a); setDataB(b);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const now = Date.now();
  const isOnline = (t: TabletDetail) => t.lastSync ? (now - new Date(t.lastSync).getTime()) < 10 * 60000 : false;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Comparar tablets</h1>

      <div className="card p-6 mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Tablet A</label>
            <select className="input w-52" value={idA} onChange={(e) => setIdA(e.target.value)}>
              <option value="">Seleccionar...</option>
              {tablets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Tablet B</label>
            <select className="input w-52" value={idB} onChange={(e) => setIdB(e.target.value)}>
              <option value="">Seleccionar...</option>
              {tablets.filter((t) => t.id.toString() !== idA).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <button
            onClick={compare}
            disabled={!idA || !idB || idA === idB || loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium"
          >
            {loading ? 'Cargando...' : 'Comparar'}
          </button>
        </div>
      </div>

      {dataA && dataB && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ background: 'var(--bg)', borderColor: 'var(--border-md)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium w-36" style={{ color: 'var(--text-muted)' }}>Métrica</th>
                <th className="px-4 py-3 text-center font-semibold">{dataA.detail.name}</th>
                <th className="px-4 py-3 text-center font-semibold">{dataB.detail.name}</th>
              </tr>
            </thead>
            <tbody>
              <StatRow label="Estado" a={isOnline(dataA.detail) ? 'online' : 'offline'} b={isOnline(dataB.detail) ? 'online' : 'offline'} />
              <StatRow label="Plays hoy" a={dataA.detail.playsToday} b={dataB.detail.playsToday} />
              <StatRow label="Total histórico" a={dataA.detail.playsAllTime} b={dataB.detail.playsAllTime} format={(v) => Number(v).toLocaleString()} />
              <StatRow label="Uptime 7d" a={dataA.uptimePct7d} b={dataB.uptimePct7d} format={(v) => `${v}%`} />
              <StatRow label="Batería" a={dataA.detail.batteryLevel} b={dataB.detail.batteryLevel} format={(v) => `${v}%`} />
              <StatRow label="Temperatura" a={dataA.detail.temperatureC} b={dataB.detail.temperatureC} format={(v) => `${(v as number).toFixed(1)}°C`} />
              <StatRow label="APK" a={dataA.detail.appVersion} b={dataB.detail.appVersion} />
              <StatRow label="Zona" a={dataA.detail.zone} b={dataB.detail.zone} />
              <StatRow label="Playlist" a={dataA.detail.playlist?.name} b={dataB.detail.playlist?.name} />
              <StatRow label="Última sync" a={dataA.detail.lastSync} b={dataB.detail.lastSync} format={(v) => new Date(v as string).toLocaleString('es-AR')} />
              <StatRow label="Total syncs" a={dataA.syncs.length} b={dataB.syncs.length} format={(v) => `${v} (últimas 50)`} />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
