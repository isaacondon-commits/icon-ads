// Circular in-memory log (last 100 events)
const MAX = 100;
const events = [];

function addEvent(action, entity, entityId, details, userId, ip) {
  events.unshift({
    id: Date.now(),
    action,
    entity,
    entityId: entityId ?? null,
    details: details ?? null,
    userId: userId ?? null,
    ip: ip ?? null,
    timestamp: new Date().toISOString(),
  });
  if (events.length > MAX) events.pop();
}

function getEvents() {
  return [...events];
}

module.exports = { addEvent, getEvents };
