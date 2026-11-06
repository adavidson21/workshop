/* Slate: the pure part. No DOM and no SDK, so Node tests drive it.

   Slate is your ADO backlog as a board, in two lanes:
     PM lane   a request goes New, Triage, Waiting on requester, Define, Publish, Decide, and ends Delegated or in
               the Dev lane. Tandem agents (eng-agents) do each step's legwork: /triage, /scope and /slice or
               /refine, /handoff. You approve.
     Dev lane  the item's Tandem run (Dispatch's .work items), read live from the opencode connector.

   Collections (version 1, docs/data-format.md):
     items      one record per item you acted on: {id, title, level, parentId, ado, runway, work, sessions, route,
                assignee, answers, published, stage, createdAt, history}. ADO items you have not touched are not
                stored: they come from the ADO connector's `backlog` action each time.
     handoffs   offers to Runway (an idea for a roadmap) and Docket (a "waiting on" task when you delegate).

   The .work files are read with the opencode connector's file.read: triage.md, refine.md, stories.md,
   milestones.md. Their shapes are eng-agents' templates (Core 2.12.0); the parsers below follow them and
   eng-agents core/scripts/ado/Export-Backlog.ps1 for milestones.md. */

export const APP = 'slate';
export const VERSION = 1;
export const LEVELS = ['epic', 'feature', 'story', 'bug'];
export const LEVEL_NAME = { epic: 'Epic', feature: 'Feature', story: 'Story', bug: 'Bug' };
const ADO_LEVEL = { Epic: 'epic', Feature: 'feature', 'User Story': 'story', 'Product Backlog Item': 'story', Issue: 'story', Bug: 'bug', Task: 'story' };
export const levelOfType = (type) => ADO_LEVEL[type] || 'story';

/* ---------- stages ---------- */

// Stored stages. The column a card shows in also depends on what its agent is doing (pmColumn).
export const STAGES = ['new', 'triaged', 'waiting', 'defining', 'ready', 'decide', 'delegated', 'dev', 'done'];
export const PM_COLUMNS = [
  { key: 'new', title: 'New', hint: 'Requests nobody has looked at yet.' },
  { key: 'triage', title: 'Triage', hint: 'An agent takes a first look: what it touches, what is missing, who should build it.' },
  { key: 'waiting', title: 'Waiting on requester', hint: 'Questions sent. Paste the answers to triage again.' },
  { key: 'define', title: 'Define', hint: 'Stories and acceptance criteria: /refine for one story, /scope and /slice for more.' },
  { key: 'publish', title: 'Publish', hint: 'Approved. Create or update the work items in ADO.' },
  { key: 'decide', title: 'Who builds it?', hint: 'Delegate it with a brief, or build it yourself in the Dev lane.' },
  { key: 'delegated', title: 'Delegated', hint: 'With a teammate. Docket tracks it as waiting on them.' }
];
export const DEV_COLUMNS = [
  { key: 'ready', title: 'Ready', hint: 'Yours to build. Start runs Tandem from the ADO item.' },
  { key: 'spec', title: 'Spec and plan', hint: 'Approve the spec and the plan.' },
  { key: 'build', title: 'Build', hint: 'Tasks running, or Approve and build with autopilot.' },
  { key: 'ship', title: 'Review and PR', hint: 'Review the code, push and open the PR.' },
  { key: 'done', title: 'Done', hint: 'Shipped.' }
];

/** Where a PM card goes. `work` is what the drafts say (draftState), `agent` its session ({busy, waiting} or null). */
export function pmColumn(item, work = {}, agent = null) {
  const s = item.stage || 'new';
  if (s === 'delegated') return 'delegated';
  if (s === 'decide') return 'decide';
  if (s === 'ready') return 'publish';
  if (s === 'defining') return work.ready ? 'publish' : 'define';
  if (s === 'waiting') return 'waiting';
  if (s === 'triaged') return 'triage';
  if (agent && item.sessions && item.sessions.triage) return 'triage';
  return 'new';
}

