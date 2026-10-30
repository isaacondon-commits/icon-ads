'use client';

import { useEffect, useState } from 'react';
import PageShell from '@/components/ui/PageShell';
import { Btn } from '@/components/ui/buttons';
import { api, Ad } from '@/lib/api';

const COLORS = ['bg-blue-500','bg-violet-500','bg-amber-500','bg-emerald-500','bg-red-500','bg-pink-500','bg-cyan-500','bg-lime-500'];

function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
function firstDayOfMonth(y: number, m: number) { return new Date(y, m, 1).getDay(); }

// Calendario de los anuncios con fechas (desde / hasta). Los que no tienen
// fechas corren siempre y no se muestran acá. Un color por empresa.
export default function CalendarPage() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  useEffect(() => {
    api.getAds().then(setAds).finally(() => setLoading(false));
  }, []);

  const totalDays = daysInMonth(year, month);
  const startDay = firstDayOfMonth(year, month);

  const dated = ads.filter((a) => a.approvalStatus === 'approved' && a.active && (a.startsAt || a.endsAt));
  const clients = [...new Map(dated.map((a) => [a.clientId ?? 0, a.client?.name ?? 'Sin empresa'])).entries()];
  const colorMap = Object.fromEntries(clients.map(([id], i) => [id, COLORS[i % COLORS.length]]));

  function adsOnDay(day: number): Ad[] {
    const dayStart = new Date(year, month, day, 0, 0, 0, 0).getTime();
    const dayEnd = new Date(year, month, day, 23, 59, 59, 999).getTime();
    return dated.filter((a) =>
      (!a.startsAt || new Date(a.startsAt).getTime() <= dayEnd)
      && (!a.endsAt || new Date(a.endsAt).getTime() >= dayStart));
  }

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const monthName = new Date(year, month, 1).toLocaleString('es-AR', { month: 'long', year: 'numeric' });

  return (
    <PageShell title="Calendario de anuncios" subtitle="Qué anuncios con fecha corren cada día del mes (los que no tienen fecha corren siempre).">

      {/* Month nav */}
      <div className="flex items-center gap-4 mb-4">
        <Btn size="sm" onClick={prevMonth} title="Mes anterior">‹</Btn>
        <h2 className="min-w-40 text-center text-lg font-semibold capitalize">{monthName}</h2>
        <Btn size="sm" onClick={nextMonth} title="Mes siguiente">›</Btn>
        <Btn size="sm" v="accent" icon="calendar" onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}>Hoy</Btn>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : (
        <div className="card overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b" style={{ borderColor: 'var(--border-md)' }}>
            {['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((d) => (
              <div key={d} className="py-2 text-center text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7">
            {/* Empty cells for offset */}
            {Array.from({ length: startDay }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[80px] border-b border-r p-1" style={{ borderColor: 'var(--border)' }} />
            ))}

            {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => {
              const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
              const dayAds = adsOnDay(day);
              return (
                <div
                  key={day}
                  className="min-h-[80px] border-b border-r p-1.5"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 ${
                    isToday ? 'bg-blue-600 text-white' : ''
                  }`} style={{ color: isToday ? 'white' : 'var(--text-muted)' }}>
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {dayAds.slice(0, 3).map((a) => (
                      <div
                        key={a.id}
                        className={`text-white text-xs px-1 py-0.5 rounded truncate ${colorMap[a.clientId ?? 0]}`}
                        title={`${a.name} — ${a.client?.name ?? 'Sin empresa'}`}
                      >
                        {a.name}
                      </div>
                    ))}
                    {dayAds.length > 3 && (
                      <div className="text-xs" style={{ color: 'var(--text-xs)' }}>+{dayAds.length - 3} más</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      {clients.length > 0 && (
        <div className="mt-4 card p-4">
          <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Empresas</p>
          <div className="flex flex-wrap gap-2">
            {clients.map(([id, name]) => (
              <span key={id} className={`text-white text-xs px-2 py-0.5 rounded-full ${colorMap[id]}`}>{name}</span>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}
