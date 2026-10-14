'use client';

import { useEffect, useState } from 'react';
import PageShell from '@/components/ui/PageShell';
import { Btn, IconBtn } from '@/components/ui/buttons';
import { api, Tablet, TabletDetail, SyncLog } from '@/lib/api';

const MAX_SLOTS = 5;

interface TabletData {
  detail: TabletDetail;
  uptimePct7d: number;
  syncs: SyncLog[];
}

function StatRow({ label, values, format = (v: unknown) => String(v) }: {
  label: string;
  values: unknown[];
  format?: (v: unknown) => string;
}) {
  return (
    <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
      <td className="px-4 py-3 text-xs font-medium w-36" style={{ color: 'var(--text-muted)' }}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className="px-4 py-3 text-sm font-medium text-center">{v != null ? format(v) : '—'}</td>
      ))}
    </tr>
  );
}

export default function TabletComparePage() {
  const [tablets, setTablets] = useState<Tablet[]>([]);
  const [slots, setSlots] = useState<string[]>(['', '']);
  const [data, setData] = useState<TabletData[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.getTablets().then(setTablets).catch(() => {}); }, []);

  const loadTablet = async (id: number): Promise<TabletData> => {
    const [detail, history] = await Promise.all([
      api.getTablet(id),
      api.getSyncHistory(id),
    ]);
    return { detail, uptimePct7d: history.uptimePct7d, syncs: history.syncs };
  };

  const filledSlots = slots.filter((s) => s !== '');
  const canCompare = filledSlots.length >= 2 && filledSlots.length === new Set(filledSlots).size;

  const compare = async () => {
    if (!canCompare) return;
    setLoading(true);
    setData(null);
    try {
      const results = await Promise.all(filledSlots.map((id) => loadTablet(Number(id))));
      setData(results);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const updateSlot = (i: number, value: string) => {
    setSlots((prev) => prev.map((s, si) => (si === i ? value : s)));
  };

  const addSlot = () => { if (slots.length < MAX_SLOTS) setSlots((prev) => [...prev, '']); };
  const removeSlot = (i: number) => { if (slots.length > 2) setSlots((prev) => prev.filter((_, si) => si !== i)); };

  // eslint-disable-next-line react-hooks/purity -- online status reads wall-clock time; no React Compiler in use, no SSR of this data
  const now = Date.now();
  const isOnline = (t: TabletDetail) => t.lastSync ? (now - new Date(t.lastSync).getTime()) < 10 * 60000 : false;

  return (
    <PageShell title="Comparar tablets" subtitle={`Elegí de 2 a ${MAX_SLOTS} tablets y comparalas lado a lado.`}>

      <div className="card p-6 mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          {slots.map((slotId, i) => (
            <div key={i} className="relative">
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Tablet {i + 1}</label>
              <div className="flex items-center gap-1">
                <select className="input w-52" value={slotId} onChange={(e) => updateSlot(i, e.target.value)}>
                  <option value="">Seleccionar...</option>
                  {tablets
                    .filter((t) => !slots.some((s, si) => si !== i && s === t.id.toString()))
                    .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {slots.length > 2 && (
                  <IconBtn icon="x" v="danger" label="Quitar" onClick={() => removeSlot(i)} />
                )}
              </div>
            </div>
          ))}
          {slots.length < MAX_SLOTS && (
            <Btn icon="plus" onClick={addSlot}>Agregar tablet</Btn>
          )}
          <Btn v="primary" onClick={compare} disabled={!canCompare || loading}>{loading ? 'Cargando…' : 'Comparar'}</Btn>
        </div>
      </div>

      {data && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--divider)]">
                <th className="text-left px-4 py-3 text-xs font-medium w-36" style={{ color: 'var(--text-muted)' }}>Métrica</th>
                {data.map((d) => (
                  <th key={d.detail.id} className="px-4 py-3 text-center font-semibold whitespace-nowrap">{d.detail.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <StatRow label="Estado" values={data.map((d) => isOnline(d.detail) ? 'online' : 'offline')} />
              <StatRow label="Plays hoy" values={data.map((d) => d.detail.playsToday)} />
              <StatRow label="Total histórico" values={data.map((d) => d.detail.playsAllTime)} format={(v) => Number(v).toLocaleString()} />
              <StatRow label="Uptime 7d" values={data.map((d) => d.uptimePct7d)} format={(v) => `${v}%`} />
              <StatRow label="Batería" values={data.map((d) => d.detail.batteryLevel)} format={(v) => `${v}%`} />
              <StatRow label="Temperatura" values={data.map((d) => d.detail.temperatureC)} format={(v) => `${(v as number).toFixed(1)}°C`} />
              <StatRow label="APK" values={data.map((d) => d.detail.appVersion)} />
              <StatRow label="Zona" values={data.map((d) => d.detail.zone)} />
              <StatRow label="Playlist" values={data.map((d) => d.detail.playlist?.name)} />
              <StatRow label="Última sync" values={data.map((d) => d.detail.lastSync)} format={(v) => new Date(v as string).toLocaleString('es-AR')} />
              <StatRow label="Total syncs" values={data.map((d) => d.syncs.length)} format={(v) => `${v} (últimas 50)`} />
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