/** Dev column for a Tandem item (the opencode connector's `state` model item), or 'ready' when not started. */
export function devColumn(run) {
  if (!run) return 'ready';
  if (run.bucket === 'done' || run.bucket === 'shipped') return 'done';
  const st = (run.next && run.next.stage) || run.stage || '';
  if (st === 'build') return 'build';
  if (['review', 'ship', 'pr', 'push'].includes(st)) return 'ship';
  if (st === 'done' || st === 'shipped') return 'done';
  return 'spec';
}

/* ---------- records ---------- */

export const newId = (p = 'w') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const str = (v, max) => String(v ?? '').slice(0, max);
const oneLine = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A clean item record. Unknown fields are kept (a newer Slate may have added them). */
export function cleanItem(raw = {}) {
  const it = { ...raw };
  it.id = typeof raw.id === 'string' && raw.id ? raw.id : newId();
  it.title = oneLine(raw.title, 255) || 'Untitled';
  it.level = LEVELS.includes(raw.level) ? raw.level : 'story';
  it.stage = STAGES.includes(raw.stage) ? raw.stage : 'new';
  it.description = str(raw.description, 32000);
  it.ado = raw.ado && Number.isInteger(raw.ado.id) ? { id: raw.ado.id, rev: Number(raw.ado.rev) || 0, type: str(raw.ado.type, 60), url: str(raw.ado.url, 1000), connection: str(raw.ado.connection, 40), area: str(raw.ado.area, 400), state: str(raw.ado.state, 100) } : null;
  it.runway = raw.runway && typeof raw.runway.map === 'string' && typeof raw.runway.item === 'string' ? { map: raw.runway.map, item: raw.runway.item } : null;
  it.work = {};
  for (const k of ['triage', 'define', 'handoff']) if (typeof (raw.work || {})[k] === 'string' && raw.work[k]) it.work[k] = raw.work[k];
  it.sessions = {};
  for (const [k, v] of Object.entries(raw.sessions || {})) if (typeof v === 'string' && v) it.sessions[k] = v;
  it.route = ['delegate', 'myself'].includes(raw.route) ? raw.route : null;
  it.assignee = typeof raw.assignee === 'string' && raw.assignee ? raw.assignee : null;
  it.published = {};
  for (const [k, v] of Object.entries(raw.published || {})) if (Number.isInteger(v)) it.published[k] = v;
  it.createdAt = isDay(raw.createdAt) ? raw.createdAt : today();
  it.history = Array.isArray(raw.history) ? raw.history.filter(h => h && STAGES.includes(h.stage) && isDay(h.at)).slice(-50) : [];
  return it;
}

/** A new item from a request typed into Slate, or from an ADO backlog item. */
export function newItem({ title, description = '', level = 'story', ado = null } = {}, now = new Date()) {
  const it = cleanItem({ id: newId(), title, description, level, stage: 'new', createdAt: today(now) });
  if (ado) {
    it.ado = cleanItem({ ado: { id: ado.id, rev: ado.rev, type: ado.type, url: ado.url, connection: ado.connection, area: ado.area, state: ado.state } }).ado;
    it.level = levelOfType(ado.type);
  }
  it.history = [{ stage: 'new', at: today(now) }];
  return it;
}

/** Move an item to a stage, with a history line. Returns the item. */
export function setStage(it, stage, now = new Date()) {
  if (!STAGES.includes(stage)) throw new Error(`Unknown stage ${stage}`);
  if (it.stage !== stage) {
    it.stage = stage;
    it.history = [...(it.history || []), { stage, at: today(now) }].slice(-50);
  }
  return it;
}

/** The board's cards: stored items, then ADO backlog items nobody has acted on (not stored until you do). */
export function cards(items, backlog = []) {
  const byAdo = new Map(items.filter(i => i.ado).map(i => [i.ado.id, i]));
  const out = [...items];
  for (const b of backlog) {
    if (byAdo.has(b.id)) {
      const it = byAdo.get(b.id);
      it.adoNow = b; // the item as ADO has it now (for "changed in ADO")
      continue;
    }
    out.push({ ...newItem({ title: b.title, ado: b }), id: `ado_${b.id}`, virtual: true, createdAt: (b.changed || '').slice(0, 10) || today() });
  }
  return out;
}

