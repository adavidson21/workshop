/* Docket: how the day plan is stored. Pure functions with no DOM, so Node tests can import them.

   Three kinds of collection in the Workshop data format (docs/data-format.md), next to the board's, under
   Docket's app id prioritizer:

     dayplan/settings      prioritizer.dayplan/settings v1      no items; meta: {sprint, handled}
     dayplan/templates     prioritizer.dayplan/templates v1     items: templates with their sections
     dayplan/recurring     prioritizer.dayplan/recurring v1     items: every-sprint tasks
     dayplan/days/<yyyy>   prioritizer.dayplan/days/<yyyy> v1   items: day records keyed by date (id)

   Slots live on the day record, not on tasks, so prioritizer.tasks stays at v3. A date with no record shows its
   template; a record is written on the first edit. Merging is per item (one template, or one day), later edit
   wins, like tasks. */
import { clone } from './store-format.js';

const DP_FIXED = ['dayplan/settings', 'dayplan/templates', 'dayplan/recurring'];
const DP_VERSION = 1;
const dpSchema = col => `prioritizer.${col}`;
const yearCol = y => `dayplan/days/${y}`;
const isYearCol = col => /^dayplan\/days\/\d{4}$/.test(col);
const yearOf = col => col.slice(-4);
/* The day collections a window starts with: last year, this year and next year (others load when viewed). */
const dpCollections = (today = new Date()) => { const y = today.getFullYear(); return [...DP_FIXED, yearCol(y - 1), yearCol(y), yearCol(y + 1)]; };

const stampsOf = env => new Map((env && env.items || []).map(i => [i.id, i.updatedAt]));

/* The envelope for one collection as the day plan is now. Same rules as the board (store-format.js). */
function dpEnvelopeFromBoard(col, dp, shadow){
  const at = stampsOf(shadow);
  const item = o => { const c = clone(o); c.updatedAt = at.get(c.id) ?? 0; return c; };
  const env = {schema: dpSchema(col), version: DP_VERSION, rev: shadow ? shadow.rev : 0, items: [], deleted: clone(shadow && shadow.deleted) || {}};
  const metaAt = shadow && shadow.meta ? shadow.meta.updatedAt : 0;
  if (col === 'dayplan/settings'){
    env.meta = Object.assign({}, clone(shadow && shadow.meta) || {}, {updatedAt: metaAt, sprint: clone(dp.sprint)});
    // handled is written once there is something in it, so a board with no offers saves exactly as before.
    if ((dp.handled && dp.handled.length) || 'handled' in env.meta) env.meta.handled = clone(dp.handled || []);
  }
  if (col === 'dayplan/templates') env.items = dp.templates.map(item);
  if (col === 'dayplan/recurring') env.items = (dp.recurring || []).map(item);
  if (isYearCol(col)){
    const y = yearOf(col);
    env.items = Object.values(dp.days).filter(r => r.id.slice(0, 4) === y).sort((a, b) => a.id < b.id ? -1 : 1).map(item);
  }
  return env;
}
/* Puts one collection's envelope into the day plan (which the caller then cleans). */
function dpApplyEnvelope(col, env, dp){
  const items = (env && env.items || []).map(i => { const c = clone(i); delete c.updatedAt; return c; });
  if (col === 'dayplan/settings'){
    if (env && env.meta && env.meta.sprint) dp.sprint = clone(env.meta.sprint);
    dp.handled = env && env.meta && Array.isArray(env.meta.handled) ? clone(env.meta.handled) : [];
  }
  if (col === 'dayplan/templates') dp.templates = items;
  if (col === 'dayplan/recurring') dp.recurring = items;
  if (isYearCol(col)){
    const y = yearOf(col);
    for (const k of Object.keys(dp.days)) if (k.slice(0, 4) === y) delete dp.days[k];
    for (const r of items) if (typeof r.id === 'string' && r.id.slice(0, 4) === y) dp.days[r.id] = r;
  }
  return [];
}
/* What store.js needs to save the day plan with the same write loop as the board. */
const dayplanFormat = (collections = dpCollections()) => ({
  collections, version: () => DP_VERSION, fromBoard: dpEnvelopeFromBoard, toBoard: dpApplyEnvelope,
  // A record that only exists because its date was viewed is never a placeholder: every record is an edit.
  placeholders: false
});

/* Day plan collections from a Workshop bundle. Same rules as the board's (store-format.js). */
function dpEnvelopesFromBundle(bundle){
  const out = {};
  if (!bundle || !Array.isArray(bundle.collections)) return out;
  for (const row of bundle.collections){
    if (!row || row.app !== 'prioritizer' || !(DP_FIXED.includes(row.collection) || isYearCol(row.collection))) continue;
    const env = row.envelope;
    if (!env || env.schema !== dpSchema(row.collection) || !Array.isArray(env.items)) throw new Error('The day plan in that backup is damaged.');
    if (env.version > DP_VERSION) throw new Error('That backup was made by a newer Workshop. Update Workshop, then import it.');
    out[row.collection] = clone(env);
  }
  return out;
}

export { DP_FIXED, DP_VERSION, dayplanFormat, dpApplyEnvelope, dpCollections, dpEnvelopeFromBoard, dpEnvelopesFromBundle, dpSchema, isYearCol, yearCol };
