/* Workshop: who sends an app handoff offers (docs/handoffs.md, Senders). One copy for every receiver (Docket,
   Runway, Rapport, Notes) instead of one in each. */

/**
 * Senders for the receiver `self`: every app on this site whose manifest lists `self` in handoffs.sends
 * (apps from ws.apps.list()), added to the receiver's built-in list `fallback` ({id: name}). Reading an app that
 * is not there finds no offers, so the built-in list only keeps senders whose manifest does not say, and any
 * retired sender the receiver still reads. Returns {id: name}; never includes `self`.
 */
export function sendersFrom(apps, self, fallback = {}) {
  const found = (Array.isArray(apps) ? apps : []).filter(a => a && a.id !== self && a.handoffs && Array.isArray(a.handoffs.sends) && a.handoffs.sends.includes(self));
  const out = { ...fallback, ...Object.fromEntries(found.map(a => [a.id, a.name || a.id])) };
  delete out[self];
  return out;
}

/** Replace a receiver's senders object in place (apps keep one SENDERS object that other modules read). */
export function useSenders(senders, apps, self, fallback = senders) {
  const next = sendersFrom(apps, self, { ...fallback });
  for (const k of Object.keys(senders)) delete senders[k];
  Object.assign(senders, next);
  return senders;
}
