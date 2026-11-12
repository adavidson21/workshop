/* Publish: send your changes to linked ADO work items back to Azure DevOps. Pure apart from `send`, which is given
   the connector call, so Node tests drive all of it with a fake connector. Loaded only by main.js with a dynamic
   import() when Runway uses Workshop on this computer.

   The one way Runway writes to ADO. It runs only from the Publish button, after a preview the person confirms,
   and only through the ADO connector's `workitem.update` (a write action, so the call carries `confirm: true`).
   It never creates work items, never comments and never changes a state.

   What a "change" is: a field of a linked item that differs from `ado.base`, what the last refresh brought.
   What can be sent (the connector's workitem.update, 1.5.0: title, assignedTo, iteration, startDate, targetDate,
   area, state, priority, tags):
     title      -> title        trimmed, at most 255 characters. A story's "Feature > " stays in Runway: only the
                                part after it is sent, so it must still start with it.
     who        -> assignedTo   one person whose ADO identity People knows, or no owner (unassigns). A group, two
                                or more people, or someone without an ADO identity can't be sent.
     start, end -> startDate, targetDate   for an item with its own dates in ADO: YYYY-MM-DD, or '' to clear
                                (unscheduled). A milestone sends its target date only. Only the end you moved
                                is sent.
                -> iteration    for an item whose dates come from its sprint, moved to exactly one sprint's
                                dates in the same project. An Epic or Feature moved to other dates gets its own
                                start and target dates instead.
   Not sent, and listed as such: status (Publish never changes states), and anything on a live roadmap. Area is
   never sent: Runway keeps a lane per item, not an area path, so it has nothing to send.

   Conflicts: an item whose ADO values changed too (`ado.remote`, "differs from ADO") is not sent; the person
   decides in its panel first. An item ADO changed after the last refresh is refused by the connector (it tests
   the revision Runway read), and shows as a conflict in the results. Nothing is overwritten. */
import { fmt, isDate } from '../dates.js';
import { projectOf } from './model.js';

const LABEL = { title: 'Title', start: 'Start', end: 'End', status: 'Status', who: 'Owners' };
const lower = s => String(s == null ? '' : s).toLowerCase();
const parentOf = p => String(p || '').split('\\').slice(0, -1).join('\\').toLowerCase();
const whoKey = v => [...(v || [])].sort().join(',');
const eq = (f, a, b) => (f === 'who' ? whoKey(a) === whoKey(b) : (a ?? null) === (b ?? null));

const STORY = ['User Story', 'Issue'];
const OWN_DATE_TYPES = ['Epic', 'Feature'];
const oneLine = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

const linked = it => !!(it && it.kind === 'item' && it.ado && Number.isInteger(it.ado.id) && it.ado.base);
const canPublish = doc => !!(doc && doc.meta && doc.meta.ado && doc.meta.ado.mode === 'linked');

/** The fields of a linked item you changed since the last refresh: [{field, from, to}]. Owners count only when
    the last refresh brought them (a refresh without People leaves `base.who` out). */
export function localChanges(it) {
  if (!linked(it)) return [];
  const base = it.ado.base;
  return Object.keys(LABEL).filter(f => (f !== 'who' || 'who' in base) && !eq(f, it[f], base[f]))
    .map(f => ({ field: f, from: f === 'who' ? [...(base.who || [])] : base[f] ?? null, to: f === 'who' ? [...(it.who || [])] : it[f] ?? null }));
}

/** Whether a change is of a kind Publish may send: everything but status. The preview says when one can't be. */
const sendable = (it, fields) => fields.some(f => f !== 'status');

/** How many linked items have a change Publish may send. The Publish button shows only when this is above 0. */
export function publishCount(doc) {
  if (!canPublish(doc)) return 0;
  return doc.items.filter(it => linked(it) && !it.ado.missing && sendable(it, localChanges(it).map(c => c.field))).length;
}

/** The sprint a bar from `start` to `end` is exactly, in the item's project: {path, start, finish} or a reason. */
export function sprintFor(it, iterations) {
  const project = lower(it.ado.project || projectOf(it.ado.iteration));
  const list = Object.entries(iterations || {}).filter(([p]) => lower(p) === project).flatMap(([, l]) => (Array.isArray(l) ? l : []));
  if (!isDate(it.start) || !isDate(it.end)) return { why: 'Unscheduled here. ADO needs a sprint, so nothing is sent.' };
  if (!list.length) return { why: "ADO's sprint list for this project did not load." };
  const hits = list.filter(x => x && x.path && x.start === it.start && x.finish === it.end);
  if (!hits.length) return { why: "The dates are not exactly one sprint's dates. ADO keeps this item's dates as its sprint, so only a move to a whole sprint can be sent." };
  if (hits.length === 1) return { sprint: hits[0] };
  // Teams often share sprint dates under different paths: prefer the one beside the current sprint.
  const near = hits.filter(x => parentOf(x.path) === parentOf(it.ado.iteration));
  return near.length === 1 ? { sprint: near[0] } : { why: 'More than one sprint has those dates.' };
}

