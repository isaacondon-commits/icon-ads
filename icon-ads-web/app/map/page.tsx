'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import type * as Leaflet from 'leaflet';
import { api, TabletLiveLocation, LocationPoint } from '@/lib/api';

// Montevideo center
const MVD = [-34.9011, -56.1645] as [number, number];

type Filter = 'all' | 'online' | 'offline' | 'no-playlist';

declare global {
  interface Window {
    __iconads_showHistory?: (id: number, name: string) => void;
  }
}

export default function MapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<Leaflet.Map | null>(null);
  const markersRef = useRef<Record<number, Leaflet.Marker>>({});
  const routeLayerRef = useRef<Leaflet.Polyline | null>(null);
  const heatLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const lRef = useRef<typeof Leaflet | null>(null);

  const [tablets, setTablets] = useState<TabletLiveLocation[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<{ name: string; points: LocationPoint[] } | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const onlineCount = tablets.filter((t) => t.status === 'online').length;
  const withGps = tablets.filter((t) => t.lat !== null).length;

  const filtered = tablets.filter((t) => {
    if (filter === 'online') return t.status === 'online';
    if (filter === 'offline') return t.status === 'offline';
    if (filter === 'no-playlist') return !t.playlist;
    return true;
  });

  // Load Leaflet and init map
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    let cancelled = false;

    // Leaflet CSS
    if (!document.getElementById('lf-css')) {
      const link = document.createElement('link');
      link.id = 'lf-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    import('leaflet').then((mod) => {
      // Component unmounted (e.g. Strict Mode double-invoke) before the module loaded — skip init.
      if (cancelled || !mapRef.current || leafletMap.current) return;

      const L = mod.default;
      lRef.current = L;

      // Fix default icon paths for webpack/Next.js
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(mapRef.current, {
        center: MVD,
        zoom: 13,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      leafletMap.current = map;
      heatLayerRef.current = L.layerGroup().addTo(map);
      setMapReady(true);
    });

    return () => {
      cancelled = true;
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
        heatLayerRef.current = null;
        markersRef.current = {};
        setMapReady(false);
      }
    };
  }, []);

  const buildIcon = useCallback((t: TabletLiveLocation) => {
    const color = t.status === 'online' ? '#22c55e' : '#6b7280';
    const border = t.status === 'online' ? '#16a34a' : '#4b5563';
    const L = lRef.current;
    if (!L) return null;
    return L.divIcon({
      html: `<div style="background:${color};width:36px;height:36px;border-radius:50%;border:3px solid ${border};display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 6px rgba(0,0,0,.4);cursor:pointer">🚕</div>`,
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -20],
    });
  }, []);

  const buildPopup = (t: TabletLiveLocation) => {
    const sync = t.lastSync ? new Date(t.lastSync).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' }) : '—';
    const bat = t.batteryLevel !== null ? `${t.batteryLevel}%` : '—';
    const plays = t.todayPlays.toLocaleString('es-UY');
    const statusColor = t.status === 'online' ? '#22c55e' : '#ef4444';
    return `
      <div style="font-family:sans-serif;min-width:180px">
        <b style="font-size:14px">${t.name}</b>
        <div style="color:${statusColor};font-size:12px;margin:2px 0">${t.status === 'online' ? '● Online' : '● Offline'}</div>
        <div style="font-size:12px;color:#555;line-height:1.6">
          ${t.zone ? `<div>Zona: ${t.zone}</div>` : ''}
          <div>Playlist: ${t.playlist ? t.playlist.name : '<span style="color:#ef4444">Sin asignar</span>'}</div>
          <div>Batería: ${bat}</div>
          <div>Última sync: ${sync}</div>
          <div>Plays hoy: ${plays}</div>
          ${t.lat ? `<div style="color:#888;font-size:11px">${t.lat.toFixed(5)}, ${t.lng!.toFixed(5)}</div>` : ''}
        </div>
        <button onclick="window.__iconads_showHistory(${t.id},'${t.name.replace(/'/g, "\\'")}')" style="margin-top:6px;padding:4px 10px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">Ver recorrido hoy</button>
      </div>`;
  };

  // Expose history function to the popup button
  useEffect(() => {
    window.__iconads_showHistory = async (id: number, name: string) => {
      setSelectedId(id);
      try {
        const data = await api.getTabletLocationHistory(id);
        setSelectedHistory({ name, points: data.locations });
      } catch { setSelectedHistory({ name, points: [] }); }
    };
    return () => { delete window.__iconads_showHistory; };
  }, []);

  // Draw/update route when selectedHistory changes
  useEffect(() => {
    const L = lRef.current;
    const map = leafletMap.current;
    if (!L || !map) return;

    if (routeLayerRef.current) { routeLayerRef.current.remove(); routeLayerRef.current = null; }

    if (selectedHistory && selectedHistory.points.length > 1) {
      const pts = selectedHistory.points.map((p) => [p.lat, p.lng] as [number, number]);
      routeLayerRef.current = L.polyline(pts, { color: '#f59e0b', weight: 4, opacity: 0.8, dashArray: '6,4' });
      routeLayerRef.current.addTo(map);
      map.fitBounds(routeLayerRef.current.getBounds(), { padding: [40, 40] });
    }
  }, [selectedHistory]);

  const updateMarkers = useCallback((data: TabletLiveLocation[], L: typeof Leaflet, map: Leaflet.Map) => {
    const shown = new Set<number>();

    data.forEach((t) => {
      if (t.lat === null || t.lng === null) return;
      shown.add(t.id);
      const icon = buildIcon(t);
      if (!icon) return;

      if (markersRef.current[t.id]) {
        markersRef.current[t.id].setLatLng([t.lat, t.lng]).setIcon(icon).setPopupContent(buildPopup(t));
      } else {
        const marker = L.marker([t.lat, t.lng], { icon })
          .bindPopup(buildPopup(t), { maxWidth: 260 })
          .addTo(map);
        markersRef.current[t.id] = marker;
      }
    });

    // Remove markers for tablets no longer in data
    Object.keys(markersRef.current).forEach((idStr) => {
      const id = Number(idStr);
      if (!shown.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });
  }, [buildIcon]);

  const updateHeatmap = useCallback((data: TabletLiveLocation[], L: typeof Leaflet) => {
    const layer = heatLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!showHeatmap) return;
    data.forEach((t) => {
      if (t.lat === null || t.lng === null) return;
      const radius = Math.max(80, t.todayPlays * 3);
      L.circle([t.lat, t.lng], {
        radius, color: '#f59e0b', fillColor: '#fbbf24',
        fillOpacity: 0.25, weight: 0,
      }).addTo(layer);
    });
  }, [showHeatmap]);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getTabletLocationsLive();
      setTablets(data);
      setLastRefresh(new Date());
      const L = lRef.current;
      const map = leafletMap.current;
      if (L && map) {
        updateMarkers(data, L, map);
        updateHeatmap(data, L);
      }
    } catch { /* silent */ }
  }, [updateMarkers, updateHeatmap]);

  // Initial load + auto-refresh
  useEffect(() => {
    if (!mapReady) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch + polling once the map is ready, not a compiler target
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [mapReady, refresh]);

  // Re-render heatmap on toggle
  useEffect(() => {
    const L = lRef.current;
    if (L && tablets.length) updateHeatmap(tablets, L);
  }, [showHeatmap, tablets, updateHeatmap]);

  const centerMvd = () => leafletMap.current?.setView(MVD, 13);

  const clearRoute = () => {
    setSelectedId(null);
    setSelectedHistory(null);
  };

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* ── Sidebar panel ── */}
      <div className="w-72 flex-shrink-0 flex flex-col bg-gray-900 border-r border-gray-800 overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center justify-between mb-1">
            <Link href="/dashboard" className="text-xs text-gray-500 hover:text-gray-300">← Panel</Link>
            <span className="text-xs text-gray-500">{lastRefresh ? lastRefresh.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</span>
          </div>
          <h1 className="font-bold text-lg">Mapa GPS</h1>
          <div className="flex gap-3 mt-1 text-sm">
            <span className="text-green-400">● {onlineCount} online</span>
            <span className="text-gray-500">{tablets.length - onlineCount} offline</span>
            <span className="text-blue-400">📍 {withGps}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="p-3 border-b border-gray-800 space-y-2">
          {/* Filter */}
          <div className="flex gap-1 flex-wrap">
            {(['all', 'online', 'offline', 'no-playlist'] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-xs px-2 py-1 rounded font-medium transition-colors ${filter === f ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                {f === 'all' ? 'Todos' : f === 'online' ? 'Online' : f === 'offline' ? 'Offline' : 'Sin playlist'}
              </button>
            ))}
          </div>
          {/* Action buttons */}
          <div className="flex gap-2">
            <button onClick={centerMvd} className="flex-1 text-xs px-2 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300">
              🎯 Montevideo
            </button>
            <button onClick={() => setShowHeatmap((v) => !v)}
              className={`flex-1 text-xs px-2 py-1.5 rounded font-medium transition-colors ${showHeatmap ? 'bg-yellow-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
              🔥 Heatmap
            </button>
            <button onClick={refresh} className="text-xs px-2 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300">
              ↻
            </button>
          </div>
          {selectedHistory && (
            <div className="text-xs bg-yellow-900/40 border border-yellow-700 rounded p-2">
              <div className="font-semibold text-yellow-300">Recorrido: {selectedHistory.name}</div>
              <div className="text-yellow-500">{selectedHistory.points.length} puntos hoy</div>
              <button onClick={clearRoute} className="mt-1 text-yellow-400 hover:text-yellow-200">× Cerrar recorrido</button>
            </div>
          )}
        </div>

        {/* Tablet list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-4 text-gray-500 text-sm">Sin resultados para el filtro.</p>
          ) : (
            filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  if (t.lat && leafletMap.current) {
                    leafletMap.current.setView([t.lat, t.lng!], 15);
                    markersRef.current[t.id]?.openPopup();
                  }
                }}
                className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800 transition-colors ${selectedId === t.id ? 'bg-gray-800' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${t.status === 'online' ? 'bg-green-400' : 'bg-gray-500'}`} />
                  <span className="font-medium text-sm truncate">{t.name}</span>
                  {!t.lat && <span className="text-xs text-gray-600 ml-auto">sin GPS</span>}
                </div>
                <div className="ml-4 text-xs text-gray-500 mt-0.5 space-y-0.5">
                  {t.zone && <div>Zona: {t.zone}</div>}
                  <div>{t.playlist ? t.playlist.name : <span className="text-red-400">Sin playlist</span>}</div>
                  {t.batteryLevel !== null && <div>🔋 {t.batteryLevel}%</div>}
                  <div>▶ {t.todayPlays} plays hoy</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Map ── */}
      <div className="flex-1 relative">
        <div ref={mapRef} className="w-full h-full" />
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950 z-10">
            <div className="text-gray-400 text-sm">Cargando mapa...</div>
          </div>
        )}
      </div>
    </div>
  );
}