/** True when ADO changed the item since Slate last wrote or read it. */
export const changedInAdo = (it) => !!(it.ado && it.adoNow && Number(it.adoNow.rev) > Number(it.ado.rev));

/** Text search and level filter. */
export function filterCards(list, { q = '', level = '' } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter(c => (!level || c.level === level) && words.every(w => `${c.title} ${c.ado ? '#' + c.ado.id : ''}`.toLowerCase().includes(w)));
}

/* ---------- .work files ---------- */

/** The value of a `Name: value` line before the first heading after the title, or null. */
export function headerLine(text, name) {
  const re = new RegExp(`^${name}:\\s*(.*?)\\s*$`, 'mi');
  const m = re.exec(stripComments(text));
  return m ? m[1] : null;
}
const stripComments = (t) => String(t || '').replace(/<!--[\s\S]*?-->/g, '');

/** Sections by `## ` heading: {heading lower case: body}. */
export function sections(text) {
  const out = {};
  let cur = null, buf = [];
  let fence = false;
  for (const line of stripComments(text).split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fence = !fence;
    const m = !fence && /^##\s+(.+?)\s*$/.exec(line);
    if (m && !/^###/.test(line)) {
      if (cur !== null) out[cur] = buf.join('\n').trim();
      cur = m[1].toLowerCase(); buf = [];
    } else if (cur !== null) buf.push(line);
  }
  if (cur !== null) out[cur] = buf.join('\n').trim();
  return out;
}

const bullets = (body) => String(body || '').split(/\r?\n/).map(l => /^\s*[-*]\s+(.*)$/.exec(l)).filter(Boolean).map(m => m[1].trim())
  .filter(t => t && !/^none\.?$/i.test(t) && !/^<.*>$/.test(t));

/** triage.md (eng-agents templates/triage.md). */
export function parseTriage(text) {
  if (!text) return null;
  const s = sections(text);
  const route = (headerLine(text, 'Route') || '').toLowerCase();
  const size = (headerLine(text, 'Size') || '').toUpperCase();
  return {
    route: ['delegate', 'myself', 'undecided'].includes(route) ? route : null,
    size: ['S', 'M', 'L', 'XL'].includes(size) ? size : null,
    summary: s.summary || '',
    questions: bullets(s['questions for the requester']),
    repos: bullets(s['products and repos']),
    related: bullets(s['related items']),
    suggestion: s['suggested route'] || '',
    next: s['next step'] || ''
  };
}

/** The Status line of a gate file (refine.md, stories.md, milestones.md): DRAFT, APPROVED, or null. */
export const statusOf = (text) => {
  const v = (headerLine(text, 'Status') || '').toUpperCase();
  return v === 'DRAFT' || v === 'APPROVED' ? v : null;
};

/** refine.md (eng-agents templates/refine.md). */
export function parseRefine(text) {
  if (!text) return null;
  const s = sections(text);
  const parent = /#(\d+)/.exec(headerLine(text, 'Parent') || '');
  const type = headerLine(text, 'Type') || '';
  return {
    status: statusOf(text),
    title: (/^#\s+Refine:\s*(.+?)\s*$/m.exec(text) || [])[1] || '',
    type: /bug/i.test(type) ? 'Bug' : 'User Story',
    parent: parent ? Number(parent[1]) : null,
    description: s.description || '',
    acceptance: unfence(s['acceptance criteria'] || ''),
    notes: s['notes for the builder'] || '',
    open: bullets(s['open questions']).filter(q => !/accepted risk\)?$/i.test(q))
  };
}

