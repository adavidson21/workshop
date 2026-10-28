/* Receipts: the Collector interface. Interface only in V1; nothing collects yet.

   A collector gathers numbers about one person for one month and returns a metrics envelope, which
   Receipts saves as metrics/<person>/<yyyy-mm> (schema receipts.metrics/<person>/<yyyy-mm>, version 1).
   A refresh replaces the month's snapshot; collectors never write entries.

     collect({person, month, config}) -> Promise<metrics envelope>

     person   a config person {id, name, relation, role, ...}
     month    'yyyy-mm'
     config   the settings from model.js settingsOf()

   The envelope's meta is {updatedAt, personId, month, collectedAt}; each item is
   {id: '<source>.<metric>', updatedAt, source, value, unit, detail[], collectedAt}. See ../../schemas/metrics.schema.json.

   Planned for V1.1 (not here): ADO work items closed (through the ADO connector's read-only `dataset`
   action), Prioritizer tasks done (read-only ws.data of the prioritizer app), Agents work items. They run
   while Receipts is open: on open when the month is stale, or on Refresh. */
import { emptyEnvelope, metricsName } from '../model.js';

/** Collectors in V1: none. V1.1 adds {id, name, collect} objects here. */
export const COLLECTORS = [];

/** Checks a collector's result before it is saved: the right schema and meta, and well-formed items. */
export function validMetrics(env, personId, month) {
  if (!env || env.schema !== `receipts.${metricsName(personId, month)}` || env.version !== 1 || !Array.isArray(env.items)) return false;
  if (!env.meta || env.meta.personId !== personId || env.meta.month !== month) return false;
  return env.items.every(i => i && typeof i.id === 'string' && /^[a-z0-9-]+\.[a-z0-9.-]+$/.test(i.id) && typeof i.source === 'string'
    && typeof i.value === 'number' && Number.isFinite(i.value) && typeof i.unit === 'string' && Array.isArray(i.detail));
}

/** An empty metrics envelope for a person and month, for collectors to fill. */
export function emptyMetrics(personId, month, collectedAt, now = Date.now()) {
  return emptyEnvelope(metricsName(personId, month), { updatedAt: now, personId, month, collectedAt });
}
