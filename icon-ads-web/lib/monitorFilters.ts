import type { TabletMonitorEntry } from './api';
import type { FilterConfig } from './filterEngine';

const NO_PLAYLIST = '(sin playlist)';

const healthLabel: Record<string, string> = {
  ok: 'ok',
  offline: 'offline',
  'no-reproduce': 'no reproduce',
  'sin-playlist': 'sin playlist',
  blocked: 'bloqueada',
};

export const monitorFilterConfig: FilterConfig<TabletMonitorEntry> = {
  fields: [
    { key: 'name', label: 'Nombre', type: 'text' },
    { key: 'zone', label: 'Zona', type: 'enum' },
    { key: 'status', label: 'Estado', type: 'enum', fixed: ['online', 'offline'] },
    { key: 'health', label: 'Salud', type: 'enum', fixed: ['ok', 'no reproduce', 'sin playlist', 'bloqueada', 'offline'] },
    { key: 'manualStatus', label: 'Estado manual', type: 'enum', fixed: ['activa', 'bloqueada', 'mantenimiento'] },
    { key: 'playlist', label: 'Playlist', type: 'enum' },
    { key: 'appVersion', label: 'Versión APK', type: 'enum' },
    { key: 'battery', label: 'Batería (%)', type: 'number' },
    { key: 'todayPlays', label: 'Reproducciones hoy', type: 'number' },
    { key: 'lastAdAgoMin', label: 'Sin publicidad hace (min)', type: 'number' },
    { key: 'brightness', label: 'Brillo (%)', type: 'number' },
    { key: 'lastSync', label: 'Última sincronía', type: 'sync' },
    { key: 'driverName', label: 'Taxista', type: 'text' },
    { key: 'licensePlate', label: 'Matrícula', type: 'text' },
  ],
  isOnline: (e) => e.status === 'online',
  getRaw: (field, e) => {
    switch (field) {
      case 'name': return e.name;
      case 'zone': return e.zone ?? '';
      case 'health': return healthLabel[e.health ?? 'ok'] ?? (e.health ?? 'ok');
      case 'manualStatus': return e.manualStatus ?? 'activa';
      case 'appVersion': return e.appVersion ?? '';
      case 'battery': return e.batteryLevel ?? null;
      case 'todayPlays': return e.todayPlays ?? 0;
      case 'lastAdAgoMin': return e.lastAdAgoS != null ? Math.round(e.lastAdAgoS / 60) : null;
      case 'brightness': return e.brightness ?? null;
      case 'driverName': return e.driverName ?? '';
      case 'licensePlate': return e.licensePlate ?? '';
      case 'playlist': return e.playlist?.name ?? NO_PLAYLIST;
      case 'lastSync': return e.lastSync ? new Date(e.lastSync).getTime() : 0;
      default: return null;
    }
  },
};
