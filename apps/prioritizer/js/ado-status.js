/* What Docket says about Workshop's ADO connector, from one entry of ws.connectors.list(). Pure, so it is
   unit tested (test/ado-status.test.mjs). `error` stops a sync (nothing would work); `warn` is shown but
   sync still runs (for example a PAT that expires soon). */

/** {error, warn} for the connector entry `c` (undefined when Workshop has no ADO connector). */
export function connectorNote(c) {
  if (!c) return { error: 'This Workshop has no ADO connector.', warn: '' };
  const s = c.status || {};
  if (!c.enabled || s.state === 'disabled') return { error: 'The ADO connector is turned off. Turn it on in Workshop Settings.', warn: '' };
  const d = s.details || {};
  // A rejected PAT keeps the connector "ready" (the next request may work), but every sync fails until it is replaced.
  if (Array.isArray(d.patsRejected) && d.patsRejected.length) return { error: s.message || 'ADO rejected the PAT. Make a new one, then run: workshop pat', warn: '' };
  if (s.state !== 'ready') return { error: s.message || `The ADO connector is ${s.state || 'not ready yet'}.`, warn: '' };
  return { error: '', warn: s.message || '' };
}

/**
 * Turn Docket's ADO sync on by itself: the connector is ready and the person never turned sync off here.
 * `ado` is Docket's per-device ui.ado ({on, offByUser}).
 */
export function shouldAutoConnect(c, ado) {
  if (!ado || ado.on || ado.offByUser) return false;
  return !!c && c.enabled === true && !connectorNote(c).error;
}
