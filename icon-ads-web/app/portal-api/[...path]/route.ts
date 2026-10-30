// Proxy del portal de empresas: el navegador habla SOLO con este dominio y
// acá se reenvía al backend. Por qué:
//  - la cookie de sesión queda en el mismo dominio (httpOnly, SameSite=Strict,
//    path /portal-api): funciona en iPhone y JavaScript no la puede leer;
//  - el backend sólo acepta pedidos firmados con PORTAL_PROXY_SECRET, así que
//    nadie puede pegarle directo a /api/portal salteando estos controles;
//  - se pasa la IP real del visitante (Vercel la pone en x-real-ip /
//    x-forwarded-for y no se puede falsificar) para limitar intentos.
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const SECRET = process.env.PORTAL_PROXY_SECRET ?? '';

const ROUTES: Record<string, 'GET' | 'POST'> = {
  'login': 'POST',
  'logout': 'POST',
  'activate': 'POST',
  'password/forgot': 'POST',
  'password/reset': 'POST',
  'password/change': 'POST',
  'me': 'GET',
  'ads': 'GET',
  'uploads': 'GET',
  'upload-ticket': 'POST',
  'stats': 'GET',
  'report.pdf': 'GET',
};

const json = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

function clientIp(req: NextRequest): string {
  return req.headers.get('x-real-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? '';
}

// Anti-CSRF: los POST tienen que venir de una página de este mismo sitio.
function sameOrigin(req: NextRequest): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = req.headers.get('origin');
  if (!origin) return !!site;
  try { return new URL(origin).host === req.nextUrl.host; } catch { return false; }
}

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }, method: 'GET' | 'POST') {
  const { path } = await ctx.params;
  const route = path.join('/');
  if (ROUTES[route] !== method) return json(404, 'No encontrado');
  if (SECRET.length < 32) return json(503, 'El portal no está disponible.');
  if (method === 'POST' && !sameOrigin(req)) return json(403, 'Forbidden');

  const headers: Record<string, string> = {
    'x-portal-proxy-secret': SECRET,
    'x-portal-client-ip': clientIp(req),
    'accept': req.headers.get('accept') ?? 'application/json',
  };
  const session = req.cookies.get('portal_session')?.value;
  if (session) headers.cookie = `portal_session=${session}`;

  let body: string | undefined;
  if (method === 'POST') {
    body = await req.text();
    if (body.length > 10_000) return json(413, 'Pedido demasiado grande');
    headers['content-type'] = 'application/json';
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API}/api/portal/${route}${req.nextUrl.search}`, {
      method, headers, body, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return json(502, 'No pudimos conectar con el servidor. Probá de nuevo en un momento.');
  }

  const out = new Headers({ 'Cache-Control': 'no-store' });
  for (const h of ['content-type', 'content-disposition', 'retry-after']) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  for (const c of upstream.headers.getSetCookie()) {
    if (c.startsWith('portal_session=')) out.append('set-cookie', c);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx, 'GET');
}
export function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx, 'POST');
}
