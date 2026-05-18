'use client';

import { useEffect, useState } from 'react';
import { api, Campaign } from '@/lib/api';

const COLORS = ['bg-blue-500','bg-violet-500','bg-amber-500','bg-emerald-500','bg-red-500','bg-pink-500','bg-cyan-500','bg-lime-500'];

function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
function firstDayOfMonth(y: number, m: number) { return new Date(y, m, 1).getDay(); }

export default function CalendarPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  useEffect(() => {
    api.getCampaigns().then(setCampaigns).finally(() => setLoading(false));
  }, []);

  const totalDays = daysInMonth(year, month);
  const startDay = firstDayOfMonth(year, month);

  // Map campaign index for stable color
  const activeCampaigns = campaigns.filter((c) => c.active);
  const colorMap = Object.fromEntries(activeCampaigns.map((c, i) => [c.id, COLORS[i % COLORS.length]]));

  function campaignsOnDay(day: number): Campaign[] {
    const date = new Date(year, month, day);
    return activeCampaigns.filter((c) => {
      const start = new Date(c.startDate);
      const end = new Date(c.endDate);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return date >= start && date <= end;
    });
  }

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const monthName = new Date(year, month, 1).toLocaleString('es-AR', { month: 'long', year: 'numeric' });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Calendario de campañas</h1>

      {/* Month nav */}
      <div className="flex items-center gap-4 mb-4">
        <button onClick={prevMonth} className="px-3 py-1 rounded-lg border text-sm hover:bg-gray-50 dark:hover:bg-gray-800" style={{ borderColor: 'var(--border-md)' }}>‹</button>
        <h2 className="font-semibold text-lg capitalize">{monthName}</h2>
        <button onClick={nextMonth} className="px-3 py-1 rounded-lg border text-sm hover:bg-gray-50 dark:hover:bg-gray-800" style={{ borderColor: 'var(--border-md)' }}>›</button>
        <button onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }} className="ml-2 text-xs text-blue-600 hover:underline">Hoy</button>
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
              const dayCampaigns = campaignsOnDay(day);
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
                    {dayCampaigns.slice(0, 3).map((c) => (
                      <div
                        key={c.id}
                        className={`text-white text-xs px-1 py-0.5 rounded truncate ${colorMap[c.id]}`}
                        title={c.name}
                      >
                        {c.name}
                      </div>
                    ))}
                    {dayCampaigns.length > 3 && (
                      <div className="text-xs" style={{ color: 'var(--text-xs)' }}>+{dayCampaigns.length - 3} más</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      {activeCampaigns.length > 0 && (
        <div className="mt-4 card p-4">
          <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Campañas activas</p>
          <div className="flex flex-wrap gap-2">
            {activeCampaigns.map((c) => (
              <span key={c.id} className={`text-white text-xs px-2 py-0.5 rounded-full ${colorMap[c.id]}`}>{c.name}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
