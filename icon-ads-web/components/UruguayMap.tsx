'use client';

// Department centroids in SVG coordinates (viewport 500x560, N→S, W→E)
// x = (58.5 - lon) / 5.5 * 500   y = (|lat| - 30.1) / 4.8 * 560
const DEPARTMENTS: { name: string; x: number; y: number }[] = [
  { name: 'Artigas',       x: 182, y:  47 },
  { name: 'Salto',         x:  91, y: 163 },
  { name: 'Paysandú',      x:  91, y: 245 },
  { name: 'Río Negro',     x:  91, y: 315 },
  { name: 'Soriano',       x:  91, y: 397 },
  { name: 'Colonia',       x:  91, y: 455 },
  { name: 'San José',      x: 182, y: 455 },
  { name: 'Montevideo',    x: 227, y: 503 },
  { name: 'Canelones',     x: 255, y: 467 },
  { name: 'Maldonado',     x: 318, y: 503 },
  { name: 'Rocha',         x: 409, y: 467 },
  { name: 'Treinta y Tres',x: 373, y: 338 },
  { name: 'Cerro Largo',   x: 391, y: 245 },
  { name: 'Rivera',        x: 273, y: 105 },
  { name: 'Tacuarembó',    x: 246, y: 222 },
  { name: 'Durazno',       x: 227, y: 338 },
  { name: 'Florida',       x: 227, y: 432 },
  { name: 'Lavalleja',     x: 309, y: 397 },
  { name: 'Flores',        x: 146, y: 397 },
];

// Simplified Uruguay outline polygon
const OUTLINE = '110,15 230,5 395,12 460,65 490,210 478,390 445,530 340,555 240,550 155,528 75,485 50,415 52,340 60,240 72,165 95,95 110,15';

interface Props {
  activeZones: string[];        // zone names from tablet.zone
  onZoneClick?: (zone: string) => void;
}

export default function UruguayMap({ activeZones, onZoneClick }: Props) {
  const normalizedActive = activeZones.map((z) => z.toLowerCase().trim());

  return (
    <div className="relative w-full max-w-xs mx-auto">
      <svg viewBox="0 0 500 560" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
        {/* Country outline */}
        <polygon
          points={OUTLINE}
          fill="var(--card)"
          stroke="var(--border-md)"
          strokeWidth="2"
        />

        {/* Department dots + labels */}
        {DEPARTMENTS.map((dept) => {
          const isActive = normalizedActive.some(
            (z) => z.includes(dept.name.toLowerCase()) || dept.name.toLowerCase().includes(z)
          );
          return (
            <g
              key={dept.name}
              onClick={() => onZoneClick?.(dept.name)}
              style={{ cursor: onZoneClick ? 'pointer' : 'default' }}
            >
              <circle
                cx={dept.x}
                cy={dept.y}
                r={isActive ? 9 : 5}
                fill={isActive ? '#3b82f6' : 'var(--border-md)'}
                stroke={isActive ? '#1d4ed8' : 'var(--border-md)'}
                strokeWidth={isActive ? 2 : 1}
              >
                {isActive && (
                  <animate attributeName="r" values="9;12;9" dur="2s" repeatCount="indefinite" />
                )}
              </circle>
              {isActive && (
                <text
                  x={dept.x}
                  y={dept.y + 20}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#3b82f6"
                  fontWeight="600"
                >
                  {dept.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex gap-4 mt-2 justify-center text-xs" style={{ color: 'var(--text-muted)' }}>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> Con tablet activa
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--border-md)' }} /> Sin tablet
        </span>
      </div>
    </div>
  );
}
