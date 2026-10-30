/**
 * Estado de la empresa y lo que sale en las tablets: una empresa pausada o
 * desactivada no tiene anuncios al aire.
 */
jest.mock('../src/lib/prisma', () => ({}));

const { isAdPlayable } = require('../src/lib/adSchedule');
const { blockingIssue } = require('../src/lib/adDelivery');

const ad = (client) => ({
  id: 1, clientId: 1, active: true, deletedAt: null, approvalStatus: 'approved', startsAt: null, endsAt: null, client,
});
const playlists = [{ id: 1, active: true, tablets: 3 }];

describe('estado de la empresa', () => {
  it('empresa activa: el anuncio sale', () => {
    expect(isAdPlayable(ad({ active: true, deletedAt: null }))).toBe(true);
    expect(blockingIssue(ad({ active: true, deletedAt: null }), playlists, new Date())).toBeNull();
  });
  it('empresa pausada: no sale y el panel dice por qué', () => {
    expect(isAdPlayable(ad({ active: false, deletedAt: null }))).toBe(false);
    expect(blockingIssue(ad({ active: false, deletedAt: null }), playlists, new Date()).code).toBe('client_paused');
  });
  it('empresa desactivada: no sale', () => {
    expect(isAdPlayable(ad({ active: false, deletedAt: new Date() }))).toBe(false);
    expect(blockingIssue(ad({ active: false, deletedAt: new Date() }), playlists, new Date()).code).toBe('client_off');
  });
  it('sin datos de la empresa en la consulta no frena (anuncios viejos sin empresa)', () => {
    expect(isAdPlayable(ad(undefined))).toBe(true);
  });
});
