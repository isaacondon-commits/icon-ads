'use client';

import { useEffect, useState } from 'react';
import { api, Tablet, Client, Campaign, Ad } from '@/lib/api';

interface Stats {
  tablets: { total: number; online: number; offline: number };
  clients: number;
  campaigns: number;
  ads: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [tablets, setTablets] = useState<Tablet[]>([]);

  useEffect(() => {
    Promise.all([
      api.getTablets(),
      api.getClients(),
      api.getCampaigns(),
      api.getAds(),
    ]).then(([t, c, camp, a]) => {
      setTablets(t);
      setStats({
        tablets: {
          total: t.length,
          online: t.filter((x) => x.status === 'online').length,
          offline: t.filter((x) => x.status === 'offline').length,
        },
        clients: c.length,
        campaigns: camp.length,
        ads: a.length,
      });
    });
  }, []);

  const statCards = stats
    ? [
        { label: 'Tablets', value: stats.tablets.total, sub: `${stats.tablets.online} online`, color: 'bg-blue-500' },
        { label: 'Clientes', value: stats.clients, color: 'bg-violet-500' },
        { label: 'Campañas', value: stats.campaigns, color: 'bg-amber-500' },
        { label: 'Anuncios', value: stats.ads, color: 'bg-emerald-500' },
      ]
    : [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {!stats ? (
        <p className="text-gray-500">Cargando estadísticas...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {statCards.map((card) => (
              <div key={card.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <div className={`w-10 h-10 rounded-lg ${card.color} mb-3`} />
                <p className="text-3xl font-bold">{card.value}</p>
                <p className="text-gray-500 text-sm mt-0.5">{card.label}</p>
                {card.sub && <p className="text-xs text-gray-400 mt-1">{card.sub}</p>}
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="font-semibold mb-4">Estado de tablets</h2>
            {tablets.length === 0 ? (
              <p className="text-gray-400 text-sm">No hay tablets registradas.</p>
            ) : (
              <div className="space-y-2">
                {tablets.slice(0, 8).map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <p className="font-medium text-sm">{t.name}</p>
                      <p className="text-xs text-gray-400">{t.zone ?? 'Sin zona'} · {t.deviceId}</p>
                    </div>
                    <StatusBadge status={t.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Tablet['status'] }) {
  const map = {
    online: 'bg-emerald-100 text-emerald-700',
    offline: 'bg-gray-100 text-gray-600',
    syncing: 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status]}`}>
      {status}
    </span>
  );
}
