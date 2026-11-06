/* Slate: the pure part. No DOM and no SDK, so Node tests drive it.

   Slate is your ADO backlog as a board, in two lanes:
     PM lane   a request goes New, Triage, Waiting on requester, Define, Publish, Decide, and ends Delegated or in
               the Dev lane. Tandem agents (eng-agents) do each step's legwork: /triage, /scope and /slice or
               /refine, /handoff. You approve.
     Dev lane  the item's Tandem run (Dispatch's .work items), read live from the opencode connector.

   Collections (version 1, docs/data-format.md):
     items      one record per item you acted on (and `meta.fields`: which ADO fields cards and the panel show,
                cleanPrefs): {id, title, level, parentId, ado, runway, work, sessions, route,
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
  if (s === 'defining') return work.ready && item.reopened !== 'defining' ? 'publish' : 'define';
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
  it.requester = oneLine(raw.requester, 200);
  it.requesterId = typeof raw.requesterId === 'string' && /^p_/.test(raw.requesterId) ? raw.requesterId : null;
  it.offered = {};
  for (const k of ['win', 'decision']) if (typeof (raw.offered || {})[k] === 'string') it.offered[k] = raw.offered[k];
  it.published = {};
  for (const [k, v] of Object.entries(raw.published || {})) if (Number.isInteger(v)) it.published[k] = v;
  if (raw.reopened !== it.stage) delete it.reopened;
  it.createdAt = isDay(raw.createdAt) ? raw.createdAt : today();
  it.history = Array.isArray(raw.history) ? raw.history.filter(h => h && STAGES.includes(h.stage) && isDay(h.at)).slice(-50) : [];
  return it;
}

/** A new item from a request typed into Slate, or from an ADO backlog item. */
export function newItem({ title, description = '', level = 'story', ado = null, requester = '', requesterId = null } = {}, now = new Date()) {
  const it = cleanItem({ id: newId(), title, description, level, stage: 'new', createdAt: today(now), requester, requesterId });
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
    delete it.reopened;
    it.stage = stage;
    it.history = [...(it.history || []), { stage, at: today(now) }].slice(-50);
  }
  return it;
}

/* ---------- moving back ---------- */

export const STAGE_TITLE = { new: 'New', triaged: 'Triage', waiting: 'Waiting on requester', defining: 'Define', ready: 'Publish', decide: 'Who builds it?', delegated: 'Delegated', dev: 'Dev lane', done: 'Done' };

/**
 * Earlier stages an item can go back to: the ones its history went through (New always), before where it is
 * now. `column` is where the board shows it: an item in Define whose draft is approved shows in Publish, so
 * Define is a step back for it. Delegated and the Dev lane are two ends of one choice, so neither goes to the
 * other; both go back to Who builds it?.
 */
export function backTargets(it, column = null) {
  const cur = it.stage || 'new';
  const seen = new Set(['new', ...(it.history || []).map(h => h.stage)]);
  const before = STAGES.slice(0, STAGES.indexOf(cur));
  const out = before.filter(st => seen.has(st) && st !== 'ready');
  if (cur === 'defining' && column === 'publish') out.push('defining');
  const skip = cur === 'dev' ? 'delegated' : cur === 'delegated' ? 'dev' : null;
  return out.filter(st => st !== skip);
}

/**
 * Later stages an item can skip ahead to, for work that is already done elsewhere (a feature whose stories are
 * already written goes straight to Who builds it?). Only Define and Who builds it?: Waiting and Publish need
 * triage questions or drafts, and Delegated and the Dev lane go through Delegate and Do it myself.
 * Only from the PM lane before Who builds it?.
 */
export function forwardTargets(it) {
  const cur = it.stage || 'new';
  if (!['new', 'triaged', 'waiting', 'defining', 'ready'].includes(cur)) return [];
  const at = STAGES.indexOf(cur);
  return ['defining', 'decide'].filter(st => STAGES.indexOf(st) > at);
}

/**
 * Move an item back to an earlier stage. It stays there until you act (`reopened`): back in New, a finished
 * triage does not move it on again, and back in Define an approved draft does not send it to Publish. Any
 * forward move or agent run clears it.
 */
export function moveBack(it, stage, now = new Date()) {
  if (stage === it.stage) it.history = [...(it.history || []), { stage, at: today(now) }].slice(-50);
  else setStage(it, stage, now);
  it.reopened = stage;
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
    out.push({ ...newItem({ title: b.title, ado: b }), id: `ado_${b.id}`, virtual: true, adoNow: b, createdAt: (b.changed || '').slice(0, 10) || today() });
  }
  return out;
}