const dayText = d => (isDate(d) ? fmt(d) : 'none');
const assigneeText = a => (a && (a.name || a.email) ? (a.name && a.email ? `${a.name} (${a.email})` : a.name || a.email) : 'Unassigned');

/** The Title row of the preview, and `row.changes.title` when it can be sent. */
function titleField(it, row) {
  const a = it.ado;
  const story = STORY.includes(a.type);
  const prefix = oneLine(typeof a.titlePrefix === 'string' ? a.titlePrefix : '');
  const mine = oneLine(it.title);
  const f = { label: 'Title', from: oneLine(a.base.title).slice(prefix.length).trim(), to: mine, sent: false, why: '' };
  if (story && typeof a.titlePrefix !== 'string') { f.from = oneLine(a.base.title); f.why = "Refresh from ADO first, so Runway knows which part is the story's own title."; return f; }
  if (prefix && !mine.startsWith(prefix)) { f.why = `Keep "${prefix}" at the start: Runway sends only the part after it, the story's own title.`; return f; }
  const title = mine.slice(prefix.length).trim().slice(0, 255);
  f.to = title;
  if (!title) f.why = "A title can't be empty in ADO.";
  else if (title === f.from) f.why = 'Already this in ADO.';
  else { f.sent = true; row.changes.title = title; }
  return f;
}

/** The date rows of the preview: own start and target dates, or a sprint move. Sets row.changes. */
function dateFields(it, row, iterations) {
  const a = it.ado;
  const from = `${dayText(a.base.start)} to ${dayText(a.base.end)}`;
  const to = `${dayText(it.start)} to ${dayText(it.end)}`;
  if (typeof a.ownDates !== 'boolean' || (a.ownDates && !('startDate' in a))) {
    return [{ label: 'Dates', from, to, sent: false, why: 'Refresh from ADO first, so Runway knows where ADO keeps these dates.' }];
  }
  if (!a.ownDates) {
    const s = sprintFor(it, iterations);
    if (s.sprint) {
      if (lower(s.sprint.path) === lower(a.iteration)) return [{ label: 'Sprint', from: a.iteration, to: s.sprint.path, sent: false, why: 'Already in that sprint in ADO.' }];
      row.changes.iteration = s.sprint.path;
      return [{ label: 'Sprint', from: a.iteration || 'none', to: `${s.sprint.path} (${to})`, sent: true, why: '' }];
    }
    // Not a whole sprint: an Epic or Feature can take dates of its own; other types stay with their sprint.
    if (!OWN_DATE_TYPES.includes(a.type) || !isDate(it.start) || !isDate(it.end)) return [{ label: 'Sprint', from: a.iteration || 'none', to, sent: false, why: s.why }];
  }
  // Own dates: send the end you moved, as YYYY-MM-DD, or '' to clear. A milestone is its target date.
  const out = [];
  const one = (label, field, mineDay, moved) => {
    if (!moved) return;
    const now = a[field] || null;
    const f = { label, from: dayText(now) + (now || a.ownDates ? '' : ' (from its sprint)'), to: dayText(mineDay), sent: false, why: '' };
    if ((mineDay || null) === now) f.why = 'Already this in ADO.';
    else { f.sent = true; row.changes[field] = mineDay || ''; }
    out.push(f);
  };
  const base = a.base;
  if (it.milestone) one('Target date', 'targetDate', it.end || null, (it.start ?? null) !== (base.start ?? null) || (it.end ?? null) !== (base.end ?? null));
  else {
    one('Start date', 'startDate', it.start || null, (it.start ?? null) !== (base.start ?? null));
    one('Target date', 'targetDate', it.end || null, (it.end ?? null) !== (base.end ?? null));
  }
  return out;
}

/**
 * What Publish would do for a roadmap. `dir` is Workshop's people directory (for ADO identities), `iterations`
 * is {project: [{path, start, finish}]} from the connector's iterations.list.
 * Returns {rows, send, conflicts}. One row per linked item with changes:
 *   {itemId, adoId, title, type, url, rev, connection, status: 'send' | 'conflict' | 'skip', why, changes, fields}
 *   changes  the workitem.update `changes` to send ({title?, assignedTo?, iteration?, startDate?, targetDate?});
 *            empty unless status is 'send'
 *   fields   [{label, from, to, sent, why}] every changed field, sent or not, as plain text (escape to show)
 */
