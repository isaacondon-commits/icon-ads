/**
 * Sesiones del panel: sólo pasan tokens firmados para el panel (aud='panel')
 * con un rol de administración. No necesita DB.
 */
process.env.JWT_SECRET = 'test-secret-only';

const jwt = require('jsonwebtoken');
const { requireAuth, signPanelToken, verifyPanelToken } = require('../src/middleware/auth');

function run(token) {
  const req = { cookies: { token }, headers: {} };
  const res = { code: 200, status(c) { this.code = c; return this; }, json() { return this; } };
  let passed = false;
  requireAuth(req, res, () => { passed = true; });
  return { passed, code: res.code, user: req.user };
}

describe('requireAuth (panel)', () => {
  it('acepta una sesión del panel', () => {
    const r = run(signPanelToken({ id: 1, email: 'a@b.com', role: 'admin' }, '1h'));
    expect(r.passed).toBe(true);
    expect(r.user.role).toBe('admin');
  });

  it.each(['superadmin', 'admin', 'supervisor', 'operator'])('acepta el rol %s', (role) => {
    expect(run(signPanelToken({ id: 1, email: 'a@b.com', role }, '1h')).passed).toBe(true);
  });

  it('rechaza un token sin audiencia del panel (formato viejo)', () => {
    const t = jwt.sign({ id: 1, email: 'a@b.com', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    expect(run(t)).toMatchObject({ passed: false, code: 401 });
  });

  it('rechaza un token de otra audiencia (p. ej. portal de clientes)', () => {
    const t = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h', audience: 'portal' });
    expect(run(t)).toMatchObject({ passed: false, code: 401 });
  });

  it('rechaza un rol que no es del panel', () => {
    const t = signPanelToken({ id: 5, email: 'c@d.com', role: 'client' }, '1h');
    expect(run(t)).toMatchObject({ passed: false, code: 401 });
  });

  it('rechaza un token firmado con otra clave', () => {
    const t = jwt.sign({ id: 1, role: 'admin' }, 'otra-clave', { expiresIn: '1h', audience: 'panel' });
    expect(run(t)).toMatchObject({ passed: false, code: 401 });
  });

  it('rechaza alg "none"', () => {
    const t = jwt.sign({ id: 1, role: 'admin', aud: 'panel' }, null, { algorithm: 'none' });
    expect(verifyPanelToken(t)).toBeNull();
  });

  it('rechaza un token vencido', () => {
    const t = jwt.sign({ id: 1, role: 'admin', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET, { audience: 'panel' });
    expect(run(t)).toMatchObject({ passed: false, code: 401 });
  });

  it('rechaza sin token', () => {
    expect(run(undefined)).toMatchObject({ passed: false, code: 401 });
  });
});
