'use client';

import { useState } from 'react';

const DEFAULT_CPM = 5;

export default function CalculatorPage() {
  const [tablets, setTablets] = useState(10);
  const [weeks, setWeeks] = useState(4);
  const [playsPerDay, setPlaysPerDay] = useState(80);
  const [cpm, setCpm] = useState(DEFAULT_CPM);

  const totalDays = weeks * 7;
  const impressions = tablets * totalDays * playsPerDay;
  const revenue = (impressions / 1000) * cpm;
  const dailyRevenue = revenue / totalDays;
  const weeklyRevenue = revenue / weeks;

  function Slider({ label, value, min, max, step = 1, unit = '', onChange }: {
    label: string; value: number; min: number; max: number; step?: number; unit?: string;
    onChange: (v: number) => void;
  }) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <label className="font-medium" style={{ color: 'var(--text-muted)' }}>{label}</label>
          <span className="font-bold tabular-nums">{unit}{value.toLocaleString()}</span>
        </div>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-blue-600"
        />
        <div className="flex justify-between text-xs" style={{ color: 'var(--text-xs)' }}>
          <span>{unit}{min}</span><span>{unit}{max}</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Calculadora de campaña</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Estimá impresiones e ingresos antes de crear una campaña.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6 space-y-6">
          <h2 className="font-semibold mb-2">Parámetros</h2>

          <Slider label="Tablets activas" value={tablets} min={1} max={200} onChange={setTablets} />
          <Slider label="Duración (semanas)" value={weeks} min={1} max={52} onChange={setWeeks} />
          <Slider label="Reproducciones por tablet por día" value={playsPerDay} min={10} max={300} onChange={setPlaysPerDay} />
          <Slider label="CPM (USD por 1000 impresiones)" value={cpm} min={1} max={50} step={0.5} unit="$" onChange={setCpm} />
        </div>

        <div className="space-y-4">
          <div className="card p-6">
            <h2 className="font-semibold mb-4">Resumen estimado</h2>
            <div className="space-y-3">
              {[
                { label: 'Total de días', value: `${totalDays} días` },
                { label: 'Impresiones estimadas', value: impressions.toLocaleString() },
                { label: 'Ingreso diario', value: `$${dailyRevenue.toFixed(2)}` },
                { label: 'Ingreso semanal', value: `$${weeklyRevenue.toFixed(2)}` },
              ].map((r) => (
                <div key={r.label} className="flex items-center justify-between text-sm py-2 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{r.label}</span>
                  <span className="font-medium tabular-nums">{r.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-6">
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Ingreso total estimado</p>
            <p className="text-4xl font-bold text-emerald-600 tabular-nums">${revenue.toFixed(2)}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-xs)' }}>
              {tablets} tablets × {totalDays} días × {playsPerDay} plays/día × ${cpm}/CPM
            </p>
          </div>

          <div className="card p-4">
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>DISTRIBUCIÓN DE IMPRESIONES</p>
            {[
              { label: 'Por tablet', value: Math.round(totalDays * playsPerDay) },
              { label: 'Por semana', value: Math.round(tablets * 7 * playsPerDay) },
              { label: 'Por día', value: tablets * playsPerDay },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between text-sm py-1">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.label}</span>
                <span className="font-mono font-medium text-xs">{r.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
