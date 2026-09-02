import type { Tablet } from './api';
import type { FilterConfig } from './filterEngine';

const NO_PLAYLIST = '(sin playlist)';

export const tabletFilterConfig: FilterConfig<Tablet> = {
  fields: [
    { key: 'name', label: 'Nombre', type: 'text' },
    { key: 'deviceId', label: 'Device ID', type: 'text' },
    { key: 'zone', label: 'Zona', type: 'enum' },
    { key: 'status', label: 'Estado', type: 'enum', fixed: ['online', 'offline'] },
    { key: 'manualStatus', label: 'Estado manual', type: 'enum', fixed: ['activa', 'bloqueada', 'mantenimiento'] },
    { key: 'playlist', label: 'Playlist', type: 'enum' },
    { key: 'campaign', label: 'Campaña', type: 'text' },
    { key: 'appVersion', label: 'Versión APK', type: 'enum' },
    { key: 'battery', label: 'Batería (%)', type: 'number' },
    { key: 'lastSync', label: 'Última sincronía', type: 'sync' },
    { key: 'driverName', label: 'Taxista', type: 'text' },
    { key: 'licensePlate', label: 'Matrícula', type: 'text' },
  ],
  isOnline: (t, now) => {
    const ms = t.lastSync ? new Date(t.lastSync).getTime() : 0;
    return !!ms && now - ms < 10 * 60000;
  },
  getRaw: (field, t) => {
    switch (field) {
      case 'name': return t.name;
      case 'deviceId': return t.deviceId;
      case 'zone': return t.zone ?? '';
      case 'manualStatus': return t.manualStatus ?? 'activa';
      case 'appVersion': return t.appVersion ?? '';
      case 'driverName': return t.driverName ?? '';
      case 'licensePlate': return t.licensePlate ?? '';
      case 'battery': return t.batteryLevel ?? null;
      case 'campaign': return (t.campaigns ?? []).map((c) => c.name).join(' | ');
      case 'playlist': return t.playlistId ? (t.playlist?.name ?? `Playlist ${t.playlistId}`) : NO_PLAYLIST;
      case 'lastSync': return t.lastSync ? new Date(t.lastSync).getTime() : 0;
      default: return null;
    }
  },
};