/** True when ADO changed the item since Slate last wrote or read it. */
export const changedInAdo = (it) => !!(it.ado && it.adoNow && Number(it.adoNow.rev) > Number(it.ado.rev));

/* ---------- area paths ---------- */

/** The area choice for cards with no ADO area path (requests not in ADO yet). */
export const NO_AREA = '-';

/** The card's ADO area path, as ADO has it now if known: '' when it has none. */
export const areaOf = (c) => String((c.adoNow && c.adoNow.area) || (c.ado && c.ado.area) || '');

const areaParts = (p) => String(p || '').split('\\').map(x => x.trim()).filter(Boolean);
const areaKey = (p) => areaParts(p).join('\\').toLowerCase();

/** True when `path` is `root` or under it. ADO area paths are backslash separated and case-insensitive. */
export function underArea(path, root) {
  const p = areaKey(path), r = areaKey(root);
  return !!r && (p === r || p.startsWith(r + '\\'));
}

/** True when the card belongs in the area view: '' is every area, NO_AREA is cards with none. */
export function inArea(c, area) {
  if (!area) return true;
  const a = areaOf(c);
  return area === NO_AREA ? !a : !!a && underArea(a, area);
}

/**
 * The area views for the cards: the team's area paths (`roots`, People), every path the cards sit in, and the
 * paths between, as a tree. [{path, label, depth, count}], parents before children; count is the cards at or
 * under the path. A card outside every root still gets its own path. `keep` (the saved choice) is always listed,
 * so a view with nothing in it says so instead of quietly showing everything.
 */
export function areaOptions(list, roots = [], keep = '') {
  const rootParts = roots.map(areaParts).filter(r => r.length);
  const paths = new Map(); // key -> display path
  const add = (parts) => { const p = parts.join('\\'); if (p && !paths.has(p.toLowerCase())) paths.set(p.toLowerCase(), p); };
  for (const r of rootParts) add(r);
  let none = 0;
  for (const c of list) {
    const parts = areaParts(areaOf(c));
    if (!parts.length) { none++; continue; }
    const root = rootParts.filter(r => underArea(parts.join('\\'), r.join('\\'))).sort((a, b) => b.length - a.length)[0];
    for (let n = root ? root.length : parts.length; n <= parts.length; n++) add(parts.slice(0, n));
  }
  if (keep && keep !== NO_AREA) add(areaParts(keep));
  const sorted = [...paths.values()].sort((a, b) => areaKey(a).localeCompare(areaKey(b)));
  const out = sorted.map(path => {
    // Depth below the nearest listed ancestor's chain, so a root shows flush left with its sub-areas under it.
    const ancestors = sorted.filter(o => o !== path && underArea(path, o));
    return {
      path,
      label: ancestors.length ? areaParts(path).slice(-1)[0] : path,
      depth: ancestors.length,
      count: list.filter(c => { const a = areaOf(c); return a && underArea(a, path); }).length
    };
  });
  if (none || keep === NO_AREA) out.push({ path: NO_AREA, label: 'No area path', depth: 0, count: none });
  return out;
}

