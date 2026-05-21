'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Assumptions documented for transparency
const G_CO2_PER_FLYER = 5;        // grams CO2 to print + distribute one flyer
const G_CO2_PER_DIGITAL = 0.1;    // grams CO2 per digital impression (screen energy)
const G_PAPER_PER_FLYER = 4;      // grams of paper per flyer
const L_WATER_PER_KG_PAPER = 10;  // liters of water to produce 1 kg of paper
const TREE_KG_CO2_PER_YEAR = 22;  // kg CO2 absorbed per tree per year

export default function ImpactPage() {
  const [totalPlays, setTotalPlays] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboardSummary()
      .then((s) => setTotalPlays(s.stats.totalPlays))
      .catch(() => setTotalPlays(0))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>;

  const plays = totalPlays ?? 0;
  const co2SavedG = plays * (G_CO2_PER_FLYER - G_CO2_PER_DIGITAL);
  const co2SavedKg = co2SavedG / 1000;
  const paperSavedG = plays * G_PAPER_PER_FLYER;
  const paperSavedKg = paperSavedG / 1000;
  const waterSavedL = (paperSavedKg / 1000) * L_WATER_PER_KG_PAPER * 1000;
  const treesEquivalent = co2SavedKg / TREE_KG_CO2_PER_YEAR;

  const kpis = [
    {
      icon: '🌿',
      value: co2SavedKg >= 1000 ? `${(co2SavedKg / 1000).toFixed(1)} ton` : `${Math.round(co2SavedKg)} kg`,
      label: 'CO₂ evitado',
      sub: `vs distribución impresa equivalente`,
      color: 'text-emerald-600',
    },
    {
      icon: '📄',
      value: paperSavedKg >= 1000 ? `${(paperSavedKg / 1000).toFixed(1)} ton` : `${Math.round(paperSavedKg)} kg`,
      label: 'Papel ahorrado',
      sub: `${plays.toLocaleString()} flyers no impresos`,
      color: 'text-blue-600',
    },
    {
      icon: '💧',
      value: waterSavedL >= 1000 ? `${Math.round(waterSavedL / 1000)} m³` : `${Math.round(waterSavedL)} L`,
      label: 'Agua ahorrada',
      sub: 'en producción de papel',
      color: 'text-cyan-600',
    },
    {
      icon: '🌳',
      value: treesEquivalent >= 1 ? Math.round(treesEquivalent).toLocaleString() : `<1`,
      label: 'Árboles equivalentes',
      sub: 'absorbiendo CO₂ por un año',
      color: 'text-green-700',
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Impacto ambiental</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Estimación del impacto positivo de usar publicidad digital frente a publicidad impresa.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map((k) => (
          <div key={k.label} className="card p-6 text-center">
            <div className="text-4xl mb-3">{k.icon}</div>
            <p className={`text-3xl font-bold tabular-nums ${k.color}`}>{k.value}</p>
            <p className="text-sm font-semibold mt-1">{k.label}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Total plays context */}
      <div className="card p-6 mb-6">
        <h2 className="font-semibold mb-4">Base de cálculo</h2>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: 'var(--border)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Total de reproducciones</span>
            <span className="font-bold tabular-nums">{plays.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: 'var(--border)' }}>
            <span style={{ color: 'var(--text-muted)' }}>CO₂ por impresión digital</span>
            <span className="font-medium">{G_CO2_PER_DIGITAL}g</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: 'var(--border)' }}>
            <span style={{ color: 'var(--text-muted)' }}>CO₂ por flyer impreso</span>
            <span className="font-medium">{G_CO2_PER_FLYER}g</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: 'var(--border)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Papel por flyer</span>
            <span className="font-medium">{G_PAPER_PER_FLYER}g</span>
          </div>
        </div>
      </div>

      {/* Methodology disclaimer */}
      <div className="card p-5">
        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>METODOLOGÍA</p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Los cálculos comparan cada reproducción digital con la alternativa de un volante impreso equivalente.
          Las estimaciones de huella de carbono son aproximadas: 5g CO₂/flyer (impresión + distribución) vs. 0.1g CO₂/impresión digital (consumo eléctrico del display).
          Consumo de agua basado en 10 L/kg de papel producido. Absorción de CO₂ por árbol: ~22 kg/año.
          Estos valores son referenciales y pueden variar según región y proveedor energético.
        </p>
      </div>
    </div>
  );
}
