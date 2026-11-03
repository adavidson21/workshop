// Write actions for the Queue app: change fields, comment, create. Every one is `write: true` in index.mjs,
// so the agent requires `confirm: true` from the caller (a person's click). Updates carry the revision the
// caller read: if the item changed in ADO since, the write is refused with `conflict` and the item as it is now,
// instead of overwriting someone else's change.
import { AdoError, ConflictError, SettingsError, clientFor } from './client.mjs';
import { commentsApi } from './workitem.mjs';
import { queueConnection, queueItem, tagList } from './queue.mjs';
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

async function fetchItem(ado, id) {
  try {
    return await ado.call('GET', `wit/workitems/${id}`);
  } catch (e) {
    if (e instanceof AdoError && e.upstream === 404) throw new AdoError(`Work item ${id} was not found.`, 404);
    throw e;
  }
}

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
  if (changes.iteration !== undefined) {
    if (!String(changes.iteration).trim()) throw new SettingsError('Sprint cannot be empty.');
    set('System.IterationPath', String(changes.iteration));
  }
  if ((changes.tagsAdd && changes.tagsAdd.length) || (changes.tagsRemove && changes.tagsRemove.length)) {
    set('System.Tags', mergeTags(get(currentFields, 'System.Tags'), changes.tagsAdd || [], changes.tagsRemove || []));
  }
  return ops;
}

/**
 * "workitem.update". args: {id, rev, connection?, changes: {state?, assignedTo?, priority?, iteration?, tagsAdd?, tagsRemove?}}
 * Returns the item as ADO now has it, in the queue shape.
 */
export async function updateWorkItem(d, args) {
  const conn = queueConnection(d.cfg, args);
  const ado = clientFor(conn, d.env, d.signal);
  const changes = args.changes || {};
  const current = await fetchItem(ado, args.id);
  if (Number(current.rev) !== Number(args.rev)) {
    throw new ConflictError(`Work item ${args.id} changed in ADO since you loaded it. Review the change and try again.`, queueItem(ado, current, conn.name));
  }
  const ops = patchOps(changes, current.fields || {});
  if (!ops.length) throw new SettingsError('Nothing to change.');
  ops.unshift({ op: 'test', path: '/rev', value: Number(args.rev) });
  let w;
  try {
    w = await ado.call('PATCH', `wit/workitems/${args.id}`, { body: ops, contentType: PATCH, need: NEED });
  } catch (e) {
    if (isRevConflict(e)) {
      const now = await fetchItem(ado, args.id);
      throw new ConflictError(`Work item ${args.id} changed in ADO since you loaded it. Review the change and try again.`, queueItem(ado, now, conn.name));
    }
    throw e;
  }
  return queueItem(ado, w, conn.name);
}

/** "workitem.comment". args: {id, text, connection?}. Plain text in. */
export async function commentWorkItem(d, args) {
  const conn = queueConnection(d.cfg, args);
  const ado = clientFor(conn, d.env, d.signal);
  const text = String(args.text || '').trim();
  if (!text) throw new SettingsError('Write a comment first.');
  const current = await fetchItem(ado, args.id);
  const project = get(current.fields || {}, 'System.TeamProject');
  if (!project) throw new AdoError(`Work item ${args.id} does not say its project.`);
  const c = await ado.call('POST', `wit/workItems/${args.id}/comments`, { project, api: commentsApi(conn), body: { text: textToHtml(text) }, need: NEED });
  return { id: args.id, comment: { id: c.id, text, date: c.createdDate || null }, connection: conn.name };
}

/**
 * "workitem.create". args: {type, title, project?, connection?, description?, area?, iteration?, priority?, assignedTo?}
 */
export async function createWorkItem(d, args) {
  const conn = queueConnection(d.cfg, args);
  const ado = clientFor(conn, d.env, d.signal);
  const project = args.project || conn.project;
  if (!project) throw new SettingsError('Say which project, or set one on the connection.');
  const title = String(args.title || '').trim();
  if (!title) throw new SettingsError('A new work item needs a title.');
  const ops = [{ op: 'add', path: '/fields/System.Title', value: title }];
  const add = (field, value) => ops.push({ op: 'add', path: `/fields/${field}`, value });
  if (args.description) {
    const field = args.type === 'Bug' ? 'Microsoft.VSTS.TCM.ReproSteps' : 'System.Description';
    add(field, textToHtml(args.description));
  }
  if (args.area) add('System.AreaPath', String(args.area));
  if (args.iteration) add('System.IterationPath', String(args.iteration));
  if (args.priority !== undefined) add('Microsoft.VSTS.Common.Priority', args.priority);
  if (args.assignedTo) add('System.AssignedTo', String(args.assignedTo));
  const w = await ado.call('POST', `wit/workitems/$${encodeURIComponent(args.type)}`, { project, body: ops, contentType: PATCH, need: NEED });
  return queueItem(ado, w, conn.name);
}

/**
 * For `doctor ado --write-check`: adds a tag to one item the person picks and removes it again, to prove the
 * PAT can write and the revision test works on their server. Returns counts and plain-word results only.
 */
export async function writeCheck(d, id, tag = 'workshop-write-check') {
  const conn = queueConnection(d.cfg, {});
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
