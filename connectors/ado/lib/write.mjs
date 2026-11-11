// The write action: change a work item's fields (Runway's Publish). It is `write: true` in index.mjs,
// so the agent requires `confirm: true` from the caller (a person's click). Updates carry the revision the
// caller read: if the item changed in ADO since, the write is refused with `conflict` and the item as it is now,
// instead of overwriting someone else's change.
import { AdoError, ConflictError, SettingsError, clientFor } from './client.mjs';
import { commentsApi } from './workitem.mjs';
import { itemConnection, itemShape, tagList } from './items.mjs';
import { get } from './util.mjs';

const NEED = 'Work Items (Read & Write)';
const PATCH = 'application/json-patch+json';

/** Plain text to the HTML ADO stores: escaped, line breaks kept. */
export function textToHtml(text) {
  const esc = String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return esc.split(/\r?\n/).join('<br>');
}

const cleanTag = t => String(t ?? '').replace(/;/g, ' ').trim().slice(0, 100);

/** New tag string after adding and removing (case-insensitive, like ADO). */
export function mergeTags(current, add = [], remove = []) {
  const drop = new Set(remove.map(t => cleanTag(t).toLowerCase()).filter(Boolean));
  const out = tagList(current).filter(t => !drop.has(t.toLowerCase()));
  for (const raw of add) {
    const t = cleanTag(raw);
    if (t && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.join('; ');
}

/** True if an ADO error means the revision test failed (the item changed). */
function isRevConflict(e) {
  if (!(e instanceof AdoError)) return false;
  if (e.upstream === 409 || e.upstream === 412) return true;
  return e.upstream === 400 && /\b(rev|revision|TF26071|TF401289)\b/i.test(e.message);
}

async function fetchItem(ado, id, relations = false) {
  try {
    return await ado.call('GET', `wit/workitems/${id}`, relations ? { query: { $expand: 'relations' } } : undefined);
  } catch (e) {
    if (e instanceof AdoError && e.upstream === 404) throw new AdoError(`Work item ${id} was not found.`, 404);
    throw e;
  }
}

/** A field reference name other than a System.* field: "Custom.ReleaseNotes", "Microsoft.VSTS.Common.Risk". */
export const CUSTOM_REF = /^(?!System\.)[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

/** JSON Patch operations for a change set. `current` is the item's fields (for tags). */
export function patchOps(changes, currentFields = {}) {
  const ops = [];
  const set = (field, value) => ops.push({ op: 'add', path: `/fields/${field}`, value });
  if (changes.state !== undefined) {
    if (!String(changes.state).trim()) throw new SettingsError('State cannot be empty.');
    set('System.State', String(changes.state));
  }
  if (changes.assignedTo !== undefined) set('System.AssignedTo', String(changes.assignedTo || ''));
  if (changes.priority !== undefined) set('Microsoft.VSTS.Common.Priority', changes.priority);
  if (changes.title !== undefined) {
    const title = String(changes.title).replace(/\s+/g, ' ').trim();
    if (!title) throw new SettingsError('Title cannot be empty.');
    set('System.Title', title.slice(0, 255));
  }
  // Dates are YYYY-MM-DD; an empty string clears the field (only sent when the item has it, since ADO refuses
  // to remove a field that is not there).
  const day = (field, value, label) => {
    if (value === undefined) return;
    if (value === '' || value === null) { if (get(currentFields, field) != null) ops.push({ op: 'remove', path: `/fields/${field}` }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new SettingsError(`${label} must be a date like 2026-11-05.`);
    set(field, `${value}T00:00:00Z`);
  };
  day('Microsoft.VSTS.Scheduling.StartDate', changes.startDate, 'Start date');
  day('Microsoft.VSTS.Scheduling.TargetDate', changes.targetDate, 'Target date');
  if (changes.area !== undefined) {
    if (!String(changes.area).trim()) throw new SettingsError('Area cannot be empty.');
    set('System.AreaPath', String(changes.area));
  }
  if (changes.iteration !== undefined) {
    if (!String(changes.iteration).trim()) throw new SettingsError('Sprint cannot be empty.');
    set('System.IterationPath', String(changes.iteration));
  }
  // Long text: plain text or Markdown as written, sent as escaped HTML with line breaks kept (what ADO stores).
  if (changes.description !== undefined) set('System.Description', textToHtml(changes.description));
  if (changes.acceptance !== undefined) set('Microsoft.VSTS.Common.AcceptanceCriteria', textToHtml(changes.acceptance));
  // Other fields by reference name (Slate's release notes field), sent as plain text. Never System.* fields:
  // those have their own keys above.
  if (changes.custom !== undefined) {
    const entries = Object.entries(changes.custom || {});
    if (entries.length > 5) throw new SettingsError('At most 5 custom fields at a time.');
    for (const [ref, value] of entries) {
      if (!CUSTOM_REF.test(ref)) throw new SettingsError(`"${ref}" is not a field reference name this can set.`);
      set(ref, String(value ?? ''));
    }
  }
  if ((changes.tagsAdd && changes.tagsAdd.length) || (changes.tagsRemove && changes.tagsRemove.length)) {
    set('System.Tags', mergeTags(get(currentFields, 'System.Tags'), changes.tagsAdd || [], changes.tagsRemove || []));
  }
  // A comment: setting System.History adds it to the item's Discussion (ADO Server 2020 and later).
  if (changes.comment !== undefined) {
    if (!String(changes.comment).trim()) throw new SettingsError('A comment cannot be empty.');
    set('System.History', textToHtml(changes.comment));
  }
  return ops;
}

/** Related links to add: ids not already linked from the item (any link type), and never the item itself. */
export function relatedOps(ids, item, base) {
  const have = new Set((item.relations || []).map(r => (/\/workItems\/(\d+)$/i.exec(String(r.url || '')) || [])[1]).filter(Boolean).map(Number));
  const ops = [];
  for (const id of [...new Set((ids || []).map(Number))]) {
    if (!Number.isInteger(id) || id < 1 || id === Number(item.id) || have.has(id)) continue;
    ops.push({ op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Related', url: `${base}/_apis/wit/workItems/${id}` } });
  }
  return ops;
}

/**
 * "workitem.update". args: {id, rev, connection?, changes: {title?, state?, assignedTo?, priority?, iteration?, area?,
 * startDate?, targetDate?, description?, acceptance?, tagsAdd?, tagsRemove?, comment?, related?}}. `comment` goes to
 * the Discussion; `related` is work item ids to add Related links to (ids already linked are skipped).
 * Returns the item as ADO now has it, in the itemShape shape.
 */
export async function updateWorkItem(d, args) {
  const conn = itemConnection(d.cfg, args);
  const ado = clientFor(conn, d.env, d.signal);
  const changes = args.changes || {};
  const current = await fetchItem(ado, args.id, changes.related && changes.related.length);
  if (Number(current.rev) !== Number(args.rev)) {
    throw new ConflictError(`Work item ${args.id} changed in ADO since you loaded it. Review the change and try again.`, itemShape(ado, current, conn.name));
  }
  const ops = [...patchOps(changes, current.fields || {}), ...relatedOps(changes.related, current, ado.base)];
  if (!ops.length) throw new SettingsError(changes.related && changes.related.length ? 'Those items are already linked.' : 'Nothing to change.');
  ops.unshift({ op: 'test', path: '/rev', value: Number(args.rev) });
  let w;
  try {
    w = await ado.call('PATCH', `wit/workitems/${args.id}`, { body: ops, contentType: PATCH, need: NEED });
  } catch (e) {
    if (isRevConflict(e)) {
      const now = await fetchItem(ado, args.id);
      throw new ConflictError(`Work item ${args.id} changed in ADO since you loaded it. Review the change and try again.`, itemShape(ado, now, conn.name));
    }
    throw e;
  }
  return itemShape(ado, w, conn.name);
}


export const CREATE_TYPES = ['Epic', 'Feature', 'User Story', 'Product Backlog Item', 'Bug', 'Task', 'Issue'];

/**
 * "workitem.create" (Slate's Publish). args: {type, title, project?, connection?, parent?, fields: {description?,
 * acceptance?, area?, iteration?, assignedTo?, priority?, tags?, custom?}}. `custom` is other fields by reference
 * name as plain text (Slate: a feature's release note). Creates one item, with a parent link when
 * `parent` is given, and returns it in the itemShape shape. The project is `project`, else the parent's, else the
 * connection's. Nothing is created when a field is refused: ADO validates the whole patch first.
 */
export async function createWorkItem(d, args) {
  const conn = itemConnection(d.cfg, args);
  const ado = clientFor(conn, d.env, d.signal);
  const type = String(args.type || '');
  if (!CREATE_TYPES.includes(type)) throw new SettingsError(`Type must be one of: ${CREATE_TYPES.join(', ')}.`);
  const f = args.fields || {};
  let parent = null;
  if (args.parent) parent = await fetchItem(ado, args.parent);
  const project = String(args.project || (parent && get(parent.fields || {}, 'System.TeamProject')) || conn.project || '').trim();
  if (!project) throw new SettingsError(`Set a project on the ${conn.name} connection in Settings, or pass one, to create work items.`);
  const ops = patchOps({
    title: args.title,
    ...(f.description !== undefined ? { description: f.description } : {}),
    ...(f.acceptance !== undefined ? { acceptance: f.acceptance } : {}),
    ...(f.area ? { area: f.area } : {}),
    ...(f.iteration ? { iteration: f.iteration } : {}),
    ...(f.assignedTo ? { assignedTo: f.assignedTo } : {}),
    ...(f.priority ? { priority: f.priority } : {}),
    ...(f.tags && f.tags.length ? { tagsAdd: f.tags } : {}),
    ...(f.custom && Object.keys(f.custom).length ? { custom: f.custom } : {})
  }, {});
  if (parent) {
    ops.push({ op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: parent.url || `${ado.base}/_apis/wit/workItems/${parent.id}` } });
  }
  const w = await ado.call('POST', `wit/workitems/$${encodeURIComponent(type)}`, { project, body: ops, contentType: PATCH, need: NEED });
  return itemShape(ado, w, conn.name);
}

/**
 * For `doctor ado --write-check`: adds a tag to one item the person picks and removes it again, to prove the
 * PAT can write and the revision test works on their server. Returns counts and plain-word results only.
 */
export async function writeCheck(d, id, tag = 'workshop-write-check') {
  const conn = itemConnection(d.cfg, {});
  const ado = clientFor(conn, d.env, d.signal);
  const steps = [];
  const first = await fetchItem(ado, id);
  const added = await updateWorkItem(d, { id, rev: first.rev, changes: { tagsAdd: [tag] } });
  steps.push('Added a tag: the PAT can write work items.');
  // Straight to ADO with an old revision, skipping the connector's own check, to see the server refuse it.
  let removed = false;
  try {
    await ado.call('PATCH', `wit/workitems/${id}`, {
      body: [{ op: 'test', path: '/rev', value: Number(first.rev) }, { op: 'add', path: '/fields/System.Tags', value: mergeTags(added.tags.join('; '), [], [tag]) }],
      contentType: PATCH, need: NEED
    });
    removed = true;
    steps.push('Problem: ADO accepted a write with an old revision. The revision check does not work on this server.');
  } catch (e) {
    if (!isRevConflict(e)) throw e;
    steps.push('ADO refused a write with an old revision: the revision check works.');
  }
  if (!removed) await updateWorkItem(d, { id, rev: added.rev, changes: { tagsRemove: [tag] } });
  steps.push('Removed the tag again.');
  const project = get(first.fields || {}, 'System.TeamProject');
  try {
    await ado.call('GET', `wit/workItems/${id}/comments`, { project, api: commentsApi(conn), query: { $top: 1 } });
    steps.push(`The comments API answered (api-version ${commentsApi(conn)}).`);
  } catch (e) {
    if (e instanceof AdoError) steps.push(`The comments API did not answer (api-version ${commentsApi(conn)}). Comments will not work until this is fixed.`);
    else throw e;
  }
  return { connection: conn.name, steps };
}
