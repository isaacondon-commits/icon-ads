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

// Presigns + PUTs a file straight to whichever direct-upload storage the
// backend has configured (R2 or Supabase), bypassing the backend for the
// binary transfer. Shared by the main ad file and its poster thumbnail.
async function directUploadFile(file: Blob, filename: string, contentType: string, onProgress?: (pct: number) => void) {
  const presign = await request<{ uploadUrl: string; key: string; publicUrl: string; provider: 'r2' | 'supabase' }>(
    `/api/ads/presign?filename=${encodeURIComponent(filename)}&contentType=${encodeURIComponent(contentType)}`
  );
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presign.uploadUrl);
    if (onProgress) {
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 90)); };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Error de red'));
    if (presign.provider === 'supabase') {
      // Supabase's signed-upload endpoint expects multipart/form-data with a
      // cacheControl field and the file under an empty field name — not a raw
      // body, unlike R2's presigned PUT. Let the browser set the multipart
      // Content-Type (with boundary) itself. It also sits behind Supabase's
      // API gateway, which requires the project's public anon key on every
      // request — the upload token in the URL alone isn't enough.
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (anonKey) {
        xhr.setRequestHeader('apikey', anonKey);
        xhr.setRequestHeader('Authorization', `Bearer ${anonKey}`);
      }
      xhr.setRequestHeader('x-upsert', 'false');
      const body = new FormData();
      body.append('cacheControl', '3600');
      body.append('', file, filename);
      xhr.send(body);
    } else {
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.send(file);
    }
  });
  return presign;
}

