/* People and Lattice: the text People hands to Lattice (Copy for Lattice) and the goals it takes back (Import
   from Lattice). Lattice is the shared record; People is the private notebook. Nothing here talks to Lattice:
   copies go to the clipboard, imports come from text you paste or a file you pick. Pure, no DOM or SDK
   (test/lattice.test.mjs).

   Concerns never leave People: every builder here drops receipts of kind `concern`. */
import { bullet, shortDate } from './state.js';
import { GOALS, TEAM, norm, parseDoc } from './goals/model.js';

const lines = list => list.filter(Boolean).join('\n');
const shareable = e => e && e.kind !== 'concern';

/* ---------- Copy for Lattice ---------- */

/**
 * Talking points for Lattice's shared 1:1 agenda. The `## Talking points` section of today's note when it has
 * any lines; otherwise built from the prep (packet, oneonones/model.js buildPacket): open follow-ups from last
 * time, what is waiting on them in Tasks, and new wins, feedback and growth areas. Never concerns.
 */
export function talkingPoints(noteText, packet) {
  const own = noteSection(noteText, 'talking points').map(l => l.replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, '').trim()).filter(Boolean);
  if (own.length) return lines(own.map(t => `- ${t}`)) + '\n';
  const out = [];
  if (packet && packet.last && packet.last.state === 'ok') for (const t of packet.last.open) out.push(`- Follow up: ${t}`);
  if (packet && packet.tasks && packet.tasks.state === 'ok') for (const t of packet.tasks.waiting) out.push(`- Check in: ${t.title}`);
  if (packet && packet.receipts && packet.receipts.state === 'ok') {
    const g = packet.receipts.groups || {};
    for (const e of g.win || []) out.push(`- Shout out: ${bullet(e)}`);
    for (const e of g.feedback || []) out.push(`- Feedback: ${bullet(e)}`);
    for (const e of g.growth || []) out.push(`- Growth: ${bullet(e)}`);
  }
  return out.length ? lines(out) + '\n' : '';
}

/** The lines under `## <name>` in a Markdown note, up to the next heading of level 1 or 2. */
export function noteSection(text, name) {
  const src = String(text || '').split(/\r?\n/);
  const at = src.findIndex(l => /^##\s+/.test(l) && norm(l.replace(/^##\s+/, '')) === norm(name));
  if (at < 0) return [];
  const out = [];
  for (let i = at + 1; i < src.length && !/^#{1,2}\s/.test(src[i]); i++) if (/^\s*[-*+]\s+\S/.test(src[i])) out.push(src[i]);
  return out.filter(l => !/^\s*[-*+]\s*(\[[ xX]\])?\s*$/.test(l));
}

/** One receipt as text for Lattice feedback or praise. '' for a concern. */
export function receiptText(e) {
  if (!shareable(e)) return '';
  return `${bullet(e)}${e.date ? ` (${shortDate(e.date)})` : ''}`;
}

/** One review section's bullets for Lattice's review form, best first (buildReview's order). No concerns. */
export function sectionText(group, { withDates = false } = {}) {
  return lines((group && group.items || []).filter(shareable).map(e => `- ${bullet(e)}${withDates ? ` [${shortDate(e.date)}]` : ''}`));
}

/** Every section with something to say, headed, for Copy all. texts: optional edited text per section name. */
export function reviewText(review, texts = {}) {
  const parts = [];
  for (const g of review.groups || []) {
    const body = (texts[g.section] != null ? String(texts[g.section]) : sectionText(g)).trim();
    if (body) parts.push(`${g.section}\n${body}`);
  }
  return parts.length ? parts.join('\n\n') + '\n' : '';
}

/** One objective (goals/model.js parseDoc) for a Lattice goal: the title, then a line per key result. */
export function objectiveText(o) {
  if (!o) return '';
  const krs = (o.krs || []).map(k => {
    const p = k.progress || {};
    const bits = [p.label, p.status].filter(Boolean).join(', ');
    return `- ${k.text}${bits ? `: ${bits}` : ''}`;
  });
  return lines([o.title, ...krs]) + '\n';
}

/* ---------- Import from Lattice ---------- */

// Header names a goals export may use, lowercased. The first column that matches wins.
const COLS = {
  name: ['goal', 'goal name', 'name', 'title', 'objective', 'key result', 'description'],
  owner: ['owner', 'owners', 'owner name', 'assignee', 'person', 'employee'],
  progress: ['progress', 'progress (%)', 'percent complete', '% complete', 'completion', 'current value', 'percent'],
  status: ['status', 'state', 'health'],
  parent: ['parent', 'parent goal', 'aligned to', 'aligned with', 'supports', 'parent name']
};
const STATUS = { 'on track': 'on track', 'on-track': 'on track', ontrack: 'on track', progressing: 'on track', 'in progress': 'on track',
  'at risk': 'at risk', 'at-risk': 'at risk', 'needs attention': 'at risk', behind: 'at risk',
  'off track': 'off track', 'off-track': 'off track', 'not on track': 'off track',
  done: 'done', complete: 'done', completed: 'done', closed: 'done', achieved: 'done' };

/** CSV or tab-separated text (a spreadsheet paste) to rows of cells. Quotes as in RFC 4180. */
export function readTable(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] || '';
  const sep = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && !cell) q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(Boolean));
}

