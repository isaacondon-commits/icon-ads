const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request<User>('/api/auth/me'),

  // Tablets
  getTablets: () => request<Tablet[]>('/api/tablets'),
  createTablet: (data: Partial<Tablet>) =>
    request<Tablet>('/api/tablets', { method: 'POST', body: JSON.stringify(data) }),
  updateTablet: (id: number, data: Partial<Tablet>) =>
    request<Tablet>(`/api/tablets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  forceSync: (id: number) =>
    request<{ ok: boolean; message: string }>(`/api/tablets/${id}/force-sync`, { method: 'POST' }),
  getTabletMonitor: () => request<TabletMonitorEntry[]>('/api/tablets/monitor'),

  // Clients
  getClients: () => request<Client[]>('/api/clients'),
  createClient: (data: Partial<Client>) =>
    request<Client>('/api/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id: number, data: Partial<Client>) =>
    request<Client>(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteClient: (id: number) =>
    request<void>(`/api/clients/${id}`, { method: 'DELETE' }),

  // Campaigns
  getCampaigns: () => request<Campaign[]>('/api/campaigns'),
  createCampaign: (data: Partial<Campaign>) =>
    request<Campaign>('/api/campaigns', { method: 'POST', body: JSON.stringify(data) }),
  updateCampaign: (id: number, data: Partial<Campaign>) =>
    request<Campaign>(`/api/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCampaign: (id: number) =>
    request<void>(`/api/campaigns/${id}`, { method: 'DELETE' }),

  // Ads
  getAds: () => request<Ad[]>('/api/ads'),
  uploadAdWithProgress: (
    formData: FormData,
    onProgress: (pct: number) => void
  ): Promise<Ad> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/api/ads/upload`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          const body = JSON.parse(xhr.responseText || '{}');
          reject(new Error(body.error ?? `HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Error de red'));
      xhr.send(formData);
    }),
  deleteAd: (id: number) =>
    request<void>(`/api/ads/${id}`, { method: 'DELETE' }),

  // Playlists
  getPlaylists: () => request<Playlist[]>('/api/playlists'),
  createPlaylist: (data: { name: string }) =>
    request<Playlist>('/api/playlists', { method: 'POST', body: JSON.stringify(data) }),
  updatePlaylist: (id: number, data: { name: string }) =>
    request<Playlist>(`/api/playlists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePlaylist: (id: number) =>
    request<void>(`/api/playlists/${id}`, { method: 'DELETE' }),
  setPlaylistAds: (id: number, ads: { adId: number; order: number }[]) =>
    request<Playlist>(`/api/playlists/${id}/ads`, { method: 'POST', body: JSON.stringify(ads) }),
  duplicatePlaylist: (id: number) =>
    request<Playlist>(`/api/playlists/${id}/duplicate`, { method: 'POST' }),

  // Stats
  getStats: () => request<SystemStats>('/api/stats'),
  getMetricsCsvUrl: () => `${BASE}/api/stats/metrics/export`,
};

export interface User {
  id: number;
  email: string;
  name: string;
  role: string;
}

export interface Client {
  id: number;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  active: boolean;
  createdAt: string;
}

export interface Campaign {
  id: number;
  clientId: number;
  client?: { id: number; name: string };
  name: string;
  startDate: string;
  endDate: string;
  active: boolean;
  createdAt: string;
}

export interface Ad {
  id: number;
  campaignId: number;
  campaign?: { id: number; name: string };
  name: string;
  type: 'video' | 'image';
  fileUrl: string;
  filename: string;
  durationS: number;
  active: boolean;
  createdAt: string;
}

export interface PlaylistAd {
  id: number;
  adId: number;
  order: number;
  ad: Ad;
}

export interface Playlist {
  id: number;
  name: string;
  version: number;
  createdAt: string;
  playlistAds?: PlaylistAd[];
  _count?: { tablets: number };
}

export interface Tablet {
  id: number;
  deviceId: string;
  token: string;
  name: string;
  zone?: string;
  playlistId?: number;
  playlist?: { id: number; name: string; version: number };
  lastSync?: string;
  status: 'online' | 'offline' | 'syncing';
  createdAt: string;
}

export interface TabletMonitorEntry {
  id: number;
  name: string;
  deviceId: string;
  zone: string | null;
  status: 'online' | 'offline';
  lastSync: string | null;
  playlist: { id: number; name: string } | null;
  todayPlays: number;
}

export interface SystemStats {
  tablets: { total: number; online: number };
  clients: number;
  campaigns: number;
  ads: number;
  dailyPlays: { date: string; count: number }[];
  playsByCampaign: { campaignId: number; campaignName: string; count: number }[];
}

export { BASE };
