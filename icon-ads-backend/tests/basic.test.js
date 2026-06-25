/**
 * Tests básicos de endpoints críticos.
 * Requieren: DATABASE_URL apuntando a una DB de test, JWT_SECRET seteado.
 * Correr con: npm test
 */
const request = require('supertest');

// Vars mínimas antes de importar la app
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-only';
process.env.FRONTEND_URL = 'http://localhost:3001';

let app;

beforeAll(() => {
  // Importar app después de setear env vars
  app = require('../src/app');
});

// ── /api/health ──────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('responde 200 con los campos esperados', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('db');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('version');
  });
});

// ── /api/auth/login ──────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('rechaza credenciales vacías con 400', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rechaza email inválido con 4xx', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'no-existe@iconads.com', password: 'wrong' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

// ── /api/device/sync (requiere token de dispositivo) ─────────────────────────

describe('GET /api/device/sync', () => {
  it('rechaza sin Authorization header con 401', async () => {
    const res = await request(app).get('/api/device/sync?version=0');
    expect(res.status).toBe(401);
  });
});

// ── /api/device/metrics ──────────────────────────────────────────────────────

describe('POST /api/device/metrics', () => {
  it('rechaza sin Authorization header con 401', async () => {
    const res = await request(app)
      .post('/api/device/metrics')
      .send({ metrics: [] });
    expect(res.status).toBe(401);
  });
});

// ── /api/tablets ─────────────────────────────────────────────────────────────

describe('GET /api/tablets', () => {
  it('rechaza sin token JWT con 401', async () => {
    const res = await request(app).get('/api/tablets');
    expect(res.status).toBe(401);
  });
});
