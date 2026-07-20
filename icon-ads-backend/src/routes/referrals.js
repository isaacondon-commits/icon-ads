const router = require('express').Router();
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  next();
});

// GET /api/referrals
router.get('/', async (req, res, next) => {
  try {
    const referrals = await prisma.referral.findMany({
      include: {
        referrer: { select: { id: true, name: true, company: true } },
        referred: { select: { id: true, name: true, company: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(referrals);
  } catch (err) { next(err); }
});

// POST /api/referrals — generate a referral code for a client
router.post('/', async (req, res, next) => {
  try {
    const { referrerId } = req.body;
    if (!referrerId) return res.status(400).json({ error: 'referrerId required' });
    const client = await prisma.client.findUnique({ where: { id: Number(referrerId), deletedAt: null } });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const code = `REF-${client.name.slice(0, 3).toUpperCase().replace(/\s/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const referral = await prisma.referral.create({
      data: { referrerId: Number(referrerId), code },
      include: { referrer: { select: { id: true, name: true } } },
    });
    res.status(201).json(referral);
  } catch (err) { next(err); }
});

// PATCH /api/referrals/:id/redeem — mark referral as used and link referred client
router.patch('/:id/redeem', async (req, res, next) => {
  try {
    const { referredId } = req.body;
    const referral = await prisma.referral.findUnique({ where: { id: Number(req.params.id) } });
    if (!referral) return res.status(404).json({ error: 'Not found' });
    if (referral.used) return res.status(409).json({ error: 'Already redeemed' });

    const updated = await prisma.referral.update({
      where: { id: Number(req.params.id) },
      data: { used: true, referredId: referredId ? Number(referredId) : null },
      include: {
        referrer: { select: { id: true, name: true } },
        referred: { select: { id: true, name: true } },
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/referrals/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.referral.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