/** Text search, level and area filter. */
export function filterCards(list, { q = '', level = '', area = '' } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter(c => (!level || c.level === level) && inArea(c, area) && words.every(w => `${c.title} ${c.ado ? '#' + c.ado.id : ''} ${c.requester || ''}`.toLowerCase().includes(w)));
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

/**
 * What the agents are asking about this item, so the panel can answer it in place: permission prompts and
 * questions (opencode connector `state`, `liveMode.live`) from any session Slate started for it, its `.work`
 * folders, or its Tandem run's folder (Dev lane). `{permissions, questions, count}`.
 */
export function asksFor(item, live, run = null) {
  const L = live || {};
  const sids = new Set(Object.values((item && item.sessions) || {}).filter(Boolean));
  const folders = new Set(Object.values((item && item.work) || {}).filter(Boolean));
  if (run && run.folder) folders.add(run.folder);
  const mine = (x) => !!x && typeof x.id === 'string' && (sids.has(x.sessionID) || (!!x.folder && folders.has(x.folder)));
  const permissions = (L.permissions || []).filter(mine);
  const questions = (L.questions || []).filter(mine);
  return { permissions, questions, count: permissions.length + questions.length };
}

/** Answers for one opencode question from what was picked and typed: one array of labels per question, or null if any is empty. */
export function questionAnswers(q, picks = {}, typed = {}) {
  const out = ((q && q.questions) || []).map((qq, i) => {
    const a = (picks[i] || []).filter(x => typeof x === 'string' && x);
    const t = String(typed[i] || '').trim();
    if (t) a.push(t);
    return a;
  });
  return out.length && out.every(a => a.length) ? out : null;
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

/* ---------- requester and aging ---------- */

// Days an item may sit in a PM column before it is flagged as stale. Waiting on someone else gets longer.
export const STALE_DAYS = { new: 3, triage: 3, waiting: 5, define: 7, publish: 2, decide: 3 };
const dayNum = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null; };

/** The day the item entered its current stage (the last history line for it), or its created day. */
export function stageSince(it) {
  const h = (it.history || []).filter(x => x.stage === it.stage);
  return (h.length ? h[h.length - 1].at : it.createdAt) || null;
}

/** Whole days in the current stage, on `now`. */
export function daysInStage(it, now = new Date()) {
  const a = dayNum(stageSince(it)), b = dayNum(today(now));
  return a == null || b == null ? 0 : Math.max(0, b - a);
}

/** True when an item has sat in its PM column longer than STALE_DAYS allows. */
export const isStale = (it, column, now = new Date()) => STALE_DAYS[column] != null && daysInStage(it, now) > STALE_DAYS[column];

/* ---------- ownership (People's `owns`) ---------- */

/**
 * People who own something the item touches, best match first: [{id, name, hits: [what matched]}].
 * `owners` is [{id, name, owns: [product, repo or area path]}] from the directory; `text` is everything known about
 * the item (title, triage's products and repos, ADO area). A match is a whole owned term found in the text, case
 * ignored. Facts only: nobody is ranked on anything but what they own.
 */
export function ownersFor(owners, text) {
  const hay = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9\\/._-]+/g, ' ')} `;
  const out = [];
  for (const p of owners || []) {
    const hits = (p.owns || []).filter(t => {
      const w = String(t || '').toLowerCase().trim().replace(/[^a-z0-9\\/._-]+/g, ' ');
      return w && hay.includes(` ${w} `) || (w.includes('\\') && hay.includes(w));
    });
    if (hits.length) out.push({ id: p.id, name: p.name, hits });
  }
  return out.sort((a, b) => b.hits.length - a.hits.length || a.name.localeCompare(b.name));
}

/** What an item is about, as text for ownersFor. */
export function aboutText(it, triage) {
  return [it.title, it.ado && it.ado.area, it.adoNow && it.adoNow.area, ...(triage ? triage.repos : [])].filter(Boolean).join(' ');
}

/* ---------- team health ---------- */

/** Health numbers for the Health tab: per column {count, stale, medianDays}, the oldest open items, and load. */
export function health(items, columnOf, now = new Date()) {
  const cols = {};
  const open = items.filter(it => !['done'].includes(it.stage));
  for (const it of open) {
    const k = columnOf(it);
    const c = (cols[k] ||= { count: 0, stale: 0, days: [] });
    c.count++;
    const d = daysInStage(it, now);
    c.days.push(d);
    if (isStale(it, k, now)) c.stale++;
  }
  for (const c of Object.values(cols)) { const s = c.days.sort((a, b) => a - b); c.medianDays = s.length ? s[Math.floor((s.length - 1) / 2)] : 0; delete c.days; }
  const oldest = open.filter(it => it.stage !== 'dev' && it.stage !== 'delegated').map(it => ({ it, days: daysInStage(it, now), column: columnOf(it) }))
    .sort((a, b) => b.days - a.days).slice(0, 8);
  const load = {};
  for (const it of items) if (it.stage === 'delegated' && it.assignee) load[it.assignee] = (load[it.assignee] || 0) + 1;
  // Request to decision: days from created to the first decide, delegated or dev line.
  const toDecision = items.map(it => {
    const d = (it.history || []).find(h => ['decide', 'delegated', 'dev'].includes(h.stage));
    const a = dayNum(it.createdAt), b = d && dayNum(d.at);
    return a != null && b != null ? b - a : null;
  }).filter(x => x != null).sort((a, b) => a - b);
  return { cols, oldest, load, toDecision: { n: toDecision.length, median: toDecision.length ? toDecision[Math.floor((toDecision.length - 1) / 2)] : null } };
}

/* ---------- sprints ---------- */

/** Items with an ADO id grouped by sprint (iteration path): {path: [items]}, plus '' for no sprint. */
export function bySprint(items) {
  const out = {};
  for (const it of items) {
    if (!it.ado) continue;
    const p = (it.adoNow && it.adoNow.iteration) || '';
    (out[p] ||= []).push(it);
  }
  return out;
}

/** Load per assignee in one sprint's items: [{name, count}], most first. */
export function sprintLoad(list) {
  const m = new Map();
  for (const it of list) { const n = (it.adoNow && it.adoNow.assignee && it.adoNow.assignee.name) || 'Unassigned'; m.set(n, (m.get(n) || 0) + 1); }
  return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/* ---------- summary for other apps (Workshop docs/summaries.md) ---------- */

const card = (id, kind, title, extra) => ({ id, kind, title, updatedAt: Date.now(), ...extra });
const row = (it, note, flag) => ({ id: it.id, title: `${it.ado ? `#${it.ado.id} ` : ''}${it.title}`.slice(0, 200), route: `item/${it.id}`, ...(note ? { note: note.slice(0, 200) } : {}), ...(flag ? { flag } : {}) });

/**
 * Slate's summary cards: `needs` (what waits on you, for Home's inbox), `delegated` (a people card: what is with
 * each person, for Rapport's 1:1 prep), `done-week` (decisions made in the last 7 days, for the weekly status), and
 * `ado` (ADO ids Slate knows, for Dispatch to link a run back to its request). `columnOf(it)` and `agentOf(it)`
 * come from main.js.
 */
export function summaryCards(items, { columnOf, agentOf = () => null, now = new Date() } = {}) {
  const needs = [];
  for (const it of items) {
    if (['dev', 'done', 'delegated'].includes(it.stage)) continue;
    const a = agentOf(it), col = columnOf(it);
    if (a && a.waiting) needs.push(row(it, 'An agent is asking you something', 'urgent'));
    else if (col === 'decide') needs.push(row(it, 'Decide who builds it'));
    else if (col === 'publish') needs.push(row(it, 'Approved: publish to ADO'));
    else if (col === 'define' && it.draftReady) needs.push(row(it, 'A draft is ready to approve'));
    else if (col === 'triage' && !(a && a.busy)) needs.push(row(it, 'Triage is done: ask or define'));
    else if (isStale(it, col, now)) needs.push(row(it, `${daysInStage(it, now)} days in ${col}`, 'waiting'));
  }
  const people = new Map();
  for (const it of items) {
    if (it.stage !== 'delegated' || !it.assignee) continue;
    const r = people.get(it.assignee) || { id: it.assignee, open: [], waiting: [] };
    if (r.open.length < 20) r.open.push({ id: it.id, title: `${it.ado ? `#${it.ado.id} ` : ''}${it.title}`.slice(0, 200), due: '', nudgeOn: '', via: '' });
    people.set(it.assignee, r);
  }
  const week = today(new Date(now.getTime() - 7 * 864e5));
  const done = [];
  for (const it of items) {
    const h = [...(it.history || [])].reverse().find(x => ['delegated', 'dev', 'decide', 'done'].includes(x.stage) && x.at >= week);
    if (!h) continue;
    const what = h.stage === 'delegated' ? 'Delegated' : h.stage === 'dev' ? 'Taking it on myself' : h.stage === 'decide' ? 'Defined and published' : 'Closed';
    done.push({ ...row(it, what), due: h.at });
  }
  done.sort((a, b) => b.due.localeCompare(a.due));
  const ado = items.filter(it => it.ado && ['dev', 'delegated', 'decide'].includes(it.stage)).slice(-20)
    .map(it => ({ id: String(it.ado.id), title: it.title.slice(0, 200), route: `item/${it.id}`, ...(it.requester ? { note: `Asked by ${it.requester}`.slice(0, 200) } : {}) }));
  return [
    card('needs', 'list', 'Needs you in Slate', { rows: needs.slice(0, 20), count: needs.length, route: '' }),
    card('delegated', 'people', 'Delegated', { rows: [...people.values()].slice(0, 200) }),
    card('done-week', 'list', 'Decisions this week', { rows: done.slice(0, 20), count: done.length }),
    card('ado', 'list', 'ADO items in Slate', { rows: ado })
  ];
}

/* ---------- other offers ---------- */

/** A Notes note for the decision log (Workshop docs/handoffs.md, Receivers: notes, from another app: inbox/). */
export function decisionNote(item, decision, now = new Date()) {
  const lines = [
    `Decision: ${decision}`,
    '',
    `- Item: ${item.title}${item.ado ? ` (ADO #${item.ado.id})` : ''}`,
    item.requester ? `- Asked by: ${item.requester}` : null,
    `- Date: ${today(now)}`,
    `- In Slate: [${item.title.replace(/[[\]]/g, '')}](ws:slate/item/${item.id})`
  ].filter(l => l !== null);
  return { id: `h_${item.id}_decision_${today(now)}`, to: 'notes', date: today(now), createdAt: now.toISOString(), text: lines.join('\n').slice(0, 2000), accepted: true,
    payload: { kind: 'note', title: `Decision: ${item.title}`.slice(0, 120) }, source: { app: APP, id: item.id } };
}

/** A receipt offer for Rapport when delegated work closes: a win about the person (an ordinary offer to accept). */
export function winOffer(item, personId, now = new Date()) {
  return { id: `h_${item.id}_win`, to: 'receipts', date: today(now), createdAt: now.toISOString(),
    text: `Delivered ${item.ado ? `#${item.ado.id} ` : ''}${item.title}`.slice(0, 2000), payload: { kind: 'win', about: personId || 'me' }, source: { app: APP, id: item.id } };
}

/* ---------- ADO fields: what cards and the panel show (items' meta.fields) ---------- */

// On cards, from the backlog read. Every one is on unless turned off in Fields.
export const CARD_FIELDS = [
  { key: 'assignee', label: 'Assigned to' },
  { key: 'iteration', label: 'Iteration' },
  { key: 'area', label: 'Area path' },
  { key: 'tags', label: 'Tags' },
  { key: 'priority', label: 'Priority' },
  { key: 'points', label: 'Story points' },
  { key: 'comments', label: 'Comment count' }
];
// In the panel, from workitem.get when it opens. Assigned to, state, iteration, area and tags always show there.
export const DETAIL_FIELDS = [
  { key: 'description', label: 'Description' },
  { key: 'acceptance', label: 'Acceptance criteria' },
  { key: 'repro', label: 'Repro steps' },
  { key: 'systemInfo', label: 'System info' },
  { key: 'releaseNotes', label: 'Release notes' },
  { key: 'priority', label: 'Priority' },
  { key: 'severity', label: 'Severity' },
  { key: 'points', label: 'Story points' },
  { key: 'links', label: 'Links' },
  { key: 'comments', label: 'Comments' }
];
const DETAIL_KEYS = DETAIL_FIELDS.map(f => f.key);
export const DEFAULT_PREFS = {
  card: ['assignee', 'iteration', 'area', 'tags', 'priority', 'points'],
  detail: {
    epic: ['description', 'priority', 'links', 'comments'],
    feature: ['description', 'releaseNotes', 'priority', 'links', 'comments'],
    story: ['description', 'acceptance', 'points', 'priority', 'links', 'comments'],
    bug: ['repro', 'systemInfo', 'points', 'priority', 'severity', 'links', 'comments']
  },
  // Custom fields by reference name, per level, shown in the panel under their own name.
  custom: { epic: [], feature: [], story: [], bug: [] },
  releaseNotesField: 'Custom.ReleaseNotes',
  pointsFields: ['Microsoft.VSTS.Scheduling.StoryPoints', 'Microsoft.VSTS.Scheduling.Effort']
};
const REF = /^[A-Za-z][A-Za-z0-9_.]*$/;
const refs = (v, max = 10) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[,;\n]+/)).map(x => String(x).trim()).filter(x => x && x.length <= 200 && REF.test(x)))].slice(0, max);

/** Field settings, filled with defaults and with anything unknown dropped. */
export function cleanPrefs(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const keys = (v, known, dflt) => known.filter(k => (Array.isArray(v) ? v : dflt).includes(k));
  const out = {
    card: keys(r.card, CARD_FIELDS.map(f => f.key), DEFAULT_PREFS.card),
    detail: {},
    custom: {},
    releaseNotesField: refs(r.releaseNotesField ?? DEFAULT_PREFS.releaseNotesField, 1)[0] || '',
    pointsFields: Array.isArray(r.pointsFields) || typeof r.pointsFields === 'string' ? refs(r.pointsFields, 5) : [...DEFAULT_PREFS.pointsFields]
  };
  for (const l of LEVELS) {
    out.detail[l] = keys((r.detail || {})[l], DETAIL_KEYS, DEFAULT_PREFS.detail[l]);
    out.custom[l] = refs((r.custom || {})[l]);
  }
  if (!out.pointsFields.length) out.pointsFields = [...DEFAULT_PREFS.pointsFields];
  return out;
}

/** Every custom reference name any level asks for, plus release notes: what workitem.get should return. */
export function customRefs(prefs) {
  return [...new Set([prefs.releaseNotesField, ...LEVELS.flatMap(l => prefs.custom[l])].filter(Boolean))].slice(0, 20);
}

/** "Custom.ReleaseNotes" -> "Release Notes". */
export function fieldLabel(ref) {
  const last = String(ref || '').split('.').pop() || '';
  return last.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim() || ref;
}

/** The last part of an ADO path ("Web App\\Sprint 12" -> "Sprint 12"). */
export const leaf = (path) => String(path || '').split('\\').pop();

/** What a card shows from ADO, per the card settings: [{key, text, title?}] and the tags. */
export function cardFacts(b, prefs) {
  if (!b) return { facts: [], tags: [] };
  const on = new Set(prefs.card);
  const facts = [];
  if (on.has('assignee')) facts.push({ key: 'assignee', text: b.assignee && b.assignee.name ? b.assignee.name : 'Unassigned' });
  if (on.has('priority') && b.priority != null) facts.push({ key: 'priority', text: `P${b.priority}` });
  if (on.has('points') && b.storyPoints != null) facts.push({ key: 'points', text: `${b.storyPoints} pt${b.storyPoints === 1 ? '' : 's'}` });
  if (on.has('comments') && b.commentCount) facts.push({ key: 'comments', text: `${b.commentCount} comment${b.commentCount === 1 ? '' : 's'}` });
  if (on.has('iteration') && b.iteration) facts.push({ key: 'iteration', text: leaf(b.iteration), title: b.iteration });
  if (on.has('area') && b.area) facts.push({ key: 'area', text: leaf(b.area), title: b.area });
  return { facts, tags: on.has('tags') && Array.isArray(b.tags) ? b.tags : [] };
}

/**
 * The panel's ADO section for one level: [{key, label, kind, value}] in settings order, from workitem.get with
 * extras. kind: 'text' (long text), 'value' (short), 'links', 'comments'. An empty field stays in, as '' (the
 * panel says it is empty in ADO, which is worth knowing).
 */
export function detailRows(w, level, prefs) {
  if (!w) return [];
  const rows = [];
  for (const key of prefs.detail[level] || []) {
    const label = DETAIL_FIELDS.find(f => f.key === key).label;
    if (key === 'description') rows.push({ key, label, kind: 'text', value: w.description || '' });
    else if (key === 'acceptance') rows.push({ key, label, kind: 'text', value: w.acceptanceCriteria || '' });
    else if (key === 'repro') rows.push({ key, label, kind: 'text', value: w.reproSteps || '' });
    else if (key === 'systemInfo') rows.push({ key, label, kind: 'text', value: w.systemInfo || '' });
    else if (key === 'releaseNotes') {
      if (prefs.releaseNotesField) rows.push({ key, label, kind: 'text', value: (w.custom || {})[prefs.releaseNotesField] || '', field: prefs.releaseNotesField });
    }
    else if (key === 'priority') rows.push({ key, label, kind: 'value', value: w.priority != null ? String(w.priority) : '' });
    else if (key === 'severity') rows.push({ key, label, kind: 'value', value: w.severity || '' });
    else if (key === 'points') rows.push({ key, label, kind: 'value', value: w.storyPoints != null ? String(w.storyPoints) : '' });
    else if (key === 'links') rows.push({ key, label, kind: 'links', value: w.links || { items: [], hyperlinks: [], attachments: [], pullRequests: 0 } });
    else if (key === 'comments') rows.push({ key, label, kind: 'comments', value: w.commentCount ?? null });
  }
  for (const ref of prefs.custom[level] || []) rows.push({ key: `custom:${ref}`, label: fieldLabel(ref), kind: 'text', value: (w.custom || {})[ref] || '', field: ref });
  return rows;
}
