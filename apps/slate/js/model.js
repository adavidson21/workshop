/* Slate: the pure part. No DOM and no SDK, so Node tests drive it.

   Slate is your ADO backlog as one board of six columns (Slate 2.0.0):
     Inbox          every item starts here. Requests get /triage; your own ideas (and Runway's pending ones) get
                    /shape, an interview with you a round at a time, ending in a brief.
     Shape          triage, waiting on the requester, the interview, the brief.
     Define         /scope and /slice or /refine (from the brief when there is one), then publish. You approve.
     Who builds it? delegate it (/handoff) or build it yourself.
     In flight      delegated, or the item's Tandem run (Dispatch's .work items, read live from the opencode
                    connector) through review and PR to merged.
     Resolved       merged to main, waiting for a release.
   Stored stages (STAGES) did not change with the board; boardColumn maps each step to its column.

   Collections (version 1, docs/data-format.md):
     items      one record per item you acted on (and `meta.fields`: which ADO fields cards and the panel show,
                cleanPrefs; `meta.dismissed`: Runway pending ideas hidden from Inbox): {id, title, level, kind ('idea'
                for your own ideas), runwayPending (the Runway pending idea it came from), parentId, ado, runway, work, sessions, route,
                assignee, answers, published, stage, createdAt, history}. ADO items you have not touched are not
                stored: they come from the ADO connector's `backlog` action each time.
     handoffs   offers to Runway (an idea for a roadmap) and Docket (a "waiting on" task when you delegate).

   The .work files are read with the opencode connector's file.read: triage.md, questions.md, understanding.md,
   brief.md, refine.md, stories.md, milestones.md. Their shapes are eng-agents' templates (Core 2.12.0; shape 2.16.0); the parsers below follow them and
   eng-agents core/scripts/ado/Export-Backlog.ps1 for milestones.md. */

export const APP = 'slate';
export const VERSION = 1;
export const LEVELS = ['epic', 'feature', 'story', 'bug'];
export const LEVEL_NAME = { epic: 'Epic', feature: 'Feature', story: 'Story', bug: 'Bug' };
const ADO_LEVEL = { Epic: 'epic', Feature: 'feature', 'User Story': 'story', 'Product Backlog Item': 'story', Issue: 'story', Bug: 'bug', Task: 'story' };
export const levelOfType = (type) => ADO_LEVEL[type] || 'story';

/* ---------- stages ---------- */

// Stored stages. The column a card shows in also depends on what its agent is doing (pmColumn).
// 'resolved': the ADO item is Resolved (merged to main, waiting for a release); the card stays until it closes.
// 'done': closed in ADO (or marked done). Off the board; Health and history keep it.
export const STAGES = ['new', 'triaged', 'waiting', 'shaping', 'brief', 'defining', 'ready', 'decide', 'delegated', 'dev', 'resolved', 'done'];
// The board: six columns, one board (Slate 2.0.0). Each column holds several steps; the card's chip names the step.
export const BOARD_COLUMNS = [
  { key: 'inbox', title: 'Inbox', hint: 'Requests, ideas and ADO items nobody has looked at yet.' },
  { key: 'shape', title: 'Shape', hint: 'Triage, waiting on the requester, an interview with you, or a brief to read. The card says which.' },
  { key: 'define', title: 'Define', hint: 'Stories and acceptance criteria, approved and published to ADO from here.' },
  { key: 'decide', title: 'Who builds it?', hint: 'Delegate it with a brief, or build it yourself.' },
  { key: 'inflight', title: 'In flight', hint: 'With a teammate, or building in Tandem, in review, or merged. The card says which.' },
  { key: 'resolved', title: 'Resolved', hint: 'Merged to main and waiting for a release, by area path. Close as released when it ships.' }
];

/**
 * Steps (what the panel offers and how long a card may wait) and the board column each one shows in. Shape and PM
 * steps come from pmColumn, the rest from devColumn.
 */
export const STEP_COLUMN = {
  new: 'inbox', triage: 'shape', waiting: 'shape', interview: 'shape', brief: 'shape', define: 'define', publish: 'define',
  decide: 'decide', delegated: 'inflight', building: 'inflight', review: 'inflight', merged: 'inflight', resolved: 'resolved'
};
export const STEP_CHIP = { triage: 'Triage', waiting: 'Waiting on requester', interview: 'Interview', brief: 'Brief ready', publish: 'Approved: not in ADO', review: 'Review and PR', merged: 'Merged' };
export const STEP_TITLE = { new: 'Inbox', triage: 'Shape: triage', waiting: 'Shape: waiting on requester', interview: 'Shape: interview', brief: 'Shape: brief', define: 'Define', publish: 'Define: approved, not in ADO', decide: 'Who builds it?', delegated: 'In flight: delegated', building: 'In flight: building', review: 'In flight: review and PR', merged: 'In flight: merged', resolved: 'Resolved' };
export const boardColumn = (step) => STEP_COLUMN[step] || step;