export interface StatsFilter { clientId?: number | null; tabletId?: number | null; }
function statsQs(from: string, to: string, opts?: StatsFilter): string {
  const p = new URLSearchParams({ from, to });
  if (opts?.clientId) p.set('clientId', String(opts.clientId));
  if (opts?.tabletId) p.set('tabletId', String(opts.tabletId));
  return p.toString();
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
  forceSyncAll: () =>
    request<{ ok: boolean; count: number; message: string }>('/api/tablets/force-sync-all', { method: 'POST' }),
  deleteTablet: (id: number) => request<void>(`/api/tablets/${id}`, { method: 'DELETE' }),
  getTabletMonitor: () => request<TabletMonitorEntry[]>('/api/tablets/monitor'),

  // Clients
  /** all=true incluye las desactivadas (pantalla Clientes). */
  getClients: (all = false) => request<Client[]>(`/api/clients${all ? '?all=1' : ''}`),
  bulkClients: (ids: number[], action: ClientBulkAction) =>
    request<{ changed: number; ids: number[] }>('/api/clients/bulk', { method: 'POST', body: JSON.stringify({ ids, action }) }),
  createClient: (data: Partial<Client>) =>
    request<Client & { portalInvite?: PortalInviteResult }>('/api/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id: number, data: Partial<Client>) =>
    request<Client>(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteClient: (id: number) => request<void>(`/api/clients/${id}`, { method: 'DELETE' }),
  reactivateClient: (id: number) => request<Client>(`/api/clients/${id}/reactivate`, { method: 'PATCH' }),
  getClientProfile: (id: number) => request<ClientProfile>(`/api/clients/${id}`),
  getClientPortal: (id: number) => request<ClientPortalStatus>(`/api/clients/${id}/portal`),
  inviteClientPortal: (id: number) => request<PortalInviteResult>(`/api/clients/${id}/portal/invite`, { method: 'POST' }),
  revokeClientPortal: (id: number) => request<{ ok: true }>(`/api/clients/${id}/portal/revoke`, { method: 'POST' }),


  // Ads
  getAds: () => request<Ad[]>('/api/ads'),
  uploadAdWithProgress: async (formData: FormData, onProgress: (pct: number) => void): Promise<Ad> => {
    const file = formData.get('file') as File | null;

    // Try direct-to-storage upload first (R2 or Supabase, whichever the backend has configured)
    if (file) {
      try {
        const presign = await directUploadFile(file, file.name, file.type, onProgress);
        onProgress(90);

        // Best-effort poster thumbnail for video ads — a failure here never
        // blocks the ad upload, it just falls back to the placeholder icon.
        let thumbnailUrl: string | null = null;
        const thumbnail = formData.get('thumbnail') as Blob | null;
        if (thumbnail) {
          try {
            const thumbPresign = await directUploadFile(thumbnail, `thumb-${Date.now()}.jpg`, 'image/jpeg');
            thumbnailUrl = thumbPresign.publicUrl;
          } catch { /* ignore */ }
        }
        onProgress(95);

        const ad = await request<Ad>('/api/ads/confirm', {
          method: 'POST',
          body: JSON.stringify({
            key: presign.key,
            publicUrl: presign.publicUrl,
            thumbnailUrl,
            clientId: formData.get('clientId'),
            name: formData.get('name'),
            publicName: formData.get('publicName') || null,
            playlistIds: formData.get('playlistIds') || '',
            startsAt: formData.get('startsAt') || null,
            endsAt: formData.get('endsAt') || null,
            type: formData.get('type'),
            durationS: formData.get('durationS'),
            priority: formData.get('priority'),
            targetUrl: formData.get('targetUrl') || null,
            tags: formData.get('tags') || null,
          }),
        });
        onProgress(100);
        return ad;
      } catch (err: unknown) {
        // Sin storage directo (503) o el navegador cortó el PUT a storage
        // ("Error de red", típicamente CORS del bucket) — sigue por el upload
        // a través del backend, que sube a R2 con sus credenciales.
        const msg = err instanceof Error ? err.message : '';
        if (!msg.includes('Direct upload not configured') && msg !== 'Error de red') throw err;
      }
    }
    // /upload acepta un solo archivo (campo 'file'); la miniatura no viaja por acá.
    formData.delete('thumbnail');

    // Fallback: direct upload through backend (local dev / no cloud storage configured)
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
  bulkDeleteAds: (ids: number[]) =>
    request<{ deleted: number }>('/api/ads/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  updateAd: (id: number, data: Partial<Pick<Ad, 'clientId' | 'name' | 'publicName' | 'type' | 'durationS' | 'priority' | 'targetUrl' | 'tags' | 'startsAt' | 'endsAt'>> & { playlistIds?: number[] }) =>
    request<Ad>(`/api/ads/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  approveAd: (id: number) => request<Ad>(`/api/ads/${id}/approve`, { method: 'PATCH' }),
  rejectAd: (id: number) => request<Ad>(`/api/ads/${id}/reject`, { method: 'PATCH' }),
  pauseAd: (id: number) => request<Ad>(`/api/ads/${id}/pause`, { method: 'PATCH' }),
  resumeAd: (id: number) => request<Ad>(`/api/ads/${id}/resume`, { method: 'PATCH' }),
  getStorageStats: () => request<StorageStats>('/api/ads/storage-stats'),

  // Playlists
  getPlaylists: () => request<Playlist[]>('/api/playlists'),
  createPlaylist: (data: { name: string }) =>
    request<Playlist>('/api/playlists', { method: 'POST', body: JSON.stringify(data) }),
  updatePlaylist: (id: number, data: { name: string }) =>
    request<Playlist>(`/api/playlists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePlaylist: (id: number) => request<void>(`/api/playlists/${id}`, { method: 'DELETE' }),
  pausePlaylist: (id: number) => request<Playlist>(`/api/playlists/${id}/pause`, { method: 'PATCH' }),
  resumePlaylist: (id: number) => request<Playlist>(`/api/playlists/${id}/resume`, { method: 'PATCH' }),
  setPlaylistAds: (id: number, ads: { adId: number; order: number }[]) =>
    request<Playlist>(`/api/playlists/${id}/ads`, { method: 'POST', body: JSON.stringify(ads) }),
  duplicatePlaylist: (id: number) =>
    request<Playlist>(`/api/playlists/${id}/duplicate`, { method: 'POST' }),
  getPlaylistVersions: (id: number) => request<PlaylistVersion[]>(`/api/playlists/${id}/versions`),
  revertPlaylist: (id: number, version: number) =>
    request<Playlist>(`/api/playlists/${id}/revert/${version}`, { method: 'POST' }),

  // Stats
  getStats: () => request<SystemStats>('/api/stats'),
  getWeeklyStats: (weeks?: number, opts?: StatsFilter) => {
    const p = new URLSearchParams();
    if (weeks) p.set('weeks', String(weeks));
    if (opts?.clientId) p.set('clientId', String(opts.clientId));
    if (opts?.tabletId) p.set('tabletId', String(opts.tabletId));
    const qs = p.toString();
    return request<WeeklyEntry[]>(`/api/stats/weekly${qs ? `?${qs}` : ''}`);
  },
  getRangeStats: (from: string, to: string, opts?: StatsFilter) =>
    request<RangeStats>(`/api/stats/range?${statsQs(from, to, opts)}`),
  getDailyStats: (from: string, to: string, opts?: StatsFilter) =>
    request<DailyEntry[]>(`/api/stats/daily?${statsQs(from, to, opts)}`),
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
  getHeatmap: (from?: string, to?: string, opts?: StatsFilter) =>
    request<HourlyCount[]>(`/api/stats/heatmap${from ? `?${statsQs(from, to!, opts)}` : ''}`),
  getHeatmapByDay: (from?: string, to?: string, opts?: StatsFilter) =>
    request<DayHourCount[]>(`/api/stats/heatmap-by-day${from ? `?${statsQs(from, to!, opts)}` : ''}`),
  getCompletionRate: (from?: string, to?: string, opts?: StatsFilter) =>
    request<CompletionRate[]>(`/api/stats/completion${from ? `?${statsQs(from, to!, opts)}` : ''}`),
  getPlaylistStats: (from?: string, to?: string) =>
    request<PlaylistStat[]>(`/api/stats/playlists${from ? `?from=${from}&to=${to}` : ''}`),
  getPlaysByTabletAd: (from?: string, to?: string, opts?: StatsFilter) =>
    request<TabletAdPlay[]>(`/api/stats/by-tablet-ad${from ? `?${statsQs(from, to!, opts)}` : ''}`),

  // Notifications
  getNotifications: () => request<Notifications>('/api/notifications'),
  ackAlert: (id: number | 'all') => request<{ ok: boolean }>(`/api/admin/alerts/${id}/ack`, { method: 'POST' }),
  getBandwidth: () => request<BandwidthStatus>('/api/admin/bandwidth'),
  resetCircuit: () => request<{ ok: boolean; window: string }>('/api/admin/circuit/reset', { method: 'POST' }),
  setFleetFreeze: (on: boolean) => request<{ ok: boolean; frozen: boolean; message: string }>('/api/admin/fleet-freeze', { method: 'POST', body: JSON.stringify({ on }) }),

  // Audit export URL
  getAuditCsvUrl: (from?: string, to?: string) =>
    `${BASE}/api/logs/audit/export${from ? `?from=${from}&to=${to}` : ''}`,

  // Sync history + uptime (#1 #3)
  getSyncHistory: (tabletId: number) =>
    request<{ syncs: SyncLog[]; uptimePct7d: number }>(`/api/tablets/${tabletId}/sync-history`),


  // Tablet groups (#5)
  getTabletGroups: () => request<TabletGroup[]>('/api/tablets/groups'),
  createTabletGroup: (data: { name: string; playlistId?: number | null }) =>
    request<TabletGroup>('/api/tablets/groups', { method: 'POST', body: JSON.stringify(data) }),
  updateTabletGroup: (id: number, data: { name?: string; playlistId?: number | null }) =>
    request<TabletGroup>(`/api/tablets/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTabletGroup: (id: number) => request<void>(`/api/tablets/groups/${id}`, { method: 'DELETE' }),
  assignTabletGroup: (tabletId: number, groupId: number | null) =>
    request<Tablet>(`/api/tablets/${tabletId}/group`, { method: 'PATCH', body: JSON.stringify({ groupId }) }),

  // Maestro: segundos máximos de los anuncios del portal (general + por empresa)
  getAdDurationLimits: () => request<AdDurationLimits>('/api/maestro/ad-duration'),
  saveAdDurationLimits: (data: { defaultSeconds?: number; clients?: { id: number; maxSeconds: number | null }[] }) =>
    request<AdDurationLimits>('/api/maestro/ad-duration', { method: 'PUT', body: JSON.stringify(data) }),

  // System settings (#11 #12 #10)
  getSettings: () => request<Record<string, string>>('/api/settings'),
  setSetting: (key: string, value: string) =>
    request<{ key: string; value: string }>(`/api/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),

  // Android APK auto-update (#apk-autoupdate)
  uploadApk: async (file: File, versionCode: number, versionName: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('versionCode', String(versionCode));
    fd.append('versionName', versionName);
    const token = getStoredToken();
    const res = await fetch(`${BASE}/api/admin/apk`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ versionCode: number; versionName: string; url: string; uploadedAt: string }>;
  },

  getApkStatus: () => request<ApkStatus>('/api/admin/apk'),
  requestScreenshot: (tabletId: number) =>
    request<{ ok: boolean; message: string }>(`/api/admin/tablet/${tabletId}/request-screenshot`, { method: 'POST' }),
  resyncTablet: (tabletId: number) =>
    request<{ ok: boolean; hasPlaylist: boolean; message: string }>(`/api/admin/tablet/${tabletId}/resync`, { method: 'POST' }),
  wakeTablet: (tabletId: number) =>
    request<{ ok: boolean; message: string }>(`/api/admin/tablet/${tabletId}/wake`, { method: 'POST' }),
  wakeAllTablets: () =>
    request<{ ok: boolean; sent: number; message: string }>('/api/admin/wake-all', { method: 'POST' }),
  blockTablet: (tabletId: number, on: boolean) =>
    request<{ ok: boolean; manualStatus: string; message: string }>(`/api/admin/tablet/${tabletId}/block`, { method: 'POST', body: JSON.stringify({ on }) }),
  blockAllTablets: (on: boolean) =>
    request<{ ok: boolean; count: number; message: string }>('/api/admin/block-all', { method: 'POST', body: JSON.stringify({ on }) }),
  getFleetBrightness: () =>
    request<{ value: string; isAuto: boolean; pct: number | null }>('/api/admin/brightness'),
  setFleetBrightness: (value: number | 'auto' | 'max') =>
    request<{ ok: boolean; value: string; message: string }>('/api/admin/brightness', { method: 'POST', body: JSON.stringify({ value }) }),
  getScreenshot: (tabletId: number) =>
    request<{ image: string | null; at: string | null }>(`/api/admin/tablet/${tabletId}/screenshot`),
  forceUpdateApkAll: () =>
    request<{ ok: boolean; count: number; pushed: number; message: string }>(
      '/api/admin/force-update-apk', { method: 'POST' },
    ),

  // Occupancy stats (#8)
  getOccupancy: () => request<OccupancyEntry[]>('/api/stats/occupancy'),

  // Ads with zero plays (#13)
  getAdsNoPlays: () => request<AdNoPlays[]>('/api/stats/ads-no-plays'),


  // Zone stats (#35)
  getZoneStats: () => request<ZoneStat[]>('/api/stats/by-zone'),

  // Dashboard summary — all data in one call (#21)
  getDashboardSummary: () => request<DashboardSummary>('/api/dashboard/summary'),

  // Archive (#5)
  getArchivedAds: () => request<ArchivedAd[]>('/api/ads/archived'),
  restoreAd: (id: number) => request<Ad>(`/api/ads/${id}/restore`, { method: 'PATCH' }),
  permanentDeleteAd: (id: number) => request<void>(`/api/ads/${id}/permanent`, { method: 'DELETE' }),

  // Sync intervals (#14)
  getSyncIntervals: () => request<SyncInterval[]>('/api/stats/sync-intervals'),

  // Tablets CSV export (#24)
  getTabletsCsvUrl: () => `${BASE}/api/tablets/export`,


  // Ad tags (#16)
  getAdTags: () => request<string[]>('/api/ads/tags'),
  updateAdTags: (id: number, tags: string[]) =>
    request<Ad>(`/api/ads/${id}`, { method: 'PUT', body: JSON.stringify({ tags }) }),


  // Paginated metrics (#22)
  getMetricsPaged: (page = 1, limit = 50) =>
    request<MetricsPage>(`/api/stats/metrics?page=${page}&limit=${limit}`),

  // Admin notes (#36)
  getNotes: () => request<AdminNote[]>('/api/notes'),
  createNote: (body: string) =>
    request<AdminNote>('/api/notes', { method: 'POST', body: JSON.stringify({ body }) }),
  deleteNote: (id: number) =>
    request<void>(`/api/notes/${id}`, { method: 'DELETE' }),


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
  getMonthlyStats: (opts?: StatsFilter) => {
    const p = new URLSearchParams();
    if (opts?.clientId) p.set('clientId', String(opts.clientId));
    if (opts?.tabletId) p.set('tabletId', String(opts.tabletId));
    const qs = p.toString();
    return request<MonthlyEntry[]>(`/api/stats/monthly${qs ? `?${qs}` : ''}`);
  },

  // Multi-sheet Excel export URL (#64)
  getExcelUrl: () => `${BASE}/api/admin/export/excel`,

  // PowerPoint export URL (#40)
  getPptxUrl: () => `${BASE}/api/admin/export/pptx`,

  // Demo seed (#63)
  seedDemo: () => request<{ message: string; client: { id: number; name: string } }>('/api/admin/demo-seed', { method: 'POST' }),

  // Health check (#50)
  getHealth: () => request<HealthCheck>('/api/health'),

  // PDF exports (#32 #51 #56)
  getProposalUrl: (clientId: number) => `${BASE}/api/clients/${clientId}/proposal`,

  // A/B tests (#49)
  getAbTests: () => request<AbTest[]>('/api/abtests'),
  createAbTest: (data: { name: string; adAId: number; adBId: number }) =>
    request<AbTest>('/api/abtests', { method: 'POST', body: JSON.stringify(data) }),
  updateAbTestStatus: (id: number, status: string) =>
    request<AbTest>(`/api/abtests/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteAbTest: (id: number) => request<void>(`/api/abtests/${id}`, { method: 'DELETE' }),

  // Referrals (#58)
  getReferrals: () => request<Referral[]>('/api/referrals'),
  createReferral: (referrerId: number) =>
    request<Referral>('/api/referrals', { method: 'POST', body: JSON.stringify({ referrerId }) }),
  redeemReferral: (id: number, referredId?: number) =>
    request<Referral>(`/api/referrals/${id}/redeem`, { method: 'PATCH', body: JSON.stringify({ referredId }) }),
  deleteReferral: (id: number) => request<void>(`/api/referrals/${id}`, { method: 'DELETE' }),

  // Driver points (#69)
  getDriverPoints: () => request<DriverPointsEntry[]>('/api/driver-points'),
  recalculateDriverPoints: () => request<{ recalculated: number; topPoints: number }>('/api/driver-points/recalculate', { method: 'POST' }),

  // Reminders (#39)
  getReminders: () => request<Reminder[]>('/api/reminders'),
  createReminder: (data: { title: string; body?: string | null; dueAt?: string | null }) =>
    request<Reminder>('/api/reminders', { method: 'POST', body: JSON.stringify(data) }),
  updateReminder: (id: number, data: Partial<{ done: boolean; title: string; body: string | null; dueAt: string | null }>) =>
    request<Reminder>(`/api/reminders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteReminder: (id: number) => request<void>(`/api/reminders/${id}`, { method: 'DELETE' }),

  // Mantenimiento: órdenes, alertas, repuestos, reglas recurrentes, diagnóstico
  getMaintMeta: () => request<MaintMeta>('/api/maintenance/meta'),
  saveMaintChecklists: (data: Record<string, string[]>) =>
    request<Record<string, string[]>>('/api/maintenance/checklists', { method: 'PUT', body: JSON.stringify(data) }),
  getMaintAlerts: () => request<MaintAlertsResponse>('/api/maintenance/alerts'),
  getMaintOrders: (q: { status?: string; tabletId?: number; from?: string; to?: string } = {}) => {
    const p = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => { if (v !== undefined && v !== '') p.set(k, String(v)); });
    return request<MaintOrder[]>(`/api/maintenance/orders${p.size ? `?${p}` : ''}`);
  },
  getMaintOrder: (id: number) => request<MaintOrder>(`/api/maintenance/orders/${id}`),
  createMaintOrders: (data: MaintOrderInput & { tabletIds: number[] }) =>
    request<MaintOrder[]>('/api/maintenance/orders', { method: 'POST', body: JSON.stringify(data) }),
  updateMaintOrder: (id: number, data: Partial<MaintOrderInput> & {
    status?: MaintStatus; checklist?: MaintChecklistItem[]; photos?: MaintPhoto[]; parts?: MaintOrderPart[]; resolution?: string | null;
  }) => request<MaintOrder>(`/api/maintenance/orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  uploadMaintPhoto: async (file: Blob, filename: string) => {
    const contentType = file.type || 'image/jpeg';
    const presign = await request<{ uploadUrl: string; key: string; publicUrl: string }>(
      `/api/maintenance/photo-presign?filename=${encodeURIComponent(filename)}&contentType=${encodeURIComponent(contentType)}`,
    );
    const res = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
    if (!res.ok) throw new Error(`No se pudo subir la foto (HTTP ${res.status})`);
    return { url: presign.publicUrl, key: presign.key };
  },
  getMaintTabletHistory: (tabletId: number) =>
    request<{ orders: MaintOrder[]; diagnostics: { id: number; data: Record<string, unknown>; createdAt: string }[] }>(`/api/maintenance/tablets/${tabletId}/history`),
  getMaintDiagnostic: (tabletId: number) => request<MaintDiagnostic>(`/api/maintenance/tablets/${tabletId}/diagnostic`),
  requestMaintDiagnostic: (tabletId: number) =>
    request<{ ok: boolean; message: string }>(`/api/maintenance/tablets/${tabletId}/diagnostic`, { method: 'POST' }),
  swapTablet: (data: { fromId: number; toId: number; note?: string; orderId?: number }) =>
    request<{ ok: boolean; message: string; doneOrder: MaintOrder; repairOrder: MaintOrder }>('/api/maintenance/swap', { method: 'POST', body: JSON.stringify(data) }),
  getMaintParts: () => request<MaintPart[]>('/api/maintenance/parts'),
  createMaintPart: (data: { name: string; category?: string | null; unit?: string; stock?: number; minStock?: number; notes?: string | null }) =>
    request<MaintPart>('/api/maintenance/parts', { method: 'POST', body: JSON.stringify(data) }),
  updateMaintPart: (id: number, data: Partial<{ name: string; category: string | null; unit: string; minStock: number; notes: string | null; active: boolean }>) =>
    request<MaintPart>(`/api/maintenance/parts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  moveMaintPart: (id: number, delta: number, reason?: string) =>
    request<MaintPart>(`/api/maintenance/parts/${id}/move`, { method: 'POST', body: JSON.stringify({ delta, reason }) }),
  getMaintPartMoves: (id: number) =>
    request<{ id: number; delta: number; reason: string | null; orderId: number | null; createdBy: string | null; createdAt: string }[]>(`/api/maintenance/parts/${id}/moves`),
  getMaintRules: () => request<MaintRule[]>('/api/maintenance/rules'),
  createMaintRule: (data: MaintRuleInput) =>
    request<{ rule: MaintRule; created: number }>('/api/maintenance/rules', { method: 'POST', body: JSON.stringify(data) }),
  updateMaintRule: (id: number, data: Partial<MaintRuleInput> & { active?: boolean }) =>
    request<{ rule: MaintRule; created: number }>(`/api/maintenance/rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  runMaintRules: () => request<{ ok: boolean; created: number }>('/api/maintenance/rules/run', { method: 'POST' }),

  // Zones / Geofencing (#67)
  getZones: () => request<Zone[]>('/api/zones'),
  createZone: (data: { name: string; description?: string; polygon?: [number, number][]; color?: string }) =>
    request<Zone>('/api/zones', { method: 'POST', body: JSON.stringify(data) }),
  updateZone: (id: number, data: Partial<{ name: string; description: string; polygon: [number, number][]; color: string }>) =>
    request<Zone>(`/api/zones/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteZone: (id: number) => request<void>(`/api/zones/${id}`, { method: 'DELETE' }),

  // Public API keys (#70)
  getApiKeys: () => request<ApiKey[]>('/api/admin/api-keys'),
  createApiKey: (name: string) =>
    request<ApiKey>('/api/admin/api-keys', { method: 'POST', body: JSON.stringify({ name }) }),
  revokeApiKey: (id: number) => request<void>(`/api/admin/api-keys/${id}`, { method: 'DELETE' }),

  // Driver surveys (#47)
  getSurveys: () => request<Survey[]>('/api/surveys'),
  createSurvey: (data: { question: string; options: string[] }) =>
    request<Survey>('/api/surveys', { method: 'POST', body: JSON.stringify(data) }),
  toggleSurvey: (id: number) => request<Survey>(`/api/surveys/${id}/toggle`, { method: 'PATCH' }),
  deleteSurvey: (id: number) => request<void>(`/api/surveys/${id}`, { method: 'DELETE' }),
  getSurveyResults: (id: number) => request<{ survey: Survey; answers: { option_index: number; count: number }[] }>(`/api/surveys/${id}/results`),


  // GPS real-time locations
  getTabletLocationsLive: () => request<TabletLiveLocation[]>('/api/tablets/locations/live'),
  getTabletLocationHistory: (id: number) =>
    request<{ tablet: { id: number; name: string }; locations: LocationPoint[] }>(`/api/tablets/${id}/location/history`),

  // Tiempo de standby (taxi parado), estimado del rastro GPS
  getTabletStandby: (id: number, date?: string) =>
    request<TabletStandby>(`/api/tablets/${id}/standby${date ? `?date=${date}` : ''}`),
};

export interface ApkVersionGroup {
  version: string;
  count: number;
  upToDate: boolean;
  tablets: { id: number; name: string; lastSync: string | null }[];
}
export interface ApkStatus {
  published: {
    versionCode: number | null;
    versionName: string | null;
    url: string | null;
    uploadedAt: string | null;
  };
  totalTablets: number;
  upToDate: number;
  versions: ApkVersionGroup[];
}

export interface StandbySegment {
  start: string; end: string; minutes: number; lat: number; lng: number;
}
export interface StandbyResult {
  standbyMinutes: number;
  movingMinutes: number;
  unknownMinutes: number;
  firstSeen: string | null;
  lastSeen: string | null;
  segments: StandbySegment[];
}
export interface TabletStandby extends StandbyResult {
  tablet: { id: number; name: string };
  date: string;
  points: number;
}

export interface User { id: number; email: string; name: string; role: string; }
export interface Client {
  id: number; name: string; email: string; phone?: string; company?: string;
  rut?: string | null; address?: string | null; color?: string | null;
  contactName?: string | null; contactPhone?: string | null;
  active: boolean; deletedAt?: string; createdAt: string; updatedAt: string;
}
export type ClientBulkAction = 'pause' | 'resume' | 'deactivate' | 'reactivate';
export type ClientState = 'active' | 'paused' | 'off';
/** Activa / pausada (sus anuncios no salen, el portal sigue) / desactivada. */
export function clientState(c: Pick<Client, 'active' | 'deletedAt'>): ClientState {
  if (c.deletedAt) return 'off';
  return c.active ? 'active' : 'paused';
}
export interface ClientProfile extends Client {
  ads: (Ad & { stats: { plays: number; totalSeconds: number } })[];
}
export interface Ad {
  id: number;
  /** Empresa dueña del anuncio (null sólo en anuncios viejos sin asignar). */
  clientId: number | null;
  client?: { id: number; name: string } | null;
  name: string;
  /** Nombre que ve la empresa en su portal; si falta, "Anuncio N". */
  publicName?: string | null;
  /** Lo mandó la empresa desde su portal (entra pendiente y sin playlists). */
  uploadedByClient?: boolean;
  type: 'video' | 'image'; fileUrl: string; thumbnailUrl?: string | null; filename: string;
  fileSize?: number | null;
  durationS: number; active: boolean; approvalStatus: string;
  priority: number; targetUrl?: string | null; startsAt?: string | null; endsAt?: string | null;
  tags: string[];
  deletedAt?: string; createdAt: string; updatedAt: string;
  /** Sólo en GET /api/ads: entrega real del anuncio y por qué no pasa (si aplica). */
  delivery?: AdDelivery;
}
export interface AdDelivery {
  plays: number;
  lastPlayedAt: string | null;
  playlists: { id: number; name: string; active: boolean; tablets: number }[];
  tablets: number;
  issue: { code: string; level: 'error' | 'info'; label: string } | null;
}
export interface PlaylistAd { id: number; adId: number; order: number; ad: Ad; }
export interface Playlist {
  id: number; name: string; version: number; contentHash?: string;
  /** Pausada: las tablets que la tienen pasan el institucional. */
  active: boolean;
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
  brightness?: number | null; brightnessAuto?: boolean | null; serial?: string | null;
  playerOk?: boolean | null; onFallback?: boolean | null; lastAdAgoS?: number | null; lastScreenshotAt?: string | null;
  lux?: number | null; lightSensor?: boolean | null;
  groupId?: number | null;
  playlistId?: number | null; playlist?: { id: number; name: string; version: number };
  /** Empresas con anuncios en la playlist asignada. */
  clients?: { id: number; name: string }[];
  lastSync?: string | null; status: 'online' | 'offline' | 'syncing';
  manualStatus?: 'activa' | 'mantenimiento' | 'bloqueada';
  rotated180?: boolean;
  createdAt: string; updatedAt: string;
}
export interface TabletDetail extends Tablet {
  errorLogs: { id: number; errorType: string; message: string; occurredAt: string }[];
  playsToday: number;
  playsAllTime: number;
  standbyToday: StandbyResult;
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
  health?: 'ok' | 'offline' | 'no-reproduce' | 'blocked' | 'sin-playlist' | 'taller';
  manualStatus?: 'activa' | 'mantenimiento' | 'bloqueada';
  driverName?: string | null;
  licensePlate?: string | null;
  playlist: { id: number; name: string } | null; todayPlays: number;
  batteryLevel: number | null;
  brightness: number | null;
  brightnessAuto: boolean | null;
  serial: string | null;
  appVersion: string | null;
  playerOk?: boolean | null;
  onFallback?: boolean | null;
  lux?: number | null;
  lightSensor?: boolean | null;
  lastAdAgoS?: number | null;
  hasScreenshot?: boolean;
  lastScreenshotAt?: string | null;
}
export interface AdDurationLimits {
  minSeconds: number; maxSeconds: number; defaultSeconds: number;
  /** maxSeconds null = usa el general. */
  clients: { id: number; name: string; active: boolean; maxSeconds: number | null }[];
}
export interface PortalInviteResult { sent: boolean; error?: string; expiresAt?: string }
export interface ClientPortalStatus {
  exists: boolean; email?: string; active?: boolean; activated?: boolean;
  invitedAt?: string | null; inviteExpiresAt?: string | null;
  lastLoginAt?: string | null; lastLoginIp?: string | null; lockedUntil?: string | null;
  events?: { action: string; ip: string | null; createdAt: string }[];
}
export interface StorageStats {
  totalBytes: number; totalMB: number; fileCount: number; adCount: number;
  quotaMB?: number; quotaBytes?: number; usedPct?: number;
}
export interface SystemStats {
  tablets: { total: number; online: number };
  clients: number; playlists: number; ads: number; totalPlays: number;
  dailyPlays: { date: string; count: number }[];
  playsByClient: { clientId: number; clientName: string; count: number }[];
  expiringAds: { id: number; name: string; clientName: string; endsAt: string; daysLeft: number }[];
}
export interface WeeklyEntry { week: string; from: string; to: string; count: number; }
export interface DailyEntry { date: string; count: number; }
export interface RangeStats {
  from: string; to: string; totalPlays: number;
  completedPlays: number;
  errorPlays: number;
  totalSeconds: number;
  distinctTablets: number;
  distinctAds: number;
  /** tablets = tablets distintas que reprodujeron ese día. */
  dailyPlays: { date: string; count: number; tablets: number }[];
  playsByClient: { clientId: number; clientName: string; count: number; seconds: number }[];
  playsByTablet: { tabletId: number; tabletName: string; count: number; seconds: number }[];
  playsByAd: {
    adId: number; adName: string; publicName: string | null; clientName: string | null;
    count: number; completed: number; errors: number; tablets: number; seconds: number;
  }[];
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
export interface DayHourCount { date: string; hour: number; count: number; }
export interface CompletionRate { adId: number; adName: string; totalPlays: number; completedPlays: number; completionRate: number; }
export interface PlaylistStat { playlistId: number; playlistName: string; tabletCount: number; totalPlays: number; }
export interface TabletAdPlay { tabletId: number; tabletName: string; adId: number; adName: string; count: number; }
export interface AdNoPlays {
  id: number; name: string; type: 'video' | 'image'; durationS: number; createdAt: string;
  client: { id: number; name: string } | null;
}

export interface SystemAlert {
  id: number; type: string; severity: 'info' | 'warning' | 'critical' | string;
  title: string; body: string | null; createdAt: string;
}
export interface Notifications {
  total: number; pendingAds: number; monitorAlerts?: number;
  systemAlerts?: SystemAlert[]; systemAlertCount?: number;
  expiringAds: { id: number; name: string; daysLeft: number }[];
  offlineTablets: { id: number; name: string; offlineMinutes: number | null }[];
}
export interface BandwidthStatus {
  frozen?: boolean;
  monthKey: string; monthGb: number; nextAlertGb: number;
  window: string; windowGb: number; windowBudgetGb: number;
  circuitOpen: boolean; offenders: { tabletId: number; count: number }[];
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

export type ArchivedAd = Ad;

export interface SyncInterval {
  tabletId: number; tabletName: string; zone: string | null;
  syncCount: number; avgMinutes: number | null;
}

export interface MetricRecord {
  id: number; tabletName: string; adName: string; clientName: string | null;
  playedAt: string; durationPlayedS: number; completed: boolean; error: boolean;
}

export interface MetricsPage {
  total: number; page: number; pages: number; records: MetricRecord[];
}

export interface AdminNote {
  id: number; body: string; authorName: string; createdAt: string;
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

export interface AbTest {
  id: number; name: string; status: string; createdAt: string;
  adAId: number; adBId: number;
  adA: { id: number; name: string; type: string };
  adB: { id: number; name: string; type: string };
  playsA?: number; playsB?: number; tabletsA?: number; tabletsB?: number;
}

export interface Referral {
  id: number; code: string; used: boolean; createdAt: string;
  referrerId: number; referredId: number | null;
  referrer: { id: number; name: string; company?: string | null };
  referred?: { id: number; name: string; company?: string | null } | null;
}

export interface DriverPointsEntry {
  id: number; tabletId: number; points: number; syncs30d: number; lastCalculated: string;
  tablet: { id: number; name: string; zone: string | null; driverName: string | null; licensePlate: string | null };
}

export interface Zone {
  id: number; name: string; description: string | null;
  polygon: [number, number][]; color: string; createdAt: string;
  tabletCount?: number;
}

export interface ApiKey {
  id: number; name: string; key: string;
  active: boolean; lastUsed: string | null; createdAt: string;
}

export interface Survey {
  id: number; question: string; options: string[];
  active: boolean; answer_count: number; created_at: string;
}

export interface TabletLiveLocation {
  id: number; name: string; zone: string | null; lastSync: string | null;
  batteryLevel: number | null;
  playlist: { id: number; name: string } | null;
  status: 'online' | 'offline';
  lat: number | null; lng: number | null;
  todayPlays: number;
}

export interface LocationPoint {
  lat: number; lng: number; accuracy: number | null; created_at: string;
}

// ── Mantenimiento ─────────────────────────────────────────────────────
export type MaintStatus = 'pendiente' | 'en_curso' | 'hecha' | 'cancelada';
export type MaintPriority = 'baja' | 'normal' | 'alta' | 'urgente';
export interface MaintChecklistItem { label: string; done: boolean }
export interface MaintPhoto { url: string; key?: string | null; kind: 'antes' | 'despues' | 'otra'; at?: string }
export interface MaintOrderPart { partId: number; qty: number; name?: string | null }
export interface MaintOrder {
  id: number; tabletId: number | null; tabletName: string | null; type: string; title: string;
  status: MaintStatus; priority: MaintPriority; scheduledFor: string | null; assignee: string | null;
  notes: string | null; resolution: string | null; checklist: MaintChecklistItem[]; photos: MaintPhoto[];
  parts: MaintOrderPart[]; partsApplied: boolean; workshop: boolean; source: 'manual' | 'alerta' | 'recurrente' | string;
  alertCode: string | null; ruleId: number | null; createdBy: string | null;
  createdAt: string; updatedAt: string; startedAt: string | null; completedAt: string | null;
}
export interface MaintOrderInput {
  type?: string; title?: string; priority?: MaintPriority; scheduledFor?: string | null; assignee?: string | null;
  notes?: string | null; workshop?: boolean; source?: string; alertCode?: string | null;
}
export interface MaintMeta {
  types: Record<string, string>; statuses: MaintStatus[]; priorities: MaintPriority[]; checklists: Record<string, string[]>;
}
export interface MaintAlert {
  code: string; level: 'danger' | 'warn' | 'info'; label: string; detail: string;
  tabletId: number; tabletName: string; zone: string | null; driverName: string | null; licensePlate: string | null;
  suggestedType: string; orderId: number | null; openOrders: number;
}
export interface MaintPart {
  id: number; name: string; category: string | null; unit: string; stock: number; minStock: number;
  notes: string | null; active: boolean; low: boolean; createdAt: string; updatedAt: string;
}
export interface MaintAlertsResponse {
  alerts: MaintAlert[]; workshop: { id: number; name: string; zone: string | null }[];
  lowStock: MaintPart[]; batteryThreshold: number; publishedVersion: string | null;
}
export interface MaintRule {
  id: number; name: string; type: string; everyDays: number; leadDays: number; scope: 'all' | 'group' | 'tablet';
  scopeId: number | null; assignee: string | null; notify: boolean; active: boolean; startsAt: string;
  lastRunAt: string | null; createdAt: string; updatedAt: string;
}
export interface MaintRuleInput {
  name: string; type: string; everyDays: number; leadDays?: number; scope: 'all' | 'group' | 'tablet';
  scopeId?: number | null; assignee?: string | null; notify?: boolean; startsAt?: string;
}
export interface MaintDiagnostic {
  tablet: {
    id: number; name: string; zone: string | null; lastSync: string | null; lastIp: string | null; batteryLevel: number | null;
    temperatureC: number | null; appVersion: string | null; osVersion: string | null; deviceModel: string | null; serial: string | null;
    brightness: number | null; brightnessAuto: boolean | null; playerOk: boolean | null; onFallback: boolean | null;
    lastAdAgoS: number | null; manualStatus: string; playlistId: number | null;
    playlist: { id: number; name: string; version: number } | null; lastScreenshotAt: string | null;
  };
  errors: { errorType: string; message: string; occurredAt: string }[];
  syncs24h: { total: number; failed: number };
  full: { data: Record<string, unknown>; at: string } | null;
  pending: boolean; supportsFull: boolean;
}

export { BASE };
