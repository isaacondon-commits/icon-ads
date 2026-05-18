// In-memory set of tablet IDs that should force a re-sync on next connection.
// Resets on server restart — that's intentional (short-lived signal).
const flags = new Set();
module.exports = flags;