/**
 * The step a Shape or PM card is at: new, triage, waiting, interview, brief, define, publish, decide or delegated.
 * The board column is boardColumn(step). `work` is what the drafts say (draftState), `agent` its session
 * ({busy, waiting} or null).
 */
export function pmColumn(item, work = {}, agent = null) {
  const s = item.stage || 'new';
  if (s === 'delegated') return 'delegated';
  if (s === 'brief') return 'brief';
  if (s === 'shaping') return 'interview';
  if (s === 'decide') return 'decide';
  if (s === 'ready') return 'publish';
  if (s === 'defining') return work.ready && item.reopened !== 'defining' ? 'publish' : 'define';
  if (s === 'waiting') return 'waiting';
  if (s === 'triaged') return 'triage';
  if (agent && item.sessions && item.sessions.triage) return 'triage';
  return 'new';
}

/**
 * Dev column for an item you build: Resolved (ADO says so), Merged (every linked PR completed, or marked), else from
 * its Tandem run (the opencode connector's `state` model item): Review and PR from review on, Building before.
 */
export function devColumn(run, item = null) {
  if (item && item.stage === 'resolved') return 'resolved';
  if (item && item.merged) return 'merged';
  if (!run) return 'building';
  if (run.bucket === 'done' || run.bucket === 'shipped') return 'review';
  const st = (run.next && run.next.stage) || run.stage || '';
  if (['review', 'ship', 'pr', 'push', 'done', 'shipped'].includes(st)) return 'review';
  return 'building';
}

/** What a Building card says about its run: Not started, Waiting on you, Spec, Plan, Build. */
export function runStep(run) {
  if (!run) return 'Not started';
  if (run.next && run.next.needsYou) return 'Waiting on you';
  const st = (run.next && run.next.stage) || run.stage || '';
  return { brief: 'Brief', spec: 'Spec', plan: 'Plan', build: 'Build', bug: 'Bug fix', review: 'Review', ship: 'Ship' }[st] || 'In progress';
}

/* ---------- records ---------- */

export const newId = (p = 'w') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const str = (v, max) => String(v ?? '').slice(0, max);
const oneLine = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const RUN_FOLDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
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
  for (const k of ['triage', 'shape', 'define', 'handoff']) if (typeof (raw.work || {})[k] === 'string' && raw.work[k]) it.work[k] = raw.work[k];
  if (raw.kind === 'idea') it.kind = 'idea'; else delete it.kind;
  if (typeof raw.runwayPending === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(raw.runwayPending)) it.runwayPending = raw.runwayPending; else delete it.runwayPending;
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
  // The Tandem run this item is built in, when it is not found by ADO id (local work started from Slate or Dispatch).
  if (raw.run && typeof raw.run.folder === 'string' && RUN_FOLDER.test(raw.run.folder)) it.run = { folder: raw.run.folder, id: str(raw.run.id, 20) };
  else delete it.run;
  if (isDay(raw.merged)) { it.merged = raw.merged; it.mergedHow = raw.mergedHow === 'manual' ? 'manual' : 'prs'; } else { delete it.merged; delete it.mergedHow; }
  it.prs = cleanPrs(raw.prs); if (!it.prs) delete it.prs;
  if (['publish', 'build'].includes(raw.after)) it.after = raw.after; else delete it.after;
  // The ADO item the work came from, once Publish made new items for it (it was linked to them), and when the
  // triage questions were posted on the ADO item (Read replies reads comments after that).
  if (raw.source && Number.isInteger(raw.source.id)) it.source = { id: raw.source.id, url: /^https?:\/\//i.test(String(raw.source.url || '')) ? str(raw.source.url, 1000) : '', type: str(raw.source.type, 60) }; else delete it.source;
  if (raw.asked && Number.isInteger(raw.asked.id) && typeof raw.asked.at === 'string' && raw.asked.at.length <= 30) it.asked = { id: raw.asked.id, at: raw.asked.at }; else delete it.asked;
  it.createdAt = isDay(raw.createdAt) ? raw.createdAt : today();
  it.history = Array.isArray(raw.history) ? raw.history.filter(h => h && STAGES.includes(h.stage) && isDay(h.at)).slice(-50) : [];
  return it;
}

