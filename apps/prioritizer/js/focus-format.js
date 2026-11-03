/* Docket: how the focus log is stored. Pure functions with no DOM, so Node tests can import them.

   One kind of collection in the Workshop data format (docs/data-format.md), next to the board's and the day
   plan's, under Docket's app id prioritizer:

     focus/days/<yyyy>   prioritizer.focus/days/<yyyy> v1   items: one record per day, keyed by date (id)

   A record is {id: date, events: [...]} (focus-model.js). Merging is per day, later change wins, like the day
   plan's days. A window loads this year and last year (so a backup or a new year still has December). */
import { clone } from './store-format.js';

const FOCUS_VERSION = 1;
const focusSchema = col => `prioritizer.${col}`;
const focusCol = y => `focus/days/${y}`;
const isFocusCol = col => /^focus\/days\/\d{4}$/.test(col);
const yearOf = col => col.slice(-4);
const focusCollections = (today = new Date()) => { const y = today.getFullYear(); return [focusCol(y - 1), focusCol(y)]; };

const stampsOf = env => new Map((env && env.items || []).map(i => [i.id, i.updatedAt]));

function focusEnvelopeFromBoard(col, log, shadow){
  const at = stampsOf(shadow);
  const y = yearOf(col);
  const items = Object.values(log.days).filter(r => r.id.slice(0, 4) === y).sort((a, b) => a.id < b.id ? -1 : 1)
    .map(r => { const c = clone(r); c.updatedAt = at.get(c.id) ?? 0; return c; });
  return {schema: focusSchema(col), version: FOCUS_VERSION, rev: shadow ? shadow.rev : 0, items, deleted: clone(shadow && shadow.deleted) || {}};
}
function focusApplyEnvelope(col, env, log){
  const y = yearOf(col);
  for (const k of Object.keys(log.days)) if (k.slice(0, 4) === y) delete log.days[k];
  for (const i of env && env.items || []){
    if (typeof i.id !== 'string' || i.id.slice(0, 4) !== y) continue;
    const c = clone(i); delete c.updatedAt;
    log.days[c.id] = c;
  }
  return [];
}
const focusFormat = (collections = focusCollections()) => ({
  collections, version: () => FOCUS_VERSION, fromBoard: focusEnvelopeFromBoard, toBoard: focusApplyEnvelope, placeholders: false
});

function focusEnvelopesFromBundle(bundle){
  const out = {};
  if (!bundle || !Array.isArray(bundle.collections)) return out;
  for (const row of bundle.collections){
    if (!row || row.app !== 'prioritizer' || !isFocusCol(row.collection)) continue;
    const env = row.envelope;
    if (!env || env.schema !== focusSchema(row.collection) || !Array.isArray(env.items)) throw new Error('The focus log in that backup is damaged.');
    if (env.version > FOCUS_VERSION) throw new Error('That backup was made by a newer Workshop. Update Workshop, then import it.');
    out[row.collection] = clone(env);
  }
  return out;
}

export { FOCUS_VERSION, focusApplyEnvelope, focusCol, focusCollections, focusEnvelopeFromBoard, focusEnvelopesFromBundle, focusFormat, focusSchema, isFocusCol };