/** A progress cell to People's form: '40%', 'done', or '' when there is none. 0.4 reads as 40%. */
export function progressOf(cell) {
  const s = String(cell || '').trim();
  if (!s) return '';
  if (/^(done|complete|completed|100\s*%)$/i.test(s)) return /%/.test(s) ? '100%' : 'done';
  const m = /^(\d+(?:\.\d+)?)\s*%?$/.exec(s);
  if (!m) return '';
  let n = Number(m[1]);
  if (!/%/.test(s) && n > 0 && n <= 1 && /\./.test(m[1])) n = Math.round(n * 1000) / 10;
  return `${Number(n.toFixed(1))}%`;
}

/**
 * Goals from a Lattice export (CSV, or rows pasted from a spreadsheet) to [{name, owner, progress, status, parent}].
 * The first row must be headers; columns are found by name (COLS). Throws when no goal column is found.
 */
export function parseLatticeGoals(text) {
  const rows = readTable(text);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const col = {};
  for (const [k, names] of Object.entries(COLS)) { const i = names.map(n => head.indexOf(n)).find(i => i >= 0); col[k] = i == null ? -1 : i; }
  if (col.name < 0) throw new Error('No goal column found. The first row needs a header such as Goal, Name or Title.');
  const cell = (r, k) => (col[k] >= 0 ? String(r[col[k]] || '').trim() : '');
  return rows.slice(1).map(r => ({
    name: cell(r, 'name').replace(/[\r\n]+/g, ' ').slice(0, 300),
    owner: cell(r, 'owner').split(/[;,]/)[0].trim(),
    progress: progressOf(cell(r, 'progress')),
    status: STATUS[cell(r, 'status').toLowerCase()] || '',
    parent: cell(r, 'parent').replace(/[\r\n]+/g, ' ')
  })).filter(g => g.name);
}

/**
 * Which Goals doc each imported goal lands in, and how. people: [{id, name, folder}] (your reports);
 * meNames: names that mean you or the team (your name, "team"); docs: {path: text} of this quarter's docs.
 * A goal whose parent is another goal in the import with the same owner is a key result of that one;
 * every other goal is an objective (with its own progress as its one key result when it has no children).
 * Returns [{key, title, owner: 'team' | folder | '', who, unknownOwner, supports, krs: [{text, progress, status}],
 *   action: 'new' | 'update' | 'same', changes}] for the import dialog.
 */