/** Gherkin text without the ```gherkin fences, as ADO's Acceptance Criteria field shows it best. */
export function unfence(text) {
  return String(text || '').split(/\r?\n/).filter(l => !/^\s*```/.test(l)).join('\n').trim();
}

/**
 * milestones.md, the way eng-agents core/scripts/ado/Export-Backlog.ps1 reads it: Status, the Epic line (a title,
 * or "#<id> title" for an epic that exists), "## Feature <n>: <title>" sections with "### Story <n>.<m>: <title>"
 * under them, each story with "#### Acceptance criteria" and "#### Work item". Other "## " sections are not items.
 * Returns {status, epic: {title, id, description}, features: [{num, title, description, stories: [{ref, title,
 * description, acceptance, work}]}], errors}.
 */
export function parseMilestones(text) {
  const out = { status: null, epic: { title: '', id: null, description: '' }, features: [], errors: [] };
  if (!text) { out.errors.push('No milestones.md yet.'); return out; }
  let section = 'top', feature = null, story = null, fence = false;
  const epicLines = [];
  for (const line of stripComments(text).split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fence = !fence;
    const heading = !fence && /^#{1,4}\s/.test(line);
    if (!heading && !fence && (section === 'top' || section === 'epic') && /^Status:\s*(\S+)/.test(line)) {
      if (!out.status) out.status = /^Status:\s*(\S+)/.exec(line)[1].toUpperCase();
      continue;
    }
    if (!heading && !fence && section === 'top' && /^Epic:\s*(.*?)\s*$/.test(line)) {
      const v = /^Epic:\s*(.*?)\s*$/.exec(line)[1];
      const m = /^#(\d+)\s*(.*)$/.exec(v);
      if (m) { out.epic.id = Number(m[1]); out.epic.title = m[2].trim() || `#${m[1]}`; } else out.epic.title = v;
      section = 'epic';
      continue;
    }
    if (heading) {
      let m = /^##\s+Feature\s+(\d+)\s*:\s*(.+?)\s*$/.exec(line);
      if (m) { feature = { num: Number(m[1]), title: m[2], lines: [], stories: [] }; out.features.push(feature); story = null; section = 'feature'; continue; }
      m = /^###\s+Story\s+(\d+)\.(\d+)\s*:\s*(.+?)\s*$/.exec(line);
      if (m) {
        if (!feature) { out.errors.push(`Story ${m[1]}.${m[2]} is not under a feature.`); section = 'ignore'; continue; }
        if (Number(m[1]) !== feature.num) out.errors.push(`Story ${m[1]}.${m[2]} is under Feature ${feature.num}.`);
        story = { ref: `${m[1]}.${m[2]}`, title: m[3], lines: [], ac: [], work: [] };
        feature.stories.push(story);
        section = 'story';
        continue;
      }
      if (/^####\s+Acceptance criteria\s*$/i.test(line) && story) { section = 'ac'; continue; }
      if (/^####\s+Work item\s*$/i.test(line) && story) { section = 'work'; continue; }
      if (/^####\s/.test(line) && story) { story.lines.push(line); section = 'story'; continue; }
      if (/^#\s/.test(line)) continue;
      if (/^##\s/.test(line)) { feature = null; story = null; section = 'ignore'; continue; }
      if (/^###\s/.test(line) && feature && !story) { out.errors.push(`"${line.trim()}" under Feature ${feature.num} is not a story heading.`); section = 'ignore'; continue; }
    }
    if (section === 'epic') epicLines.push(line);
    else if (section === 'feature') feature.lines.push(line);
    else if (section === 'story') story.lines.push(line);
    else if (section === 'ac') story.ac.push(line);
    else if (section === 'work') story.work.push(line);
  }
  const block = (ls) => ls.join('\n').trim();
  out.epic.description = block(epicLines);
  out.features = out.features.map(f => ({
    num: f.num, title: f.title, description: block(f.lines),
    stories: f.stories.map(s => ({ ref: s.ref, title: s.title, description: block(s.lines), acceptance: unfence(block(s.ac)), work: block(s.work) }))
  }));
  if (!out.epic.title) out.errors.push('No "Epic:" line.');
  if (!out.features.length) out.errors.push('No "## Feature <n>: <title>" sections.');
  for (const f of out.features) if (!f.stories.length) out.errors.push(`Feature ${f.num} has no stories.`);
  return out;
}

/**
 * Where an item's definition stands, from its files: {kind: 'refine' | 'scope' | null, file, status, ready}.
 * `files` is {name: text} for the item's define folder. `ready` means approved and publishable.
 */
export function draftState(item, files = {}) {
  const f = item.work && item.work.define;
  if (!f) return { kind: null, file: null, status: null, ready: false };
  if (f.startsWith('refine-')) {
    const st = statusOf(files['refine.md']);
    return { kind: 'refine', file: 'refine.md', status: st, ready: st === 'APPROVED', step: st === 'APPROVED' ? 'publish' : st ? 'approve' : 'drafting' };
  }
  const stories = statusOf(files['stories.md']);
  const ms = statusOf(files['milestones.md']);
  let step = 'drafting', file = 'stories.md', status = stories;
  if (stories === 'DRAFT') step = 'approve-stories';
  else if (stories === 'APPROVED' && !ms) step = 'slice';
  else if (ms === 'DRAFT') { step = 'approve-milestones'; file = 'milestones.md'; status = ms; }
  else if (ms === 'APPROVED') { step = 'publish'; file = 'milestones.md'; status = ms; }
  return { kind: 'scope', file, status, ready: step === 'publish', step };
}

/* ---------- publishing to ADO ---------- */

/**
 * What Publish will do, before anything is sent: [{ref, op: 'create' | 'update' | 'skip', type, title, parentRef,
 * parentId, id, fields}]. `published` maps refs to ids already created (a run that stopped part way resumes).
 * For a refined story on an existing ADO item it is one update; otherwise one create. For a scope, the epic
 * (unless milestones.md names an existing one), its features and their stories, parents first.
 */
export function publishPlan(item, files = {}, { area = '', storyType = 'User Story' } = {}) {
  const published = item.published || {};
  const plan = [];
  const fields = (description, acceptance) => ({ description, ...(acceptance ? { acceptance } : {}), ...(area ? { area } : {}), tags: ['slate'] });
  const step = (ref, p) => plan.push(published[ref] ? { ref, op: 'skip', id: published[ref], ...p } : { ref, op: 'create', ...p });
  const st = draftState(item, files);
  if (st.kind === 'refine') {
    const r = parseRefine(files['refine.md']);
    if (item.ado) plan.push({ ref: 'item', op: 'update', id: item.ado.id, rev: item.ado.rev, type: item.ado.type, title: item.title, fields: { description: r.description, acceptance: r.acceptance } });
    else step('item', { type: r.type === 'Bug' ? 'Bug' : storyType, title: item.title, parentId: r.parent, fields: fields(r.description, r.acceptance) });
    return plan;
  }
  if (st.kind === 'scope') {
    const m = parseMilestones(files['milestones.md']);
    let epicRef = null, epicId = m.epic.id;
    if (!epicId) {
      if (item.ado && item.level === 'epic') epicId = item.ado.id;
      else { epicRef = 'epic'; step('epic', { type: 'Epic', title: m.epic.title, fields: fields(m.epic.description) }); }
    }
    for (const f of m.features) {
      const fref = `feature ${f.num}`;
      step(fref, { type: 'Feature', title: f.title, parentRef: epicRef, parentId: epicRef ? null : epicId, fields: fields(f.description) });
      for (const s of f.stories) step(`story ${s.ref}`, { type: storyType, title: s.title, parentRef: fref, fields: fields(s.description, s.acceptance) });
    }
  }
  return plan;
}

/** Docket's "waiting on" task for a delegated item (handoff payload, Workshop docs/handoffs.md, Receivers). */
export function waitingTask(item, personId, now = new Date()) {
  return {
    id: `h_${item.id}_delegate`,
    to: 'prioritizer',
    date: today(now),
    createdAt: now.toISOString(),
    text: item.title,
    accepted: true,
    payload: { kind: 'task', title: `${item.ado ? `#${item.ado.id} ` : ''}${item.title}`.slice(0, 300), who: personId ? [personId] : [], waiting: true, notes: item.ado ? item.ado.url : '' },
    source: { app: APP, id: item.id }
  };
}

/** Runway's idea offer, for Add to roadmap (Workshop docs/handoffs.md, Receivers: runway). */
export function roadmapIdea(item, now = new Date()) {
  const text = [item.title, item.description].filter(Boolean).join('\n').slice(0, 2000);
  return { id: `h_${item.id}_idea`, to: 'runway', date: today(now), createdAt: now.toISOString(), text, accepted: true, payload: { kind: 'idea' }, source: { app: APP, id: item.id } };
}

/** Escape for HTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
