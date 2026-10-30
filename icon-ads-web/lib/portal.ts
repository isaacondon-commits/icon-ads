// Cliente del portal de empresas. Todo pasa por /portal-api (proxy en este
// mismo dominio); la sesión es una cookie httpOnly que este código no ve.

export type PortalAdStatus = 'activo' | 'programado' | 'pausado' | 'finalizado';

/** Un anuncio de la empresa. name = nombre público, o "Anuncio N". */
export interface PortalAd {
  id: number; name: string; type: 'video' | 'image';
  startsAt: string | null; endsAt: string | null; status: PortalAdStatus;
  totalPlays: number; lastPlayAt: string | null;
  /** Tablets donde está corriendo ahora. */
  tabletsNow: number;
}

export interface PortalStats {
  from: string; to: string;
  totals: {
    plays: number; completedPlays: number; completionRate: number; tablets: number; tabletsNow: number;
    secondsOnScreen: number; previousPlays: number;
    /** % contra el período anterior de igual duración; null si no hubo datos antes. */
    changePct: number | null;
  };
  daily: { date: string; count: number }[];
  hourly: { hour: number; count: number }[];
  byAd: {
    id: number; name: string; type: 'video' | 'image'; status: PortalAdStatus; plays: number;
    completionRate: number; tablets: number; secondsOnScreen: number; tabletsNow: number;
  }[];
}

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
  me: () => call<{ clientName: string; email: string }>('me'),
  login: (email: string, password: string) => post<{ ok: true }>('login', { email, password }),
  logout: () => post<{ ok: true }>('logout'),
  activate: (token: string, password: string) => post<{ ok: true }>('activate', { token, password }),
  resetPassword: (token: string, password: string) => post<{ ok: true }>('password/reset', { token, password }),
  forgotPassword: (email: string) => post<{ message: string }>('password/forgot', { email }),
  changePassword: (currentPassword: string, newPassword: string) => post<{ ok: true }>('password/change', { currentPassword, newPassword }),
  ads: () => call<PortalAd[]>('ads'),
  stats: (q: URLSearchParams) => call<PortalStats>(`stats?${q}`),
  reportUrl: (q: URLSearchParams) => `/portal-api/report.pdf?${q}`,
};

// Mismas reglas que el backend, para avisar antes de mandar.
export function passwordHint(password: string, confirm: string): string | null {
  if (password.length < 10) return 'Al menos 10 caracteres.';
  if (password !== confirm) return 'Las contraseñas no coinciden.';
  return null;
}
