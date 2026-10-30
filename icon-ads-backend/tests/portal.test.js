/**
 * Portal de empresas: aislamiento entre empresas y separación con el panel.
 * Usa una DB simulada en memoria (no necesita Postgres).
 */
process.env.JWT_SECRET = 'test-secret-only';
process.env.PORTAL_PROXY_SECRET = 'proxy-secret-for-tests-0123456789abcdef';

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

// ── DB simulada ─────────────────────────────────────────────────────────────
const mockDb = {
  clients: [
    { id: 1, name: 'Empresa Uno', active: true, deletedAt: null },
    { id: 2, name: 'Empresa Dos', active: true, deletedAt: null },
  ],
  clientUsers: [],
  // Los dos anuncios están en la MISMA playlist (las playlists mezclan
  // empresas): la empresa 1 no tiene que ver nada del anuncio 20.
  ads: [
    { id: 10, clientId: 1, name: 'archivo_uno_1920x1080.mp4', publicName: null, type: 'video', active: true, approvalStatus: 'approved', startsAt: null, endsAt: null, deletedAt: null, createdAt: new Date('2026-01-01') },
    { id: 20, clientId: 2, name: 'archivo_dos.jpg', publicName: 'Promo Dos', type: 'image', active: true, approvalStatus: 'approved', startsAt: null, endsAt: null, deletedAt: null, createdAt: new Date('2026-01-01') },
  ],
  playlistAds: [{ adId: 10, playlistId: 5 }, { adId: 20, playlistId: 5 }],
  tablets: [{ id: 1, playlistId: 5 }, { id: 2, playlistId: 5 }],
  rawQueries: [],
};
const PASSWORD = 'Un4-clave-larga!';

function mockMatches(row, where = {}) {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'in' in v) return v.in.includes(row[k]);
    return row[k] === v;
  });
}
function mockWithClient(cu) {
  if (!cu) return null;
  return { ...cu, client: mockDb.clients.find((c) => c.id === cu.clientId) };
}
function mockApplyData(row, data) {
  for (const [k, v] of Object.entries(data)) {
    row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : v;
  }
  return row;
}

jest.mock('../src/lib/prisma', () => ({
  clientUser: {
    findUnique: jest.fn(async ({ where }) => mockWithClient(mockDb.clientUsers.find((u) => mockMatches(u, where)))),
    update: jest.fn(async ({ where, data }) => mockApplyData(mockDb.clientUsers.find((u) => mockMatches(u, where)), data)),
  },
  ad: {
    findMany: jest.fn(async ({ where }) => mockDb.ads.filter((a) => a.clientId === where.clientId)),
  },
  playlistAd: {
    findMany: jest.fn(async ({ where }) => mockDb.playlistAds.filter((l) => where.adId.in.includes(l.adId))),
  },
  tablet: {
    findMany: jest.fn(async ({ where }) => mockDb.tablets.filter((t) => where.playlistId.in.includes(t.playlistId))),
  },
  metric: { groupBy: jest.fn(async () => []) },
  auditLog: { create: jest.fn(async () => ({})) },
  $queryRaw: jest.fn(async (sql) => { mockDb.rawQueries.push(sql); return []; }),
}));
jest.mock('../src/lib/alerts', () => ({ sendAlert: jest.fn(async () => {}) }));
jest.mock('../src/lib/portalMailer', () => ({ sendReset: jest.fn(async () => ({ sent: true })) }));

const portalRoutes = require('../src/routes/portal');
const { requireAuth, signPanelToken } = require('../src/middleware/auth');
const { signSession } = require('../src/lib/portalAuth');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/portal', portalRoutes);
app.get('/api/panel-thing', requireAuth, (req, res) => res.json({ secret: 'datos del panel' }));

const PROXY = { 'x-portal-proxy-secret': process.env.PORTAL_PROXY_SECRET, 'x-portal-client-ip': '203.0.113.7' };
const sessionCookie = (cu) => `portal_session=${signSession(cu)}`;

beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  mockDb.clientUsers.push(
    { id: 100, clientId: 1, email: 'uno@empresa.com', passwordHash, active: true, sessionVersion: 0, failedLogins: 0, lockedUntil: null },
    { id: 200, clientId: 2, email: 'dos@empresa.com', passwordHash, active: true, sessionVersion: 0, failedLogins: 0, lockedUntil: null },
  );
});
beforeEach(() => { mockDb.rawQueries.length = 0; });

describe('acceso sólo por el proxy', () => {
  it('rechaza pedidos sin el secreto del proxy', async () => {
    const res = await request(app).post('/api/portal/login').send({ email: 'uno@empresa.com', password: PASSWORD });
    expect(res.status).toBe(403);
  });
  it('rechaza un secreto de proxy incorrecto', async () => {
    const res = await request(app).get('/api/portal/me').set({ ...PROXY, 'x-portal-proxy-secret': 'otro' });
    expect(res.status).toBe(403);
  });
});

describe('login', () => {
  it('entra con la contraseña correcta y deja una cookie httpOnly acotada a /portal-api', async () => {
    const res = await request(app).post('/api/portal/login').set(PROXY).send({ email: 'UNO@empresa.com', password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/portal_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/portal-api/);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });
  it('mismo mensaje para email inexistente y contraseña incorrecta', async () => {
    const a = await request(app).post('/api/portal/login').set(PROXY).send({ email: 'nadie@x.com', password: 'loquesea123' });
    const b = await request(app).post('/api/portal/login').set(PROXY).send({ email: 'dos@empresa.com', password: 'incorrecta-123' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
    mockDb.clientUsers.find((u) => u.id === 200).failedLogins = 0;
  });
  it('tras 5 fallos frena la cuenta (aun con la contraseña correcta) sin revelarlo', async () => {
    const cu = mockDb.clientUsers.find((u) => u.id === 200);
    cu.failedLogins = 4;
    await request(app).post('/api/portal/login').set(PROXY).send({ email: 'dos@empresa.com', password: 'mal-mal-mal-1' });
    expect(cu.lockedUntil).toBeInstanceOf(Date);
    const res = await request(app).post('/api/portal/login').set(PROXY).send({ email: 'dos@empresa.com', password: PASSWORD });
    expect(res.status).toBe(401);
    cu.failedLogins = 0; cu.lockedUntil = null;
  });
});

describe('separación panel / portal', () => {
  it('una sesión del portal NO entra a rutas del panel', async () => {
    const cu = mockDb.clientUsers[0];
    const token = signSession(cu);
    const res = await request(app).get('/api/panel-thing').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    const res2 = await request(app).get('/api/panel-thing').set('Cookie', `token=${token}`);
    expect(res2.status).toBe(401);
  });
  it('una sesión del panel NO entra al portal', async () => {
    const panel = signPanelToken({ id: 1, email: 'admin@x.com', role: 'superadmin' }, '1h');
    const res = await request(app).get('/api/portal/me').set(PROXY).set('Cookie', `portal_session=${panel}`);
    expect(res.status).toBe(401);
  });
});

describe('aislamiento entre empresas', () => {
  it('/me devuelve sólo la empresa de la sesión', async () => {
    const res = await request(app).get('/api/portal/me').set(PROXY).set('Cookie', sessionCookie(mockDb.clientUsers[0]));
    expect(res.status).toBe(200);
    expect(res.body.clientName).toBe('Empresa Uno');
  });
  it('/ads lista sólo sus anuncios, sin el nombre interno', async () => {
    const res = await request(app).get('/api/portal/ads').set(PROXY).set('Cookie', sessionCookie(mockDb.clientUsers[0]));
    expect(res.status).toBe(200);
    expect(res.body.map((a) => a.id)).toEqual([10]);
    expect(res.body[0].name).toBe('Anuncio 1');
    expect(JSON.stringify(res.body)).not.toMatch(/archivo_/);
    expect(res.body[0].tabletsNow).toBe(2);
  });
  it('pedir el anuncio de otra empresa da 404', async () => {
    for (const p of ['/api/portal/stats?adId=20', '/api/portal/report.pdf?adId=20']) {
      const res = await request(app).get(p).set(PROXY).set('Cookie', sessionCookie(mockDb.clientUsers[0]));
      expect(res.status).toBe(404);
    }
    expect(mockDb.rawQueries).toHaveLength(0);
  });
  it('las consultas de estadísticas sólo usan anuncios propios', async () => {
    const res = await request(app).get('/api/portal/stats?clientId=2').set(PROXY).set('Cookie', sessionCookie(mockDb.clientUsers[0]));
    expect(res.status).toBe(200);
    expect(mockDb.rawQueries.length).toBeGreaterThan(0);
    for (const q of mockDb.rawQueries) {
      expect(q.values).toContain(10);
      expect(q.values).not.toContain(20);
    }
  });
  it('las estadísticas no traen nombres internos ni anuncios ajenos', async () => {
    const res = await request(app).get('/api/portal/stats').set(PROXY).set('Cookie', sessionCookie(mockDb.clientUsers[0]));
    expect(res.status).toBe(200);
    expect(res.body.byAd.map((a) => a.id)).toEqual([10]);
    expect(JSON.stringify(res.body)).not.toMatch(/archivo_|Promo Dos/);
    expect(res.body.totals.tabletsNow).toBe(2);
  });
  it('un id de anuncio no numérico da 404', async () => {
    const res = await request(app).get('/api/portal/stats?adId=10%20OR%201=1').set(PROXY).set('Cookie', sessionCookie(mockDb.clientUsers[0]));
    expect(res.status).toBe(404);
  });
});

describe('cortar el acceso', () => {
  it('subir sessionVersion invalida la sesión al instante', async () => {
    const cu = mockDb.clientUsers[0];
    const cookie = sessionCookie(cu);
    cu.sessionVersion += 1;
    const res = await request(app).get('/api/portal/me').set(PROXY).set('Cookie', cookie);
    expect(res.status).toBe(401);
  });
  it('una cuenta desactivada no entra', async () => {
    const cu = mockDb.clientUsers[1];
    const cookie = sessionCookie(cu);
    cu.active = false;
    expect((await request(app).get('/api/portal/me').set(PROXY).set('Cookie', cookie)).status).toBe(401);
    cu.active = true;
  });
  it('si la empresa se da de baja, su sesión deja de valer', async () => {
    const cu = mockDb.clientUsers[1];
    const cookie = sessionCookie(cu);
    mockDb.clients[1].deletedAt = new Date();
    expect((await request(app).get('/api/portal/me').set(PROXY).set('Cookie', cookie)).status).toBe(401);
    mockDb.clients[1].deletedAt = null;
  });
});

describe('política de contraseñas', () => {
  const { passwordProblem } = require('../src/lib/portalAuth');
  it.each(['corta1', '1234567890', 'iconads2026!', 'aaaaaaaaaaaa', 'Contacto2026'])('rechaza %s', (p) => {
    expect(passwordProblem(p, 'contacto@empresa.com')).not.toBeNull();
  });
  it('acepta una contraseña razonable', () => {
    expect(passwordProblem('Taxi-Verde-2026', 'uno@empresa.com')).toBeNull();
  });
});

describe('PDF', () => {
  it('genera el reporte de los anuncios propios', async () => {
    const res = await request(app).get('/api/portal/report.pdf?from=2026-10-01&to=2026-10-07').set(PROXY)
      .set('Cookie', sessionCookie(mockDb.clientUsers.find((u) => u.id === 200)))
      .buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
    if (process.env.PDF_OUT) require('fs').writeFileSync(process.env.PDF_OUT, res.body);
  });
});
