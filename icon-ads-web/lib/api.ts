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
    request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request<User>('/api/auth/me'),

  // Tablets
  getTablets: () => request<Tablet[]>('/api/tablets'),
  createTablet: (data: Partial<Tablet>) =>
    request<Tablet>('/api/tablets', { method: 'POST', body: JSON.stringify(data) }),
  updateTablet: (id: number, data: Partial<Tablet>) =>
    request<Tablet>(`/api/tablets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getTablet: (id: number) => request<TabletDetail>(`/api/tablets/${id}`),
  forceSync: (id: number) =>
    request<{ ok: boolean; message: string }>(`/api/tablets/${id}/force-sync`, { method: 'POST' }),
  deleteTablet: (id: number) => request<void>(`/api/tablets/${id}`, { method: 'DELETE' }),
  getTabletMonitor: () => request<TabletMonitorEntry[]>('/api/tablets/monitor'),

  // Clients
  getClients: () => request<Client[]>('/api/clients'),
  createClient: (data: Partial<Client>) =>
    request<Client>('/api/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id: number, data: Partial<Client>) =>
    request<Client>(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteClient: (id: number) => request<void>(`/api/clients/${id}`, { method: 'DELETE' }),
  reactivateClient: (id: number) => request<Client>(`/api/clients/${id}/reactivate`, { method: 'PATCH' }),
  getClientProfile: (id: number) => request<ClientProfile>(`/api/clients/${id}`),

  // Campaigns
  getCampaigns: () => request<Campaign[]>('/api/campaigns'),
  createCampaign: (data: Partial<Campaign>) =>
    request<Campaign>('/api/campaigns', { method: 'POST', body: JSON.stringify(data) }),
  updateCampaign: (id: number, data: Partial<Campaign>) =>
    request<Campaign>(`/api/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCampaign: (id: number) => request<void>(`/api/campaigns/${id}`, { method: 'DELETE' }),
  reactivateCampaign: (id: number) =>
    request<Campaign>(`/api/campaigns/${id}/reactivate`, { method: 'PATCH' }),
  pauseCampaign: (id: number) =>
    request<Campaign>(`/api/campaigns/${id}/pause`, { method: 'PATCH' }),
  resumeCampaign: (id: number) =>
    request<Campaign>(`/api/campaigns/${id}/resume`, { method: 'PATCH' }),
  getCampaignDetail: (id: number) => request<CampaignDetail>(`/api/campaigns/${id}`),
  addComment: (campaignId: number, body: string) =>
    request<Comment>(`/api/campaigns/${campaignId}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),

  // Ads
  getAds: () => request<Ad[]>('/api/ads'),
  uploadAdWithProgress: async (formData: FormData, onProgress: (pct: number) => void): Promise<Ad> => {
    const file = formData.get('file') as File | null;

    // Try R2 presigned URL flow first
    if (file) {
      try {
        const presign = await request<{ uploadUrl: string; key: string; publicUrl: string }>(
          `/api/ads/presign?filename=${encodeURIComponent(file.name)}&contentType=${encodeURIComponent(file.type)}`
        );
        // Upload directly to R2 with progress
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', presign.uploadUrl);
          xhr.setRequestHeader('Content-Type', file.type);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 90));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`R2 upload failed: HTTP ${xhr.status}`));
          };
          xhr.onerror = () => reject(new Error('Error de red'));
          xhr.send(file);
        });
        onProgress(95);
        const ad = await request<Ad>('/api/ads/confirm', {
          method: 'POST',
          body: JSON.stringify({
            key: presign.key,
            publicUrl: presign.publicUrl,
            campaignId: formData.get('campaignId'),
            name: formData.get('name'),
            type: formData.get('type'),
            durationS: formData.get('durationS'),
          }),
        });
        onProgress(100);
        return ad;
      } catch (err: unknown) {
        // If R2 is not configured (503), fall through to direct upload
        if (!(err instanceof Error) || !err.message.includes('R2 not configured')) throw err;
      }
    }

    // Fallback: direct upload through backend (local dev / R2 not configured)
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/api/ads/upload`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
        else { const b = JSON.parse(xhr.responseText || '{}'); reject(new Error(b.error ?? `HTTP ${xhr.status}`)); }
      };
      xhr.onerror = () => reject(new Error('Error de red'));
      xhr.send(formData);
    });
  },
  deleteAd: (id: number) => request<void>(`/api/ads/${id}`, { method: 'DELETE' }),
  approveAd: (id: number) => request<Ad>(`/api/ads/${id}/approve`, { method: 'PATCH' }),
  rejectAd: (id: number) => request<Ad>(`/api/ads/${id}/reject`, { method: 'PATCH' }),
  getStorageStats: () => request<StorageStats>('/api/ads/storage-stats'),

  // Playlists
  getPlaylists: () => request<Playlist[]>('/api/playlists'),
  createPlaylist: (data: { name: string }) =>
    request<Playlist>('/api/playlists', { method: 'POST', body: JSON.stringify(data) }),
  updatePlaylist: (id: number, data: { name: string }) =>
    request<Playlist>(`/api/playlists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePlaylist: (id: number) => request<void>(`/api/playlists/${id}`, { method: 'DELETE' }),
  setPlaylistAds: (id: number, ads: { adId: number; order: number }[]) =>
    request<Playlist>(`/api/playlists/${id}/ads`, { method: 'POST', body: JSON.stringify(ads) }),
  duplicatePlaylist: (id: number) =>
    request<Playlist>(`/api/playlists/${id}/duplicate`, { method: 'POST' }),
  getPlaylistVersions: (id: number) => request<PlaylistVersion[]>(`/api/playlists/${id}/versions`),
  revertPlaylist: (id: number, version: number) =>
    request<Playlist>(`/api/playlists/${id}/revert/${version}`, { method: 'POST' }),

  // Stats
  getStats: () => request<SystemStats>('/api/stats'),
  getWeeklyStats: (weeks?: number) => request<WeeklyEntry[]>(`/api/stats/weekly${weeks ? `?weeks=${weeks}` : ''}`),
  getRangeStats: (from: string, to: string) => request<RangeStats>(`/api/stats/range?from=${from}&to=${to}`),
  getMetricsCsvUrl: () => `${BASE}/api/stats/metrics/export`,

  // Logs
  getLogs: () => request<SystemLogEntry[]>('/api/logs'),
  getAuditLogs: (page?: number) => request<AuditPage>(`/api/logs/audit${page ? `?page=${page}` : ''}`),
};

export interface User { id: number; email: string; name: string; role: string; }
export interface Client {
  id: number; name: string; email: string; phone?: string; company?: string;
  active: boolean; deletedAt?: string; createdAt: string; updatedAt: string;
}
export interface ClientProfile extends Client {
  campaigns: (Campaign & { stats: { plays: number; totalSeconds: number } })[];
}
export interface Campaign {
  id: number; clientId: number; client?: { id: number; name: string };
  name: string; startDate: string; endDate: string; active: boolean;
  cpm?: number | null;
  deletedAt?: string; createdAt: string; updatedAt: string;
  _count?: { metrics: number };
}
export interface CampaignDetail extends Campaign {
  ads: Ad[];
  _count: { metrics: number };
  playsPerDay: { date: string; count: number }[];
  comments: Comment[];
}
export interface Comment { id: number; campaignId: number; authorName: string; body: string; createdAt: string; }
export interface Ad {
  id: number; campaignId: number; campaign?: { id: number; name: string };
  name: string; type: 'video' | 'image'; fileUrl: string; filename: string;
  durationS: number; active: boolean; approvalStatus: string;
  deletedAt?: string; createdAt: string; updatedAt: string;
}
export interface PlaylistAd { id: number; adId: number; order: number; ad: Ad; }
export interface Playlist {
  id: number; name: string; version: number; contentHash?: string;
  createdAt: string; updatedAt: string;
  playlistAds?: PlaylistAd[];
  _count?: { tablets: number };
}
export interface PlaylistVersion {
  id: number; playlistId: number; version: number;
  snapshot: { name: string; ads: { adId: number; order: number }[]; revertedFrom?: number };
  createdAt: string;
}
export interface Tablet {
  id: number; deviceId: string; token: string; name: string; zone?: string | null;
  timezone?: string | null; scheduleAt?: string | null;
  notes?: string | null; maintenanceUntil?: string | null;
  playlistId?: number | null; playlist?: { id: number; name: string; version: number };
  lastSync?: string | null; status: 'online' | 'offline' | 'syncing'; createdAt: string; updatedAt: string;
}
export interface TabletDetail extends Tablet {
  errorLogs: { id: number; errorType: string; message: string; occurredAt: string }[];
  playsToday: number;
  playsAllTime: number;
}
export interface TabletMonitorEntry {
  id: number; name: string; deviceId: string; zone: string | null; timezone: string | null;
  status: 'online' | 'offline'; offlineMinutes: number; lastSync: string | null;
  playlist: { id: number; name: string } | null; todayPlays: number;
}
export interface StorageStats { totalBytes: number; totalMB: number; fileCount: number; adCount: number; }
export interface SystemStats {
  tablets: { total: number; online: number };
  clients: number; campaigns: number; ads: number; totalPlays: number;
  dailyPlays: { date: string; count: number }[];
  playsByCampaign: { campaignId: number; campaignName: string; count: number }[];
  expiringCampaigns: { id: number; name: string; clientName: string; endDate: string; daysLeft: number }[];
}
export interface WeeklyEntry { week: string; from: string; to: string; count: number; }
export interface RangeStats {
  from: string; to: string; totalPlays: number;
  dailyPlays: { date: string; count: number }[];
  playsByCampaign: { campaignId: number; campaignName: string; count: number }[];
  playsByTablet: { tabletId: number; tabletName: string; count: number }[];
}
export interface SystemLogEntry {
  id: number; action: string; entity: string; entityId: number | null;
  details: string | null; userId: number | null; ip: string | null; timestamp: string;
}
export interface AuditPage {
  logs: { id: number; action: string; entity: string; entityId: number | null;
    details: string | null; ip: string | null; createdAt: string;
    user: { id: number; name: string; email: string } | null }[];
  total: number; page: number; pages: number;
}

export { BASE };