export function planPublish(doc, { dir = null, iterations = {} } = {}) {
  const rows = [];
  if (!canPublish(doc)) return { rows, send: 0, conflicts: 0 };
  for (const it of doc.items) {
    const local = localChanges(it);
    if (!local.length) continue;
    const a = it.ado;
    const row = { itemId: it.id, adoId: a.id, title: String(it.title || ''), type: a.type || 'Work item', url: a.url || '', rev: Number(a.rev) || 0, connection: a.connection || '', status: 'skip', why: '', changes: {}, fields: [] };
    const fieldsOf = new Set(local.map(c => c.field));
    // Owners.
    if (fieldsOf.has('who')) {
      const to = it.who || [];
      const f = { label: 'Assigned To', from: assigneeText(a.assignee), to: '', sent: false, why: '' };
      const person = to.length === 1 && dir && dir.byId ? dir.byId.get(to[0]) : null;
      if (!dir || dir.unreadable) { f.to = to.length ? `${to.length} owner${to.length === 1 ? '' : 's'}` : 'Unassigned'; f.why = 'People has not loaded.'; }
      else if (!to.length) { f.to = 'Unassigned'; f.sent = true; row.changes.assignedTo = ''; }
      else if (to.length > 1) { f.to = to.map(id => (dir.byId.get(id) || {}).name || id).join(', '); f.why = 'ADO has one Assigned To. Keep one person as owner to send it.'; }
      else if (!person || person.kind !== 'person') { f.to = person ? person.name : to[0]; f.why = person ? 'A group cannot be Assigned To in ADO.' : 'People does not have this owner.'; }
      else if (!person.adoIdentity) { f.to = person.name; f.why = `${person.name} has no ADO identity in People.`; }
      else {
        f.to = person.name && lower(person.name) !== lower(person.adoIdentity) ? `${person.name} (${person.adoIdentity})` : person.adoIdentity;
        const same = a.assignee && [a.assignee.email, a.assignee.name].some(x => x && lower(x) === lower(person.adoIdentity));
        if (same) f.why = 'Already Assigned To them in ADO.';
        else { f.sent = true; row.changes.assignedTo = person.adoIdentity; }
      }
      row.fields.push(f);
    }
    // Title: the part after a story's "Feature > ".
    if (fieldsOf.has('title')) row.fields.push(titleField(it, row));
    // Dates: ADO's own start and target dates, a sprint move, or not sent.
    if (fieldsOf.has('start') || fieldsOf.has('end')) row.fields.push(...dateFields(it, row, iterations));
    for (const c of local) {
      if (c.field === 'status') row.fields.push({ label: LABEL.status, from: c.from || '', to: c.to || '', sent: false, why: "Publish doesn't change ADO states." });
    }
    if (a.missing) { row.why = 'The last refresh did not find this work item.'; }
    else if (a.remote) { row.status = 'conflict'; row.why = 'Changed in ADO too. Pick Use ADO\'s or Keep mine in its panel, then publish.'; }
    else if (row.rev < 1) { row.why = 'Refresh from ADO first.'; }
    else if (Object.keys(row.changes).length) row.status = 'send';
    else row.why = 'Nothing here can be sent to ADO.';
    // An item not sent: its fields say so, and the row says why.
    if (row.status !== 'send') { row.changes = {}; for (const f of row.fields) if (f.sent) { f.sent = false; f.why = ''; } }
    rows.push(row);
  }
  // Items to send first, then conflicts, then the rest.
  const rank = { send: 0, conflict: 1, skip: 2 };
  rows.sort((x, y) => rank[x.status] - rank[y.status]);
  return { rows, send: rows.filter(r => r.status === 'send').length, conflicts: rows.filter(r => r.status === 'conflict').length };
}

/** After a publish: items ADO updated take the title exactly as it was sent (trimmed, at most 255, a story's
    "Feature > " kept), so the refresh that follows finds them the same as ADO, not differing. */
export function applySent(doc, plan, results) {
  const ok = new Set(results.filter(r => r.outcome === 'updated').map(r => r.itemId));
  for (const row of plan.rows) {
    if (!ok.has(row.itemId) || typeof row.changes.title !== 'string') continue;
    const it = doc.items.find(i => i.id === row.itemId);
    if (it && it.ado) it.title = oneLine(it.ado.titlePrefix || '') ? `${oneLine(it.ado.titlePrefix)} ${row.changes.title}` : row.changes.title;
  }
}

/** The workitem.update arguments for a row. */
export const updateArgs = row => ({ id: row.adoId, rev: row.rev, ...(row.connection ? { connection: row.connection } : {}), changes: { ...row.changes } });

/**
 * Send a plan, one work item at a time. `call(action, args)` is the connector call (index.js adds confirm: true).
 * Resolves [{itemId, adoId, title, outcome, message}], outcome 'updated' | 'conflict' | 'failed' | 'skipped'.
 * A conflict (ADO changed the item since Runway read it) changes nothing in ADO.
 */
export async function sendPlan(call, plan, { onProgress = () => {} } = {}) {
  const out = [];
  for (const row of plan.rows) {
    const base = { itemId: row.itemId, adoId: row.adoId, title: row.title };
    if (row.status !== 'send') { out.push({ ...base, outcome: row.status === 'conflict' ? 'conflict' : 'skipped', message: row.why }); continue; }
    try {
      const r = await call('workitem.update', updateArgs(row));
      out.push({ ...base, outcome: 'updated', message: r && r.rev ? `Now revision ${r.rev}.` : '' });
    } catch (e) {
      const conflict = e && e.code === 'conflict';
      out.push({ ...base, outcome: conflict ? 'conflict' : 'failed', message: String((e && e.message) || (conflict ? 'Changed in ADO since Runway read it.' : 'Could not update.')).slice(0, 500) });
    }
    onProgress(out.length);
  }
  return out;
}