/** The last pull request check (workitem.prs): {status, at, list: [{id, status, title, repository, url}]}, or null. */
export function cleanPrs(raw) {
  if (!raw || typeof raw !== 'object' || !['none', 'open', 'merged', 'abandoned'].includes(raw.status)) return null;
  const list = (Array.isArray(raw.list) ? raw.list : []).filter(p => p && Number.isInteger(p.id)).slice(0, 20)
    .map(p => ({ id: p.id, status: oneLine(p.status, 20), title: oneLine(p.title, 200), repository: oneLine(p.repository, 100), url: /^https?:\/\//i.test(String(p.url || '')) ? str(p.url, 1000) : '' }));
  return { status: raw.status, at: str(raw.at, 30), list };
}

/** A new item from a request typed into Slate, or from an ADO backlog item. */
export function newItem({ title, description = '', level = 'story', ado = null, requester = '', requesterId = null, kind = null, runwayPending = null } = {}, now = new Date()) {
  const it = cleanItem({ id: newId(), title, description, level, stage: 'new', createdAt: today(now), requester, requesterId, kind, runwayPending });
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

export const STAGE_TITLE = { new: 'Inbox', triaged: 'Shape: triage', waiting: 'Shape: waiting on requester', shaping: 'Shape: interview', brief: 'Shape: brief', defining: 'Define', ready: 'Define: approved', decide: 'Who builds it?', delegated: 'In flight: delegated', dev: 'In flight: building', resolved: 'Resolved', done: 'Closed' };

/**
 * Earlier stages an item can go back to: the ones its history went through (New always), before where it is
 * now. `column` is where the board shows it: an item in Define whose draft is approved shows in Publish, so
 * Define is a step back for it. Delegated and building it yourself are two ends of one choice, so neither goes to the
 * other; both go back to Who builds it?.
 */
export function backTargets(it, column = null) {
  const cur = it.stage || 'new';
  const seen = new Set(['new', ...(it.history || []).map(h => h.stage)]);
  const before = STAGES.slice(0, STAGES.indexOf(cur));
  const out = before.filter(st => seen.has(st) && st !== 'ready');
  if (cur === 'defining' && column === 'publish') out.push('defining');
  const skip = cur === 'dev' || cur === 'resolved' ? 'delegated' : cur === 'delegated' ? 'dev' : null;
  return out.filter(st => st !== skip && st !== 'resolved');
}

/**
 * Later stages an item can skip ahead to, for work that is already done elsewhere (a feature whose stories are
 * already written goes straight to Who builds it?). Only Define and Who builds it?: Waiting and Publish need
 * triage questions or drafts, and Delegated and building go through Delegate and Build it myself.
 * Only from Inbox, Shape and Define (before Who builds it?).
 */
export function forwardTargets(it) {
  const cur = it.stage || 'new';
  if (!['new', 'triaged', 'waiting', 'shaping', 'brief', 'defining', 'ready'].includes(cur)) return [];
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

/**
 * Already shaped: straight to Who builds it?, skipping the rest of Shape and Define. The history line says it
 * skipped (Health tells those apart), and Move back can take it back to where it was.
 */
export const SKIP_FROM = ['new', 'triaged', 'waiting', 'shaping', 'brief', 'defining', 'ready'];
export function skipToDecide(it, now = new Date()) {
  if (!SKIP_FROM.includes(it.stage || 'new')) throw new Error('Only items in Shape, Define or Publish can skip to Who builds it?.');
  setStage(it, 'decide', now);
  const last = it.history[it.history.length - 1];
  if (last && last.stage === 'decide') last.skipped = true;
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

/**
 * Runway's Pending assignment ideas (its summary's `pending` rows) as cards for New: not stored until you act on
 * one, and left out once an item came from it (`runwayPending`) or you hid it (`dismissed`).
 */
export function pendingIdeaCards(rows, items = [], dismissed = [], now = new Date(), sent = []) {
  const taken = new Set(items.map(it => it.runwayPending).filter(Boolean));
  const hidden = new Set(dismissed);
  const mine = new Set(sent);
  return (Array.isArray(rows) ? rows : []).filter(r => r && typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(r.id) && typeof r.title === 'string' && !taken.has(r.id) && !hidden.has(r.id) && r.from !== APP && !(r.from == null && mine.has(r.title)))
    .map(r => ({ ...newItem({ title: r.title, description: r.note || '', kind: 'idea' }, now), id: `rw_${r.id}`, virtual: true, fromRunway: r.id, createdAt: isDay(r.due) ? r.due : today(now) }));
}

/**
 * Titles of the ideas Slate itself sent to Runway (Add to roadmap), as Runway titles them (the first line of the
 * offer's text). Since Runway 1.14.0 pending rows say who sent them (`from`), and Slate leaves out rows from itself
 * by that; this title match is only for rows from before, with no `from`. `env` is Slate's handoffs envelope.
 */
export function sentIdeaTitles(env) {
  const list = (env && Array.isArray(env.items)) ? env.items : [];
  return list.filter(h => h && h.to === 'runway' && h.payload && h.payload.kind === 'idea' && typeof h.text === 'string')
    .map(h => h.text.trim().split('\n')[0].trim().replace(/\s+/g, ' ').slice(0, 200)).filter(Boolean);
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

/* ---------- the Shape interview (eng-agents /shape, Core 2.16.0) ---------- */

export const SHAPE_FILES = ['idea.md', 'questions.md', 'understanding.md', 'answers.md', 'brief.md'];

/**
 * questions.md (templates/shape-questions.md): {status: 'ASKING' | 'READY' | null, round, questions: [{n, text,
 * options: [{key, text}], recommended, why}]}. A question needs at least one option to count.
 */
export function parseShapeQuestions(text) {
  if (!text) return null;
  const body = stripComments(text);
  const st = (headerLine(body, 'Status') || '').toUpperCase();
  const round = parseInt(headerLine(body, 'Round') || '', 10);
  const questions = [];
  let q = null, fence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    let m = /^##\s+Q(\d+)\s*[:.]\s*(.+?)\s*$/.exec(line);
    if (m) { q = { n: Number(m[1]), text: m[2], options: [], recommended: null, why: '' }; questions.push(q); continue; }
    if (/^#{1,2}\s/.test(line)) { q = null; continue; }
    if (!q) continue;
    m = /^\s*[-*]\s+([A-Za-z])[).:]\s*(.+?)\s*$/.exec(line);
    if (m) { q.options.push({ key: m[1].toUpperCase(), text: m[2] }); continue; }
    m = /^\s*Recommended:\s*\(?([A-Za-z])\b/.exec(line);
    if (m) { q.recommended = m[1].toUpperCase(); continue; }
    m = /^\s*Why:\s*(.+?)\s*$/.exec(line);
    if (m) q.why = m[1];
  }
  const good = questions.filter(x => x.options.length && !/^<.*>$/.test(x.text)).slice(0, 10);
  for (const x of good) if (!x.options.some(o => o.key === x.recommended)) x.recommended = null;
  return { status: st === 'ASKING' || st === 'READY' ? st : null, round: Number.isFinite(round) && round > 0 ? round : null, questions: good };
}

const BRIEF_LEVEL = { epic: 'epic', feature: 'feature', 'user story': 'story', story: 'story', bug: 'bug' };
/** brief.md (templates/shape-brief.md): {title, product, level, size, problem, open}. */
export function parseBrief(text) {
  if (!text) return null;
  const s = sections(text);
  const size = (headerLine(text, 'Size') || '').toUpperCase();
  return {
    title: (/^#\s+Brief:\s*(.+?)\s*$/m.exec(text) || [])[1] || '',
    product: headerLine(text, 'Product') || '',
    level: BRIEF_LEVEL[(headerLine(text, 'Level') || '').trim().toLowerCase()] || null,
    size: ['S', 'M', 'L', 'XL'].includes(size) ? size : null,
    problem: s.problem || '',
    open: bullets(s['open questions'])
  };
}

/** Where an item's interview stands, from its files and its agent: what the Interview column shows. */
export function shapeState(files = {}, agent = null) {
  const q = parseShapeQuestions(files['questions.md']);
  const hasBrief = !!(files['brief.md'] && files['brief.md'].trim());
  const running = !!(agent && (agent.busy || agent.waiting));
  return {
    q, round: q ? q.round : null,
    ready: !!(q && q.status === 'READY' && hasBrief),
    asking: !running && !!(q && q.status === 'ASKING' && q.questions.length)
  };
}

/**
 * One round of answers, as a block for answers.md. `answers` is {n: {pick: option key | 'other' | 'skip', other:
 * text}}; `notes` is free text. Unanswered questions are Skipped.
 */
export function answersBlock(round, questions, answers = {}, notes = '') {
  const out = [`## Round ${round || 1}`, ''];
  for (const q of questions || []) {
    const a = answers[q.n] || {};
    const opt = q.options.find(o => o.key === a.pick);
    const other = String(a.other || '').trim();
    const ans = a.pick === 'other' && other ? other : opt ? `${opt.key}) ${opt.text}${other ? `. ${other}` : ''}` : 'Skipped';
    out.push(`### Q${q.n}: ${q.text}`, '', `Answer: ${ans}`, '');
  }
  const n = String(notes || '').trim();
  if (n) out.push('### Notes', '', n, '');
  return out.join('\n');
}

/** A notes-only block (Keep going from the brief). */
export function notesBlock(round, notes) {
  const n = String(notes || '').trim();
  return n ? `## Round ${round || 1} notes, after the brief\n\n${n}\n` : '';
}

/** answers.md with a block added at the end (a new file starts with a title). */
export function appendAnswers(before, block) {
  const head = before && before.trim() ? before.replace(/\s+$/, '') + '\n\n' : '# Answers\n\n<!-- Written by Slate, one block per round. /shape reads it. -->\n\n';
  return head + block.replace(/\s+$/, '') + '\n';
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
    // The card's own ADO item (an Issue, say) is not part of what was made: link it to the top item made and
    // say so on it, so whoever asked can follow the work. Once, by the `source` ref in published.
    const top = epicRef ? 'epic' : m.features.length ? `feature ${m.features[0].num}` : null;
    if (item.ado && top && item.ado.id !== epicId && item.ado.id !== m.epic.id) {
      const what = epicRef ? m.epic.title : m.features[0].title;
      plan.push(published.source ? { ref: 'source', op: 'skip', id: item.ado.id, type: item.ado.type, title: item.title, to: top }
        : { ref: 'source', op: 'link', id: item.ado.id, rev: item.ado.rev, type: item.ado.type, title: item.title, to: top, toTitle: what, toType: epicRef ? 'Epic' : 'Feature' });
    }
  }
  return plan;
}

/** The comment Publish adds to the source item: what it became. `made` is the top item's {id, type, title}. */
export function sourceComment(made) {
  return `Shaped in Slate into ${made.type || 'a work item'} #${made.id}: ${made.title || ''}. That is where the work is tracked now; this item is linked to it as Related.`.replace(/: \./, '.');
}

/** Scope (scope and slice) rather than refine: an epic or feature, or a triage that sized it L or XL. */
export function suggestsScope(item, triage) {
  return !!(item && (item.level === 'epic' || item.level === 'feature')) || !!(triage && (triage.size === 'L' || triage.size === 'XL'));
}

/** The triage questions as one message for the requester (copied, or posted on the ADO item). */
export function questionsText(item, triage) {
  const qs = (triage && triage.questions) || [];
  return `${item.title}${item.ado ? ` (#${item.ado.id})` : ''}\n\nA few questions before we start:\n${qs.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
}

/** Comments on the ADO item since the questions were posted (`asked.at`), oldest first, as answers.md text. */
export function repliesSince(comments, at) {
  const t = Date.parse(at || '');
  const rows = (comments || []).filter(c => c && c.text && String(c.text).trim() && (!Number.isFinite(t) || Date.parse(c.date || '') > t) && !/^A few questions before we start:/m.test(String(c.text)));
  return rows.map(c => `${c.by && c.by.name ? c.by.name : 'Someone'} (${String(c.date || '').slice(0, 10)}):\n${String(c.text).trim()}`).join('\n\n');
}

/**
 * What the agents are asking about this item, so the panel can answer it in place: permission prompts and
 * questions (opencode connector `state`, `liveMode.live`) from any session Slate started for it, its `.work`
 * folders, or its Tandem run's folder (In flight). `{permissions, questions, count}`.
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
export const STALE_DAYS = { new: 3, triage: 3, waiting: 5, interview: 5, brief: 3, define: 7, publish: 2, decide: 3 };
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

/** True when an item has sat in its column longer than STALE_DAYS allows. Your own ideas can wait in New. */
export const isStale = (it, column, now = new Date()) => !(column === 'new' && (it.kind === 'idea' || it.runwayPending))
  && STALE_DAYS[column] != null && daysInStage(it, now) > STALE_DAYS[column];

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

/**
 * Health numbers for the Health tab: per board column {count, stale, medianDays}, the oldest open items, and load.
 * `columnOf(it)` gives the item's step; stale limits apply per step, counts per board column.
 */
export function health(items, columnOf, now = new Date()) {
  const cols = {};
  const open = items.filter(it => !['done'].includes(it.stage));
  for (const it of open) {
    const step = columnOf(it);
    const c = (cols[boardColumn(step)] ||= { count: 0, stale: 0, days: [] });
    c.count++;
    const d = daysInStage(it, now);
    c.days.push(d);
    if (isStale(it, step, now)) c.stale++;
  }
  for (const c of Object.values(cols)) { const s = c.days.sort((a, b) => a - b); c.medianDays = s.length ? s[Math.floor((s.length - 1) / 2)] : 0; delete c.days; }
  const oldest = open.filter(it => !['dev', 'delegated', 'resolved'].includes(it.stage)).map(it => ({ it, days: daysInStage(it, now), column: STEP_TITLE[columnOf(it)] || columnOf(it) }))
    .sort((a, b) => b.days - a.days).slice(0, 8);
  const load = {};
  for (const it of items) if (it.stage === 'delegated' && it.assignee) load[it.assignee] = (load[it.assignee] || 0) + 1;
  // Request to decision: days from created to the first decide, delegated or dev line.
  const toDecision = items.map(it => {
    const d = (it.history || []).find(h => ['decide', 'delegated', 'dev'].includes(h.stage));
    const a = dayNum(it.createdAt), b = d && dayNum(d.at);
    return a != null && b != null ? b - a : null;
  }).filter(x => x != null).sort((a, b) => a - b);
  // Request to resolved: days from created to the first resolved line (merged to main), for what you built or delegated.
  const toResolved = items.map(it => {
    const d = (it.history || []).find(h => h.stage === 'resolved');
    const a = dayNum(it.createdAt), b = d && dayNum(d.at);
    return a != null && b != null ? b - a : null;
  }).filter(x => x != null).sort((a, b) => a - b);
  const closed = items.filter(it => it.stage === 'done').length;
  const median = (l) => (l.length ? l[Math.floor((l.length - 1) / 2)] : null);
  return { cols, oldest, load, closed, toDecision: { n: toDecision.length, median: median(toDecision) }, toResolved: { n: toResolved.length, median: median(toResolved) } };
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
    if (it.stage === 'dev' && it.merged && it.ado) { needs.push(row(it, 'Merged: mark it resolved')); continue; }
    if (it.stage === 'dev' && it.merged && !it.ado) { needs.push(row(it, 'Merged: link its ADO item', 'waiting')); continue; }
    if (['dev', 'done', 'delegated', 'resolved'].includes(it.stage)) continue;
    const a = agentOf(it), col = columnOf(it);
    if (a && a.waiting) needs.push(row(it, 'An agent is asking you something', 'urgent'));
    else if (col === 'decide') needs.push(row(it, 'Decide who builds it'));
    else if (col === 'publish') needs.push(row(it, 'Approved: publish to ADO'));
    else if (col === 'define' && it.draftReady) needs.push(row(it, 'A draft is ready to approve'));
    else if (col === 'triage' && !(a && a.busy)) needs.push(row(it, 'Triage is done: ask, interview or define'));
    else if (col === 'interview' && it.shapeAsking) needs.push(row(it, 'Answer the interview questions'));
    else if (col === 'brief') needs.push(row(it, 'Brief ready: send it to Define'));
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
    const h = [...(it.history || [])].reverse().find(x => ['delegated', 'dev', 'decide', 'resolved', 'done'].includes(x.stage) && x.at >= week);
    if (!h) continue;
    const what = h.stage === 'delegated' ? 'Delegated' : h.stage === 'dev' ? 'Taking it on myself' : h.stage === 'decide' ? 'Defined and published' : h.stage === 'resolved' ? 'Resolved: merged to main' : 'Closed';
    done.push({ ...row(it, what), due: h.at });
  }
  done.sort((a, b) => b.due.localeCompare(a.due));
  const ado = items.filter(it => it.ado && ['dev', 'delegated', 'decide'].includes(it.stage)).slice(-20)
    .map(it => ({ id: String(it.ado.id), title: it.title.slice(0, 200), route: `item/${it.id}`, ...(it.requester ? { note: `Asked by ${it.requester}`.slice(0, 200) } : {}) }));
  // Every run Slate tracks, by ADO id and by run folder, so Dispatch links local runs too and knows which merged.
  const runs = items.filter(it => (it.ado || it.run) && ['dev', 'resolved'].includes(it.stage)).slice(-50)
    .map(it => ({ id: it.ado ? String(it.ado.id) : it.run.folder, ...(it.run ? { folder: it.run.folder } : {}), title: it.title.slice(0, 200), route: `item/${it.id}`,
      note: it.stage === 'resolved' ? 'Resolved' : it.merged ? 'Merged' : it.requester ? `Asked by ${it.requester}`.slice(0, 200) : 'Building', ...(it.merged || it.stage === 'resolved' ? { flag: 'done' } : {}) }));
  // Every ADO item on the board, with its column, and the items Publish linked as a source (Docket's In Slate chip).
  const colTitle = Object.fromEntries(BOARD_COLUMNS.map(c => [c.key, c.title]));
  const tracked = [];
  for (const it of items) {
    if (it.stage === 'done') continue;
    const col = colTitle[boardColumn(columnOf ? columnOf(it) : it.stage)] || '';
    if (it.ado) tracked.push({ id: String(it.ado.id), title: it.title.slice(0, 200), route: `item/${it.id}`, note: col });
    if (it.source && it.ado) tracked.push({ id: String(it.source.id), title: it.title.slice(0, 200), route: `item/${it.id}`, note: `Source of #${it.ado.id}` });
  }
  // Runway pending ideas Slate has taken (Runway marks them "Shaping in Slate"). Only for showing.
  const shaping = items.filter(it => it.runwayPending).slice(-50)
    .map(it => ({ id: it.runwayPending, title: it.title.slice(0, 200), route: `item/${it.id}` }));
  return [
    card('needs', 'list', 'Needs you in Slate', { rows: needs.slice(0, 20), count: needs.length, route: '' }),
    card('shaping', 'list', 'Runway ideas in Slate', { rows: shaping }),
    card('delegated', 'people', 'Delegated', { rows: [...people.values()].slice(0, 200) }),
    card('done-week', 'list', 'Decisions this week', { rows: done.slice(0, 20), count: done.length }),
    card('ado', 'list', 'ADO items in Slate', { rows: ado }),
    card('runs', 'list', 'Runs in Slate', { rows: runs }),
    card('tracked', 'list', 'ADO items on Slate\'s board', { rows: tracked.slice(-200) })
  ];
}

/* ---------- work started in Dispatch (handoffs to Slate, kind `work`) ---------- */

/**
 * Apply a `work` handoff (Workshop docs/handoffs.md, Receivers: slate) to the items list in place: link it to the
 * card for the same run folder or ADO id, or add a card in Building. Returns the item's id, or null when the offer
 * is not one Slate reads. The person started the run in Dispatch, so it is accepted-ready (rule 4).
 */
export function applyWork(list, offer, now = new Date()) {
  const p = (offer && offer.payload) || {};
  if (!offer || offer.to !== APP || p.kind !== 'work') return null;
  const folder = typeof p.folder === 'string' && RUN_FOLDER.test(p.folder) ? p.folder : '';
  const adoId = Number.isInteger(p.ado) ? p.ado : /^\d{1,10}$/.test(String(p.ado || '')) ? Number(p.ado) : null;
  if (!folder && !adoId) return null;
  const mark = (x) => {
    if (folder) x.run = { folder, id: str(p.id, 20) };
    if (adoId && !x.ado) x.ado = { id: adoId, rev: 0, type: p.lane === 'bug' ? 'Bug' : '', url: '', connection: '', area: '', state: '' };
    if (!['dev', 'resolved', 'done'].includes(x.stage)) {
      x.route = 'myself'; x.assignee = null;
      setStage(x, 'dev', now);
      x.history[x.history.length - 1].from = 'dispatch';
    }
  };
  const found = list.find(x => (folder && x.run && x.run.folder === folder) || (adoId && x.ado && x.ado.id === adoId));
  if (found) { mark(found); return found.id; }
  const title = oneLine(p.title || offer.text, 255) || (adoId ? `#${adoId}` : folder);
  const it = newItem({ title, description: str(p.description, 32000), level: p.lane === 'bug' ? 'bug' : 'story' }, now);
  it.history = [{ stage: 'dev', at: today(now), from: 'dispatch' }];
  it.stage = 'dev';
  it.route = 'myself';
  if (folder) it.run = { folder, id: str(p.id, 20) };
  if (adoId) it.ado = { id: adoId, rev: 0, type: p.lane === 'bug' ? 'Bug' : '', url: '', connection: '', area: '', state: '' };
  list.push(it);
  return it.id;
}

/**
 * A roadmap item from Runway's Work item button (handoffs to Slate, kind `roadmap-item`, docs/handoffs.md): the card
 * already made for that roadmap item, or a new one in New from the offer (title, notes, level, ADO link). Returns the
 * card id, or null when the offer is not a roadmap-item from Runway. Slate never reads Runway's roadmaps.
 */
export function applyRoadmapItem(list, offer, now = new Date()) {
  const p = (offer && offer.payload) || {};
  if (!offer || offer.to !== APP || p.kind !== 'roadmap-item' || !offer.source || offer.source.app !== 'runway') return null;
  const map = str(p.map, 80), item = str(p.item, 120);
  if (!map || !item) return null;
  const found = list.find(x => x.runway && x.runway.map === map && x.runway.item === item);
  if (found) return found.id;
  const level = ['epic', 'feature', 'story'].includes(p.level) ? p.level : 'story';
  const a = p.ado && Number.isInteger(p.ado.id) ? p.ado : null;
  const it = newItem({ title: oneLine(p.title || offer.text, 255) || 'Untitled', description: str(p.notes, 32000), level }, now);
  if (a) it.ado = { id: a.id, rev: Number(a.rev) || 0, type: str(a.type, 60), url: str(a.url, 2000), connection: str(a.connection, 120), area: '', state: str(a.state, 60) };
  it.runway = { map, item };
  list.push(it);
  return it.id;
}

/**
 * A request captured on Home or in the Dispatch hub (handoffs to Slate, kind `request`, docs/handoffs.md): with an
 * ADO id, the card for that item gets the note (or a card in New is made, titled `#<id>` until Slate reads the
 * item); without one, a request card in New. Returns the item's id, or null when the offer is not one Slate reads.
 */
export function applyRequest(list, offer, now = new Date()) {
  const p = (offer && offer.payload) || {};
  if (!offer || offer.to !== APP || p.kind !== 'request') return null;
  const adoId = Number.isInteger(p.ado) && p.ado > 0 ? p.ado : /^\d{1,10}$/.test(String(p.ado || '')) ? Number(p.ado) : null;
  const note = str(p.note, 4000).trim();
  const day = today(now);
  if (adoId) {
    const found = list.find(x => x.ado && x.ado.id === adoId);
    if (found) {
      if (note && !String(found.description || '').includes(note)) found.description = str(`${found.description ? found.description + '\n\n' : ''}Note (${day}): ${note}`, 32000);
      return found.id;
    }
    const it = newItem({ title: `#${adoId}`, description: note ? `Note (${day}): ${note}` : '', ado: { id: adoId, rev: 0, type: '', url: '', connection: '', area: '', state: '' } }, now);
    it.history = [{ stage: 'new', at: day, from: 'capture' }];
    list.push(it);
    return it.id;
  }
  const text = note || str(offer.text, 4000).trim();
  if (!text) return null;
  const [first, ...rest] = text.split('\n');
  const it = newItem({ title: oneLine(first, 255) || 'Untitled', description: rest.join('\n').trim() || (first.length > 255 ? text : '') }, now);
  it.history = [{ stage: 'new', at: day, from: 'capture' }];
  list.push(it);
  return it.id;
}

/** A card made from `#<id>` before Slate read the item: its title is still the id. */
export const needsAdoTitle = (it) => !!(it && it.ado && (it.title === `#${it.ado.id}` || !it.ado.type));

/* ---------- release planning (the Resolved column) ---------- */

/** Resolved items grouped by area path, for planning a release: [{area, label, items}], areas A to Z, none last. */
export function releaseGroups(items) {
  const m = new Map();
  for (const it of items) {
    if (it.stage !== 'resolved') continue;
    const a = areaOf(it);
    const k = a.toLowerCase();
    if (!m.has(k)) m.set(k, { area: a, label: a || 'No area path', items: [] });
    m.get(k).items.push(it);
  }
  return [...m.values()].sort((x, y) => (!x.area) - (!y.area) || x.area.toLowerCase().localeCompare(y.area.toLowerCase()));
}

/** Release notes for a group as Markdown: one line per item (title, ADO link) and its release notes field when set. */
export function releaseNotesMd(group, notes = {}) {
  const lines = [`## ${group.label}`, ''];
  for (const it of group.items) {
    const id = it.ado ? `#${it.ado.id}` : '';
    const link = it.ado && /^https?:\/\//i.test(it.ado.url || '') ? ` ([${id}](${it.ado.url}))` : id ? ` (${id})` : '';
    lines.push(`- **${it.title.replace(/\*/g, '')}**${link}`);
    const n = String(notes[it.id] || '').trim();
    if (n) for (const l of n.split(/\r?\n/).filter(x => x.trim())) lines.push(`  ${l.trim()}`);
  }
  return lines.join('\n') + '\n';
}

/* ---------- the item's timeline ---------- */

const STEP_TEXT = { new: 'Captured', triaged: 'Triaged', waiting: 'Questions sent to the requester', shaping: 'Interview', brief: 'Brief written', defining: 'Defining', ready: 'Draft approved', decide: 'Who builds it?', delegated: 'Delegated', dev: 'Building it myself', resolved: 'Resolved in ADO (merged to main)', done: 'Closed' };

/**
 * The whole journey, oldest first: [{at, text, url?}] from the history (with where it came from, skips and moves
 * back), what was published, the Tandem run's stage now, the pull requests and merged. Read only.
 */
export function timeline(it, { run = null, assigneeName = '' } = {}) {
  const out = [];
  const hist = it.history || [];
  hist.forEach((h, i) => {
    let text = STEP_TEXT[h.stage] || h.stage;
    if (i === 0 && h.stage === 'new') text = it.kind === 'idea' ? 'Idea captured' : it.requester ? `Request from ${it.requester}` : it.ado ? `From ADO #${it.ado.id}` : 'Captured';
    if (h.from === 'dispatch') text = 'Started in Dispatch';
    if (h.from === 'capture') text = it.ado ? `Captured on Home: ADO #${it.ado.id}` : 'Captured on Home';
    if (h.skipped) text += ' (skipped shaping)';
    if (h.stage === 'delegated' && assigneeName) text = `Delegated to ${assigneeName}`;
    const prev = hist.slice(0, i).map(x => STAGES.indexOf(x.stage));
    if (prev.length && STAGES.indexOf(h.stage) < Math.max(...prev) && !h.from) text = `Moved back: ${text}`;
    out.push({ at: h.at, text });
  });
  const pub = Object.entries(it.published || {}).filter(([k]) => k !== 'source').map(([, v]) => v);
  if (pub.length && it.ado) out.push({ at: '', text: `Published to ADO: ${pub.map(n => `#${n}`).join(', ')}`, url: it.ado.url || '' });
  if (it.source) out.push({ at: '', text: `Came from #${it.source.id}${it.source.type ? ` (${it.source.type})` : ''}, linked to the new items`, url: it.source.url || '' });
  if (run && it.stage === 'dev') out.push({ at: '', text: `Tandem: ${runStep(run)}${run.next && run.next.text ? `. ${run.next.text}` : ''}`, run: run.id || run.folder || '' });
  for (const p of (it.prs && it.prs.list) || []) out.push({ at: '', text: `Pull request ${p.id}${p.repository ? ` in ${p.repository}` : ''}: ${p.status === 'completed' ? 'merged' : p.status}`, url: p.url });
  if (it.merged) out.push({ at: it.merged, text: it.mergedHow === 'manual' ? 'Marked merged' : 'All pull requests merged' });
  return out;
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
  card: ['assignee', 'priority', 'tags'],
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
