// Cliente del portal de empresas. Todo pasa por /portal-api (proxy en este
// mismo dominio); la sesión es una cookie httpOnly que este código no ve.

export type PortalAdStatus = 'activo' | 'programado' | 'pausado' | 'finalizado';

/** Un anuncio de la empresa. name = nombre público, o "Anuncio N". */
export interface PortalAd {
  id: number; name: string; type: 'video' | 'image';
  startsAt: string | null; endsAt: string | null; status: PortalAdStatus;
  totalPlays: number; lastPlayAt: string | null;
  /** Taxis cuya playlist tiene el anuncio. */
  tabletsAssigned: number;
}

export interface PortalStats {
  from: string; to: string;
  totals: {
    plays: number; tabletsAssigned: number; previousPlays: number;
    /** % contra el período anterior de igual duración; null si no hubo datos antes. */
    changePct: number | null;
  };
  daily: { date: string; count: number }[];
  byAd: {
    id: number; name: string; type: 'video' | 'image'; status: PortalAdStatus; plays: number; tabletsAssigned: number;
  }[];
}

export type PortalUploadStatus = 'revision' | 'aprobado' | 'rechazado';

/** Un anuncio que la empresa mandó desde el portal. */
export interface PortalUpload {
  id: number; name: string; type: 'video' | 'image'; durationS: number;
  status: PortalUploadStatus; createdAt: string;
}

// La duración máxima no es fija: la define el admin por empresa (PortalMe.maxAdSeconds).
export const UPLOAD_LIMITS = { videoMb: 100, imageMb: 10, imageDurations: [5, 10, 15, 20, 30] };

export interface PortalMe { clientName: string; email: string; maxAdSeconds: number }

export class PortalError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/portal-api/${path}`, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PortalError(body.error ?? `Error ${res.status}`, res.status);
  return body as T;
}

const post = <T>(path: string, data: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(data) });

export const portal = {
  me: () => call<PortalMe>('me'),
  login: (email: string, password: string) => post<{ ok: true }>('login', { email, password }),
  logout: () => post<{ ok: true }>('logout'),
  activate: (token: string, password: string) => post<{ ok: true }>('activate', { token, password }),
  resetPassword: (token: string, password: string) => post<{ ok: true }>('password/reset', { token, password }),
  forgotPassword: (email: string) => post<{ message: string }>('password/forgot', { email }),
  changePassword: (currentPassword: string, newPassword: string) => post<{ ok: true }>('password/change', { currentPassword, newPassword }),
  ads: () => call<PortalAd[]>('ads'),
  stats: (q: URLSearchParams) => call<PortalStats>(`stats?${q}`),
  reportUrl: (q: URLSearchParams) => `/portal-api/report.pdf?${q}`,
  uploads: () => call<PortalUpload[]>('uploads'),
  uploadAd,
};

const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

// El archivo no puede pasar por /portal-api (Vercel corta los pedidos de más
// de ~4,5 MB): se pide por el proxy un permiso de un solo uso y con él el
// archivo va directo al backend.
async function uploadAd(file: File, fields: { publicName: string; durationS: number }, onProgress: (pct: number) => void): Promise<PortalUpload> {
  const { ticket } = await post<{ ticket: string }>('upload-ticket');
  const form = new FormData();
  form.append('publicName', fields.publicName);
  if (fields.durationS > 0) form.append('durationS', String(fields.durationS));
  form.append('file', file);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/api/portal-upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${ticket}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let body: { error?: string } = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* respuesta no JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as PortalUpload);
      else reject(new PortalError(body.error ?? `Error ${xhr.status}`, xhr.status));
    };
    xhr.onerror = () => reject(new PortalError('Se cortó la conexión mientras subía el archivo. Probá de nuevo.', 0));
    xhr.send(form);
  });
}

// Mismas reglas que el backend, para avisar antes de mandar.
export function passwordHint(password: string, confirm: string): string | null {
  if (password.length < 10) return 'Al menos 10 caracteres.';
  if (password !== confirm) return 'Las contraseñas no coinciden.';
  return null;
}