export function planImport(goals, { people = [], meNames = [], docs = {}, quarter = '' } = {}) {
  const mine = new Set(['', 'team', 'me', ...meNames.map(norm)]);
  const ownerOf = name => {
    const n = norm(name);
    if (mine.has(n)) return { owner: TEAM, who: 'Team' };
    const p = people.find(x => norm(x.name) === n) || people.find(x => norm(x.name).split(' ')[0] === n.split(' ')[0] && n.split(' ').length === 1);
    return p ? { owner: p.folder, who: p.name } : { owner: '', who: name, unknownOwner: true };
  };
  const byName = new Map(goals.map(g => [norm(g.name), g]));
  const isKr = g => { const p = g.parent && byName.get(norm(g.parent)); return !!p && norm(p.owner) === norm(g.owner); };
  const plan = [];
  for (const g of goals) {
    if (isKr(g)) continue;
    const o = ownerOf(g.owner);
    const kids = goals.filter(k => isKr(k) && norm(k.parent) === norm(g.name));
    const krs = (kids.length ? kids : [g]).map(k => ({ text: k.name, progress: k.progress || '0%', status: k.status }));
    const parentGoal = g.parent && byName.get(norm(g.parent));
    const supports = o.owner === TEAM ? '' : (parentGoal ? parentGoal.name : g.parent);
    const item = { key: `${o.owner || 'x'}#${norm(g.name)}`, title: g.name, ...o, supports, krs, action: 'new', changes: [] };
    const text = o.owner ? docs[`${GOALS}/${o.owner}/${quarter}.md`] : null;
    if (text != null) {
      const have = parseDoc(text).objectives.find(x => norm(x.title) === norm(g.name));
      if (have) {
        item.action = 'same';
        for (const k of krs) {
          const cur = have.krs.find(x => norm(x.text) === norm(k.text));
          if (!cur) { item.changes.push(`New key result: ${k.text}`); continue; }
          const was = cur.progress.label || '';
          if (k.progress && k.progress !== was && !(k.progress === '100%' && was === 'done')) item.changes.push(`${k.text}: ${was || 'no progress'} to ${k.progress}`);
          if (k.status && k.status !== cur.progress.status) item.changes.push(`${k.text}: ${cur.progress.status || 'no status'} to ${k.status}`);
        }
        if (item.changes.length) item.action = 'update';
      }
    }
    plan.push(item);
  }
  return plan;
}

const krLine = k => `- ${k.text.replace(/:\s/g, ' - ')}: ${k.progress || '0%'}${k.status ? ` [${k.status}]` : ''}`;

/**
 * A Goals doc's text with the planned objectives put in: progress and status of matching key results replaced
 * (only those lines change), missing key results added under their objective, missing objectives added at the end.
 * Nothing is removed. text: the doc ('' or null for a new one); items: the plan rows for this doc.
 */
export function applyImport(text, items, { title = '' } = {}) {
  let src = text == null || text === '' ? `# ${title || 'Goals'}\n` : String(text);
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  for (const it of items) {
    const doc = parseDoc(src);
    const ls = src.split(/\r?\n/);
    const o = doc.objectives.find(x => norm(x.title) === norm(it.title));
    if (!o) {
      const block = ['', `## ${it.title.replace(/[\r\n]+/g, ' ')}`, '', ...(it.supports ? [`Supports: ${it.supports}`, ''] : []), ...it.krs.map(krLine)];
      while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
      src = [...ls, ...block, ''].join(eol);
      continue;
    }
    const add = [];
    for (const k of it.krs) {
      const cur = o.krs.find(x => norm(x.text) === norm(k.text));
      if (!cur) { add.push(krLine(k)); continue; }
      const m = /^(\s?[-*+]\s+(?:\[[ xX]\]\s+)?)/.exec(ls[cur.line]);
      const prog = k.progress === '100%' && cur.progress.label === 'done' ? 'done' : k.progress || cur.progress.label || '';
      const st = k.status || cur.progress.status || '';
      ls[cur.line] = `${m ? m[1] : '- '}${cur.text}${prog ? `: ${prog}` : ''}${st ? ` [${st}]` : ''}`;
    }
    if (add.length) {
      let after = o.krs.length ? Math.max(...o.krs.map(k => k.line)) : (o.supportsLine >= 0 ? o.supportsLine : o.line);
      while (o.krs.length && after + 1 < o.end && /^(?: {2,}|\t)\S/.test(ls[after + 1] || '')) after++; // past the last KR's notes
      ls.splice(after + 1, 0, ...(o.krs.length ? [] : ['']), ...add);
    }
    src = ls.join(eol);
  }
  return src.endsWith(eol) ? src : src + eol;
}

