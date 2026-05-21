const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
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
    request<{ token: string; user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
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
            priority: formData.get('priority'),
            targetUrl: formData.get('targetUrl') || null,
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
      const token = getStoredToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
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

  // Profile
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  getPendingAdsCount: () => request<{ count: number }>('/api/ads/pending-count'),
  unlockUser: (userId: number) => request<{ ok: boolean }>(`/api/auth/unlock/${userId}`, { method: 'PATCH' }),

  // Stats extras
  getHeatmap: (from?: string, to?: string) =>
    request<HourlyCount[]>(`/api/stats/heatmap${from ? `?from=${from}&to=${to}` : ''}`),
  getCompletionRate: (from?: string, to?: string) =>
    request<CompletionRate[]>(`/api/stats/completion${from ? `?from=${from}&to=${to}` : ''}`),
  getPlaylistStats: (from?: string, to?: string) =>
    request<PlaylistStat[]>(`/api/stats/playlists${from ? `?from=${from}&to=${to}` : ''}`),

  // Notifications
  getNotifications: () => request<Notifications>('/api/notifications'),

  // Audit export URL
  getAuditCsvUrl: (from?: string, to?: string) =>
    `${BASE}/api/logs/audit/export${from ? `?from=${from}&to=${to}` : ''}`,

  // Sync history + uptime (#1 #3)
  getSyncHistory: (tabletId: number) =>
    request<{ syncs: SyncLog[]; uptimePct7d: number }>(`/api/tablets/${tabletId}/sync-history`),

  // Admin message to tablet (#4)
  sendTabletMessage: (tabletId: number, message: string) =>
    request<{ id: number }>(`/api/tablets/${tabletId}/message`, { method: 'POST', body: JSON.stringify({ message }) }),

  // Tablet groups (#5)
  getTabletGroups: () => request<TabletGroup[]>('/api/tablets/groups'),
  createTabletGroup: (data: { name: string; playlistId?: number | null }) =>
    request<TabletGroup>('/api/tablets/groups', { method: 'POST', body: JSON.stringify(data) }),
  updateTabletGroup: (id: number, data: { name?: string; playlistId?: number | null }) =>
    request<TabletGroup>(`/api/tablets/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTabletGroup: (id: number) => request<void>(`/api/tablets/groups/${id}`, { method: 'DELETE' }),
  assignTabletGroup: (tabletId: number, groupId: number | null) =>
    request<Tablet>(`/api/tablets/${tabletId}/group`, { method: 'PATCH', body: JSON.stringify({ groupId }) }),

  // System settings (#11 #12 #10)
  getSettings: () => request<Record<string, string>>('/api/settings'),
  setSetting: (key: string, value: string) =>
    request<{ key: string; value: string }>(`/api/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),

  // Occupancy stats (#8)
  getOccupancy: () => request<OccupancyEntry[]>('/api/stats/occupancy'),

  // Ads with zero plays (#13)
  getAdsNoPlays: () => request<AdNoPlays[]>('/api/stats/ads-no-plays'),

  // Clone campaign (#9)
  cloneCampaign: (id: number) =>
    request<Campaign>(`/api/campaigns/${id}/clone`, { method: 'POST' }),

  // Zone stats (#35)
  getZoneStats: () => request<ZoneStat[]>('/api/stats/by-zone'),

  // Dashboard summary — all data in one call (#21)
  getDashboardSummary: () => request<DashboardSummary>('/api/dashboard/summary'),

  // Archive (#5)
  getArchivedCampaigns: () => request<ArchivedCampaign[]>('/api/campaigns/archived'),
  getArchivedAds: () => request<ArchivedAd[]>('/api/ads/archived'),
  restoreAd: (id: number) => request<Ad>(`/api/ads/${id}/restore`, { method: 'PATCH' }),

  // Sync intervals (#14)
  getSyncIntervals: () => request<SyncInterval[]>('/api/stats/sync-intervals'),

  // Tablets CSV export (#24)
  getTabletsCsvUrl: () => `${BASE}/api/tablets/export`,

  // ROI report (#15)
  getRoiStats: () => request<RoiEntry[]>('/api/stats/roi'),

  // Ad tags (#16)
  getAdTags: () => request<string[]>('/api/ads/tags'),
  updateAdTags: (id: number, tags: string[]) =>
    request<Ad>(`/api/ads/${id}`, { method: 'PUT', body: JSON.stringify({ tags }) }),

  // Transfer campaign (#18)
  transferCampaign: (id: number, clientId: number) =>
    request<Campaign>(`/api/campaigns/${id}/transfer`, { method: 'PATCH', body: JSON.stringify({ clientId }) }),

  // Paginated metrics (#22)
  getMetricsPaged: (page = 1, limit = 50) =>
    request<MetricsPage>(`/api/stats/metrics?page=${page}&limit=${limit}`),

  // Admin notes (#36)
  getNotes: () => request<AdminNote[]>('/api/notes'),
  createNote: (body: string) =>
    request<AdminNote>('/api/notes', { method: 'POST', body: JSON.stringify({ body }) }),
  deleteNote: (id: number) =>
    request<void>(`/api/notes/${id}`, { method: 'DELETE' }),

  // Campaign templates (#31)
  getTemplates: () => request<CampaignTemplate[]>('/api/templates'),
  createTemplate: (data: { name: string; cpm?: number | null; maxImpressions?: number | null; budget?: number | null; targetImpressions?: number | null; observations?: string | null }) =>
    request<CampaignTemplate>('/api/templates', { method: 'POST', body: JSON.stringify(data) }),
  deleteTemplate: (id: number) =>
    request<void>(`/api/templates/${id}`, { method: 'DELETE' }),

  // Favorites (#44)
  getFavorites: (type?: string) => request<Favorite[]>(`/api/favorites${type ? `?type=${type}` : ''}`),
  addFavorite: (entityType: string, entityId: number) =>
    request<Favorite>('/api/favorites', { method: 'POST', body: JSON.stringify({ entityType, entityId }) }),
  removeFavorite: (id: number) =>
    request<void>(`/api/favorites/${id}`, { method: 'DELETE' }),

  // Endpoint latency (#43)
  getLatency: () => request<LatencySummary>('/api/stats/latency'),

  // Zone-hour heatmap (#52)
  getZoneHourStats: () => request<ZoneHourEntry[]>('/api/stats/zone-hour'),

  // SLA compliance (#59)
  getSlaStats: () => request<SlaStat[]>('/api/stats/sla'),

  // Full JSON backup download URL (#42)
  getBackupUrl: () => `${BASE}/api/admin/backup`,

  // Monthly seasonality (#38)
  getMonthlyStats: () => request<MonthlyEntry[]>('/api/stats/monthly'),

  // Multi-sheet Excel export URL (#64)
  getExcelUrl: () => `${BASE}/api/admin/export/excel`,

  // Health check (#50)
  getHealth: () => request<HealthCheck>('/api/health'),

  // PDF exports (#32 #51 #56)
  getProposalUrl: (clientId: number) => `${BASE}/api/clients/${clientId}/proposal`,
  getCertificateUrl: (campaignId: number) => `${BASE}/api/campaigns/${campaignId}/certificate`,
  getContractUrl: (campaignId: number) => `${BASE}/api/campaigns/${campaignId}/contract`,

  // Reminders (#39)
  getReminders: () => request<Reminder[]>('/api/reminders'),
  createReminder: (data: { title: string; body?: string | null; dueAt?: string | null }) =>
    request<Reminder>('/api/reminders', { method: 'POST', body: JSON.stringify(data) }),
  updateReminder: (id: number, data: Partial<{ done: boolean; title: string; body: string | null; dueAt: string | null }>) =>
    request<Reminder>(`/api/reminders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteReminder: (id: number) => request<void>(`/api/reminders/${id}`, { method: 'DELETE' }),
};

export interface User { id: number; email: string; name: string; role: string; }
export interface Client {
  id: number; name: string; email: string; phone?: string; company?: string;
  rut?: string | null; address?: string | null; color?: string | null;
  contactName?: string | null; contactPhone?: string | null;
  active: boolean; deletedAt?: string; createdAt: string; updatedAt: string;
}
export interface ClientProfile extends Client {
  campaigns: (Campaign & { stats: { plays: number; totalSeconds: number } })[];
}
export interface Campaign {
  id: number; clientId: number; client?: { id: number; name: string };
  name: string; startDate: string; endDate: string; active: boolean;
  cpm?: number | null; maxImpressions?: number | null;
  budget?: number | null; observations?: string | null; targetImpressions?: number | null;
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
  priority: number; targetUrl?: string | null; startsAt?: string | null; endsAt?: string | null;
  tags: string[];
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
  driverName?: string | null; licensePlate?: string | null;
  spotPrice?: number | null; batteryLevel?: number | null; temperatureC?: number | null; appVersion?: string | null; lastIp?: string | null;
  osVersion?: string | null; deviceModel?: string | null;
  groupId?: number | null;
  playlistId?: number | null; playlist?: { id: number; name: string; version: number };
  lastSync?: string | null; status: 'online' | 'offline' | 'syncing'; createdAt: string; updatedAt: string;
}
export interface TabletDetail extends Tablet {
  errorLogs: { id: number; errorType: string; message: string; occurredAt: string }[];
  playsToday: number;
  playsAllTime: number;
}

export interface SyncLog {
  id: number; tabletId: number; version: number; success: boolean; errorMsg: string | null; createdAt: string;
}
export interface TabletGroup {
  id: number; name: string; playlistId: number | null;
  playlist?: { id: number; name: string } | null;
  _count?: { tablets: number };
  createdAt: string; updatedAt: string;
}
export interface OccupancyEntry {
  tabletId: number; tabletName: string; zone: string | null;
  totalDurationS: number; paidDurationS: number; occupancyPct: number;
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
  playsByAd: { adId: number; adName: string; count: number }[];
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

export interface HourlyCount { hour: number; count: number; }
export interface CompletionRate { adId: number; adName: string; totalPlays: number; completedPlays: number; completionRate: number; }
export interface PlaylistStat { playlistId: number; playlistName: string; tabletCount: number; totalPlays: number; }
export interface AdNoPlays {
  id: number; name: string; type: 'video' | 'image'; durationS: number; createdAt: string;
  campaign: { id: number; name: string; active: boolean };
}

export interface Notifications {
  total: number; pendingAds: number;
  expiringCampaigns: { id: number; name: string; daysLeft: number }[];
  offlineTablets: { id: number; name: string; offlineMinutes: number | null }[];
}

export interface ZoneStat {
  zone: string; tablets: number; online: number; plays: number;
}

export interface DashboardSummary {
  stats: SystemStats;
  monitor: TabletMonitorEntry[];
  trend30d: { date: string; count: number }[];
  recentActivity: AuditPage['logs'];
}

export interface ArchivedCampaign extends Omit<Campaign, '_count'> {
  _count: { ads: number };
}

export interface ArchivedAd extends Ad {
  campaign: { id: number; name: string; clientId: number; client: { name: string } };
}

export interface SyncInterval {
  tabletId: number; tabletName: string; zone: string | null;
  syncCount: number; avgMinutes: number | null;
}

export interface RoiEntry {
  campaignId: number; campaignName: string; clientName: string;
  cpm: number | null; budget: number | null; targetImpressions: number | null;
  plays: number; estimatedRevenue: number;
}

export interface MetricRecord {
  id: number; tabletName: string; adName: string; campaignName: string;
  playedAt: string; durationPlayedS: number; completed: boolean; error: boolean;
}

export interface MetricsPage {
  total: number; page: number; pages: number; records: MetricRecord[];
}

export interface AdminNote {
  id: number; body: string; authorName: string; createdAt: string;
}

export interface CampaignTemplate {
  id: number; name: string;
  cpm: number | null; maxImpressions: number | null;
  budget: number | null; targetImpressions: number | null;
  observations: string | null; createdAt: string;
}

export interface Favorite {
  id: number; entityType: string; entityId: number; createdAt: string;
}

export interface LatencySummary {
  count: number; avg: number; p95: number;
  slow: { method: string; path: string; ms: number; status: number; ts: string }[];
  recent: { method: string; path: string; ms: number; status: number; ts: string }[];
}

export interface ZoneHourEntry { zone: string; hour: number; count: number; }

export interface MonthlyEntry { month: string; count: number; }

export interface HealthCheck {
  status: string; db: string; dbError: string | null; r2: boolean;
  uptime: number; timestamp: string; version: string;
  env: Record<string, string>;
}

export interface SlaStat {
  tabletId: number; tabletName: string; zone: string | null;
  syncCount30d: number; activeDays30d: number; coveragePct: number;
}

export interface Reminder {
  id: number; title: string; body: string | null;
  dueAt: string | null; done: boolean; createdAt: string;
}

export { BASE };
