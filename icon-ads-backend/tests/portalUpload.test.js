/**
 * Portal de empresas: subida de anuncios. La empresa sale del permiso (nunca
 * del formulario), el anuncio entra pendiente y sin playlists, y el permiso
 * sirve una sola vez. DB simulada en memoria; el storage también.
 */
process.env.JWT_SECRET = 'test-secret-only';
process.env.PORTAL_PROXY_SECRET = 'proxy-secret-for-tests-0123456789abcdef';

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');

const mockDb = {
  clients: [
    { id: 1, name: 'Empresa Uno', active: true, deletedAt: null },
    { id: 2, name: 'Empresa Dos', active: true, deletedAt: null },
  ],
  clientUsers: [
    { id: 100, clientId: 1, email: 'uno@empresa.com', passwordHash: 'x', active: true, sessionVersion: 0 },
    { id: 200, clientId: 2, email: 'dos@empresa.com', passwordHash: 'x', active: true, sessionVersion: 0 },
  ],
  ads: [
    { id: 20, clientId: 2, publicName: 'De la otra', type: 'image', durationS: 10, approvalStatus: 'pending', uploadedByClient: true, deletedAt: null, createdAt: new Date() },
  ],
};
const mockMatches = (row, where = {}) => Object.entries(where).every(([k, v]) => row[k] === v);

jest.mock('../src/lib/prisma', () => ({
  clientUser: {
    findUnique: jest.fn(async ({ where }) => {
      const cu = mockDb.clientUsers.find((u) => mockMatches(u, where));
      return cu ? { ...cu, client: mockDb.clients.find((c) => c.id === cu.clientId) } : null;
    }),
  },
  ad: {
    count: jest.fn(async ({ where }) => mockDb.ads.filter((a) => mockMatches(a, where)).length),
    findMany: jest.fn(async ({ where }) => mockDb.ads.filter((a) => mockMatches(a, where))),
    create: jest.fn(async ({ data }) => {
      const ad = { id: 1000 + mockDb.ads.length, active: true, deletedAt: null, createdAt: new Date(), ...data };
      mockDb.ads.push(ad);
      return ad;
    }),
  },
  auditLog: { create: jest.fn(async () => ({})) },
}));
jest.mock('../src/lib/alerts', () => ({ sendAlert: jest.fn(async () => {}) }));
jest.mock('../src/lib/portalMailer', () => ({ sendReset: jest.fn(async () => ({ sent: true })) }));
jest.mock('../src/lib/adFile', () => ({
  ...jest.requireActual('../src/lib/adFile'),
  storeAdFile: jest.fn(async (buf, name) => ({ fileUrl: `https://media.test/${name}`, filename: name, storage: 'r2', diskPath: null })),
}));

const portalRoutes = require('../src/routes/portal');
const portalUploadRoutes = require('../src/routes/portalUpload');
const { signSession } = require('../src/lib/portalAuth');
const { signPanelToken } = require('../src/middleware/auth');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/portal', portalRoutes);
app.use('/api/portal-upload', portalUploadRoutes);

const PROXY = { 'x-portal-proxy-secret': process.env.PORTAL_PROXY_SECRET, 'x-portal-client-ip': '203.0.113.7' };
const cookieFor = (id) => `portal_session=${signSession(mockDb.clientUsers.find((u) => u.id === id))}`;
// Cabecera PNG válida + relleno (sharp no la puede leer y se guarda tal cual).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64, 1)]);

async function ticketFor(id) {
  const res = await request(app).post('/api/portal/upload-ticket').set(PROXY).set('Cookie', cookieFor(id)).send({});
  expect(res.status).toBe(200);
  return res.body.ticket;
}
const send = (ticket, fields = { publicName: 'Promo verano' }, file = PNG, name = 'promo.png') => {
  const req = request(app).post('/api/portal-upload').set('Authorization', `Bearer ${ticket}`);
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  return req.attach('file', file, name);
};

describe('subida de anuncios desde el portal', () => {
  it('el anuncio queda pendiente, sin playlists y de la empresa del permiso', async () => {
    const ticket = await ticketFor(100);
    // Aunque el formulario diga otra empresa, manda la del permiso.
    const res = await send(ticket, { publicName: 'Promo verano', clientId: 2, durationS: 15 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('revision');
    const ad = mockDb.ads.find((a) => a.id === res.body.id);
    expect(ad).toMatchObject({ clientId: 1, publicName: 'Promo verano', approvalStatus: 'pending', uploadedByClient: true, type: 'image', durationS: 15 });
  });

  it('el permiso sirve una sola vez', async () => {
    const ticket = await ticketFor(100);
    expect((await send(ticket)).status).toBe(201);
    expect((await send(ticket)).status).toBe(401);
  });

  it('sin permiso, con la cookie de sesión o con un token del panel no se sube nada', async () => {
    expect((await request(app).post('/api/portal-upload').attach('file', PNG, 'a.png')).status).toBe(401);
    const session = signSession(mockDb.clientUsers[0]);
    expect((await send(session)).status).toBe(401);
    const panel = signPanelToken({ id: 1, email: 'admin@x.com', role: 'superadmin' }, '1h');
    expect((await send(panel)).status).toBe(401);
  });

  it('el permiso deja de valer si se cortan las sesiones de la empresa', async () => {
    const ticket = await ticketFor(100);
    mockDb.clientUsers[0].sessionVersion += 1;
    expect((await send(ticket)).status).toBe(401);
  });

  it('rechaza archivos que no son imagen o video de verdad', async () => {
    const ticket = await ticketFor(200);
    const res = await send(ticket, { publicName: 'Falso' }, Buffer.from('esto no es una imagen, es texto plano'), 'falso.png');
    expect(res.status).toBe(400);
  });

  it('exige un nombre para el anuncio', async () => {
    const ticket = await ticketFor(200);
    const res = await send(ticket, { publicName: '   ' });
    expect(res.status).toBe(400);
  });

  it('cada empresa ve sólo lo que mandó ella', async () => {
    const res = await request(app).get('/api/portal/uploads').set(PROXY).set('Cookie', cookieFor(200));
    expect(res.status).toBe(200);
    expect(res.body.map((a) => a.name)).toEqual(['De la otra']);
    expect(res.body[0]).not.toHaveProperty('fileUrl');
  });

  it('frena cuando hay demasiados pendientes de revisión', async () => {
    for (let i = 0; i < 10; i++) {
      mockDb.ads.push({ id: 5000 + i, clientId: 2, publicName: `p${i}`, type: 'image', durationS: 10, approvalStatus: 'pending', uploadedByClient: true, deletedAt: null, createdAt: new Date() });
    }
    const res = await request(app).post('/api/portal/upload-ticket').set(PROXY).set('Cookie', cookieFor(200)).send({});
    expect(res.status).toBe(429);
  });
});
