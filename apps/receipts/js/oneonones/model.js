/* Rapport's 1:1s: the rules, with no DOM or SDK, so Node tests can import them.

   1:1s was its own Workshop app (id `oneonones`) until Rapport 2.0.0 folded it in. It keeps its own
   `oneonones/people` link table inside Rapport (app id `receipts`) and reads (never writes) what Docket keeps
   about the same people. Rapport's own entries and people are handed in by main.js. Each read checks the envelope's schema and version: an unknown version is
   unreadable, not empty (docs/data-format.md, Migrations, rule 6).

   Everyone you meet with is a person in Workshop's people directory (ws.people, docs/people.md): a 1:1s person
   keeps that id as `personId`, plus its own cadence. The same id finds their tasks in Docket's summary (the
   `people` card, docs/summaries.md, by id and through their groups) and, for a report, their receipts.

   Shapes read:
     prioritizer.summary v1  Docket's summary: the `people` card's rows {id, open, waiting}, tasks {id, title, due,
                             nudgeOn, via}
     receipts.entries v1     items: {id, about: 'me' | 'up' | person id, kind, date, text, ...} */

export const APP = 'receipts';
export const VERSION = 1;
export const DEFAULT_CADENCE = 7;
export const MAX_PACKET = 50000;          // characters sent to the draft step, at most

/** Rapport's collections and files for 1:1s (nested names, docs/data-format.md in workshop). */
export const PEOPLE = 'oneonones/people';
export const SETTINGS = 'oneonones/settings';
export const NOTES = 'oneonones/notes';
/** The old 1:1s app's data, copied in once (copyLegacy in data.js) and never changed. */
export const LEGACY = { app: 'oneonones', people: 'people', settings: 'settings', notes: 'notes' };

/** Collections read, with the schema and version this app understands. `own: true` are Rapport's own,
    handed in by main.js instead of read here. */
export const SOURCES = {
  docketSummary: { app: 'prioritizer', collection: 'summary', schema: 'prioritizer.summary', version: 1 },
  slateSummary: { app: 'slate', collection: 'summary', schema: 'slate.summary', version: 1 },
  receiptsEntries: { app: 'receipts', collection: 'entries', schema: 'receipts.entries', version: 1, own: true }
};

/** Receipts kinds, in the order the packet shows them. */
export const KINDS = ['win', 'feedback', 'growth', 'concern', 'note'];
export const KIND_LABELS = { win: 'Wins', feedback: 'Feedback given', growth: 'Growth', concern: 'Concerns', note: 'Notes' };

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lower = s => String(s || '').toLowerCase();
const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();

/* ---------- dates (local days as YYYY-MM-DD) ---------- */

const pad = n => String(n).padStart(2, '0');
export const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
export function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
export function addDays(day, n) {
  const d = parseDay(day);
  if (!d) return '';
  d.setDate(d.getDate() + n);
  return isoDay(d);
}
export function daysBetween(a, b) {
  const x = parseDay(a), y = parseDay(b);
  return x && y ? Math.round((y - x) / 864e5) : null;
}

/* ---------- reading other apps' collections ---------- */

/**
 * {state, env}: 'ok' with the envelope, 'missing' (never written: nothing to show), or 'unreadable'
 * (another schema, or a version this app does not know). Unreadable is never treated as empty.
 */
export function readable(env, src) {
  if (!env) return { state: 'missing', env: null };
  if (env.schema !== src.schema || env.version !== src.version || !Array.isArray(env.items)) return { state: 'unreadable', env: null };
  return { state: 'ok', env };
}

/** The `people` card of Docket's summary: [{id, open, waiting}], or null when Docket wrote none. */
export function docketPeopleCard(summaryEnv) {
  const r = readable(summaryEnv, SOURCES.docketSummary);
  if (r.state !== 'ok') return null;
  const card = r.env.items.find(c => c && c.id === 'people' && c.kind === 'people' && Array.isArray(c.rows));
  return card ? card.rows.filter(p => p && typeof p.id === 'string' && p.id) : null;
}

/** People and their relation for pickers, from the directory: active people (not you) by relation then name,
    plus `keep` (an id already chosen) even when archived. [{id, name, relation, archived}] */
export function directoryChoices(dir, keep = '') {
  const people = dir && Array.isArray(dir.people) ? dir.people : [];
  const order = { report: 0, manager: 1, peer: 2, contact: 3 };
  return people.filter(p => p.relation !== 'self' && (!p.archived || p.id === keep))
    .map(p => ({ id: p.id, name: p.name, relation: p.relation, archived: !!p.archived }))
    .sort((a, b) => (order[a.relation] ?? 4) - (order[b.relation] ?? 4) || a.name.localeCompare(b.name));
}

/* ---------- people (this app's link table) ---------- */

export function newPersonId(now = Date.now(), rnd = Math.random) {
  return `p_${now.toString(36)}${Math.floor(rnd() * 36 ** 4).toString(36).padStart(4, '0')}`;
}

const PERSON_ID = /^p_[A-Za-z0-9_-]{1,100}$/;

/** A 1:1s person from the stored item: {id, personId, name, cadenceDays, archived}. `id` is this table's own
    (it names the notes folder); `personId` is the person in the directory. `name` is what was typed or last
    known, shown only when the directory does not have them. A record from before personId takes its old
    report link (`links.receipts`). */
export function cleanPerson(p) {
  const x = p && typeof p === 'object' ? p : {};
  const old = x.links && typeof x.links === 'object' ? str(x.links.receipts, 110) : '';
  const pid = PERSON_ID.test(x.personId) ? x.personId : PERSON_ID.test(old) ? old : '';
  const c = Number(x.cadenceDays);
  return {
    id: str(x.id, 100),
    personId: pid,
    name: str(x.name, 120) || 'Unnamed',
    cadenceDays: Number.isInteger(c) && c >= 1 && c <= 90 ? c : DEFAULT_CADENCE,
    archived: x.archived === true
  };
}

/** A 1:1s person as shown: the directory's name and relation when linked. */
export function withDirectory(p, dir) {
  const d = p.personId && dir && dir.byId ? dir.byId.get(p.personId) : null;
  return { ...p, name: d ? d.name : p.name, relation: d ? d.relation : '', handle: d ? d.handle : '', linked: !!d };
}

/** Reports and your manager in the directory with no 1:1s person yet: one click adds them. */
export function directorySuggestions(people, dir) {
  const have = new Set(people.map(p => p.personId).filter(Boolean));
  return directoryChoices(dir).filter(d => !d.archived && (d.relation === 'report' || d.relation === 'manager') && !have.has(d.id));
}

/** A new 1:1s person for a directory person. */
export function personFromDirectory(d) {
  return { name: d.name, personId: d.id, cadenceDays: DEFAULT_CADENCE, archived: false };
}

export function sortPeople(list) {
  return list.slice().sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------- notes (this app's files) ---------- */

/** The notes folder for a person. File names follow Workshop's name rules (lowercase letters, digits, -). */
export function noteFolder(personId) {
  const seg = lower(personId).replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '').slice(0, 40) || 'person';
  return `${NOTES}/${seg}`;
}
export const notePath = (personId, day) => `${noteFolder(personId)}/${day}.md`;

/** A person's notes from a files list, newest first: [{day, path, mtime}]. */
export function notesFor(files, personId) {
  const folder = noteFolder(personId) + '/';
  return (files || []).filter(f => f && typeof f.path === 'string' && f.path.startsWith(folder))
    .map(f => ({ day: f.path.slice(folder.length).replace(/\.md$/, ''), path: f.path, mtime: f.mtime }))
    .filter(n => isDay(n.day))
    .sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * "Since last 1:1": the day of the newest note before today, else `cadenceDays` ago.
 * Returns {since, from: 'note' | 'cadence', last: note | null}.
 */
export function sinceDate({ notes, today, cadenceDays }) {
  const last = (notes || []).find(n => n.day < today) || null;
  if (last) return { since: last.day, from: 'note', last };
  return { since: addDays(today, -(cadenceDays || DEFAULT_CADENCE)), from: 'cadence', last: null };
}

/** When the next 1:1 is due: {lastDay, days (since the last note, or null), due}. */
export function cadenceState(notes, today, cadenceDays) {
  const last = (notes || []).find(n => n.day <= today) || null;
  const days = last ? daysBetween(last.day, today) : null;
  return { lastDay: last ? last.day : '', days, due: days === null || days >= cadenceDays };
}

/* ---------- follow-ups and wins in a note ---------- */

const TASK = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

/** Every task line in the note: {open: [text], done: [text]}. Empty placeholders are skipped. */
export function parseFollowUps(md) {
  const out = { open: [], done: [] };
  let fence = false;
  for (const line of String(md || '').split(/\r?\n/)) {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const m = TASK.exec(line);
    if (!m) continue;
    const text = oneLine(m[2]);
    if (!text) continue;
    (m[1] === ' ' ? out.open : out.done).push(text);
  }
  return out;
}

/** The bullet lines under a "Wins" heading (task lines and empty bullets are skipped). */
export function parseWins(md) {
  const out = [];
  let level = 0;
  let fence = false;
  for (const line of String(md || '').split(/\r?\n/)) {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const h = HEADING.exec(line);
    if (h) {
      if (/^wins\b/i.test(h[2])) level = h[1].length;
      else if (level && h[1].length <= level) level = 0;
      continue;
    }
    if (!level || TASK.test(line)) continue;
    const b = /^\s*[-*+]\s+(.*)$/.exec(line);
    const text = b ? oneLine(b[1]) : '';
    if (text) out.push(text);
  }
  return out;
}

/* ---------- the packet ---------- */

const taskRow = t => ({ id: String(t.id || ''), title: oneLine(t.title).slice(0, 300) || 'Untitled task', due: isDay(t.due) ? t.due : '', nudgeOn: isDay(t.nudgeOn) ? t.nudgeOn : '', via: typeof t.via === 'string' ? t.via : '' });

/** Docket: open tasks for the person, tasks waiting on them, and nudges due, from Docket's summary. Docket counts
    tasks on a group they are in too; those rows carry `via` (the group's id). */
export function docketSection(personId, today, summaryEnv = null) {
  if (!personId) return { state: 'unlinked' };
  const card = docketPeopleCard(summaryEnv);
  if (!card) return { state: readable(summaryEnv, SOURCES.docketSummary).state === 'unreadable' ? 'unreadable' : 'missing' };
  const p = card.find(x => x.id === personId);
  const rows = list => (Array.isArray(list) ? list : []).filter(t => t && t.id).map(taskRow);
  const open = p ? rows(p.open) : [], waiting = p ? rows(p.waiting) : [];
  return { state: 'ok', open, waiting, nudges: waiting.filter(t => isDay(t.nudgeOn) && t.nudgeOn <= today) };
}

/** Slate: work delegated to the person (Slate's summary, its `delegated` people card). Missing when Slate is not
    here or has delegated nothing yet. */
export function slateSection(personId, summaryEnv = null) {
  if (!personId) return { state: 'unlinked' };
  const r = readable(summaryEnv, SOURCES.slateSummary);
  if (r.state !== 'ok') return { state: r.state };
  const card = r.env.items.find(c => c && c.id === 'delegated' && c.kind === 'people' && Array.isArray(c.rows));
  const p = card ? card.rows.find(x => x && x.id === personId) : null;
  const items = p && Array.isArray(p.open) ? p.open.filter(t => t && t.id && t.title).slice(0, 20).map(t => ({ id: String(t.id), title: oneLine(t.title).slice(0, 300) })) : [];
  return { state: 'ok', items };
}

/** Receipts: entries about the person from `since` to `today`, grouped by kind. */
export function receiptsSection(entriesEnv, receiptsId, since, today) {
  if (!receiptsId) return { state: 'unlinked' };
  const r = readable(entriesEnv, SOURCES.receiptsEntries);
  if (r.state !== 'ok') return { state: r.state };
  const groups = Object.fromEntries(KINDS.map(k => [k, []]));
  const list = r.env.items.filter(e => e && e.about === receiptsId && isDay(e.date) && e.date >= since && e.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const e of list) {
    const kind = KINDS.includes(e.kind) ? e.kind : 'note';
    groups[kind].push({ id: String(e.id || ''), date: e.date, text: oneLine(e.text).slice(0, 1000) });
  }
  return { state: 'ok', groups, total: list.length };
}

/** Last 1:1: the open follow-ups (unchecked task lines) of the previous note. */
export function lastSection(last, text) {
  if (!last) return { state: 'none' };
  if (typeof text !== 'string') return { state: 'unreadable', day: last.day };
  return { state: 'ok', day: last.day, open: parseFollowUps(text).open };
}

/**
 * Everything for one person's prep, with no AI.
 * person: a 1:1s person with `relation` (withDirectory). src: {docketSummary, receiptsEntries} envelopes (or null).
 * lastText: the previous note's Markdown (or null when it could not be read).
 */
export function buildPacket({ person, today, now, notes, lastText, src }) {
  const s = sinceDate({ notes, today, cadenceDays: person.cadenceDays });
  // Receipts are about reports (their id) and your manager ('up').
  const about = person.relation === 'report' ? person.personId : person.relation === 'manager' ? 'up' : '';
  return {
    personId: person.id,
    today,
    since: s.since,
    sinceFrom: s.from,
    docket: docketSection(person.personId, today, src.docketSummary),
    slate: slateSection(person.personId, src.slateSummary),
    receipts: receiptsSection(src.receiptsEntries, about, s.since, today),
    last: lastSection(s.last, lastText)
  };
}

const plural = (n, w, ws = w + 's') => `${n} ${n === 1 ? w : ws}`;

/** One line per source, for the top of a new note. */
export function packetSummary(p) {
  const out = [];
  if (p.docket.state === 'ok') out.push(`Docket: ${plural(p.docket.open.length, 'open task')}, ${p.docket.waiting.length} waiting on them, ${plural(p.docket.nudges.length, 'nudge')} due`);
  if (p.slate && p.slate.state === 'ok' && p.slate.items.length) out.push(`Slate: ${plural(p.slate.items.length, 'item')} delegated to them`);
  if (p.receipts.state === 'ok') {
    const g = p.receipts.groups;
    out.push(`Receipts: ${plural(g.win.length, 'win')}, ${g.feedback.length} feedback, ${g.growth.length} growth, ${plural(g.note.length, 'note')}`);
  }
  if (p.last.state === 'ok') out.push(`Last 1:1 (${p.last.day}): ${plural(p.last.open.length, 'open follow-up')}`);
  return out;
}

/** A new note, from the template: date, packet summary, talking points, follow-ups and free notes. */
export function noteTemplate({ name, day, packet }) {
  const summary = packetSummary(packet);
  const carried = packet.last.state === 'ok' ? packet.last.open : [];
  return [
    `# 1:1 with ${oneLine(name)}, ${day}`,
    '',
    `## Since ${packet.since}`,
    '',
    ...(summary.length ? summary.map(s => `- ${s}`) : ['- Nothing linked yet.']),
    '',
    '## Talking points',
    '',
    '- ',
    '',
    '## Wins',
    '',
    '- ',
    '',
    '## Follow-ups',
    '',
    ...carried.map(t => `- [ ] ${t}`),
    '- [ ] ',
    '',
    '## Notes',
    '',
    ''
  ].join('\n');
}

/**
 * The packet as Markdown for the optional draft step. The person's name is left out. Receipts concerns are
 * left out unless `includeConcerns` is set for this run. Capped at MAX_PACKET characters.
 */
export function packetMarkdown(p, { includeConcerns = false } = {}) {
  const lines = ['# 1:1 packet', '', `- Date of the 1:1: ${p.today}`, `- Period: ${p.since} to ${p.today}`, ''];
  const list = (title, rows, fmt) => {
    lines.push(`### ${title}`, '');
    if (!rows.length) lines.push('- None', '');
    else lines.push(...rows.map(r => `- ${fmt(r)}`), '');
  };
  lines.push('## Docket tasks', '');
  if (p.docket.state === 'ok') {
    list('Open, tagged with them', p.docket.open, t => t.title + (t.due ? ` (due ${t.due})` : ''));
    list('Waiting on them', p.docket.waiting, t => t.title + (t.nudgeOn ? ` (nudge on ${t.nudgeOn})` : ''));
    list('Nudges due', p.docket.nudges, t => t.title);
  } else lines.push('- Not available.', '');
  if (p.slate && p.slate.state === 'ok' && p.slate.items.length) { lines.push('## Delegated in Slate', ''); list('With them now', p.slate.items, t => t.title); }
  lines.push('## Receipts', '');
  if (p.receipts.state === 'ok') {
    for (const k of KINDS) {
      if (k === 'concern' && !includeConcerns) continue;
      list(KIND_LABELS[k], p.receipts.groups[k], e => `${e.date}: ${e.text}`);
    }
  } else lines.push('- Not available.', '');
  lines.push('## Last 1:1', '');
  if (p.last.state === 'ok') list(`Open follow-ups from ${p.last.day}`, p.last.open, t => t);
  else lines.push('- No earlier 1:1 note.', '');
  let text = lines.join('\n');
  if (text.length > MAX_PACKET) text = text.slice(0, MAX_PACKET - 40).replace(/\n[^\n]*$/, '') + '\n\n(The rest was cut to fit.)\n';
  return text;
}

/* ---------- after the meeting ---------- */

/** Docket quick-add lines for follow-ups, with the person's @handle so Docket files them under them. */
export function quickAddLines(followUps, handle) {
  const tag = /^[a-z0-9][a-z0-9._-]{0,39}$/.test(String(handle || '')) ? ` @${handle}` : '';
  return followUps.map(oneLine).filter(Boolean).map(t => `Follow up: ${t}${tag}`);
}

/** A short stable hash, so logging the same win again reuses its id. */
export function hashText(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

/**
 * Receipts for the ticked wins: entries of receipts.entries, about the person's directory id (Rapport keeps
 * them only for a report). The id is stable per person, day and text, so logging the same win twice adds it
 * once. [] when the person is not linked to the directory.
 */
export function winEntries({ person, day, wins, nowIso }) {
  const about = person.personId;
  if (!about) return [];
  const seg = noteFolder(person.id).split('/').pop();
  return wins.map(oneLine).filter(Boolean).map(text => ({
    id: `o-${seg}-${day}-${hashText(text)}`.slice(0, 120),
    updatedAt: 0,
    createdAt: nowIso,
    date: day,
    about,
    kind: 'win',
    text: text.slice(0, 2000),
    sections: [],
    impact: 0,
    evidence: 'From a 1:1',
    metric: '',
    people: '',
    star: false
  }));
}

/* ---------- the copy from the old 1:1s app ---------- */

/** The old app's envelope as Rapport's: same items, deleted and meta, new schema, rev 0 (a create).
    null when the old one is missing or not a version this code knows. */
export function legacyEnvelope(env, name) {
  if (!env || env.schema !== `${LEGACY.app}.${name}` || env.version !== VERSION || !Array.isArray(env.items)) return null;
  return {
    schema: `${APP}.oneonones/${name}`, version: VERSION, rev: 0,
    items: structuredClone(env.items), deleted: structuredClone(env.deleted || {}),
    ...(env.meta ? { meta: structuredClone(env.meta) } : {})
  };
}

/** Where an old note goes: notes/<person>/<day>.md becomes oneonones/notes/<person>/<day>.md. '' if not a note. */
export function legacyNotePath(path) {
  const m = /^notes\/([a-z0-9][a-z0-9-]{0,39})\/(\d{4}-\d{2}-\d{2})\.md$/.exec(String(path || ''));
  return m ? `${NOTES}/${m[1]}/${m[2]}.md` : '';
}

/** Old notes are copied on every load for this long after the first copy, so a note written in the old app
    while both were around still arrives. After that a note removed by hand stays removed. */
export const LEGACY_FILES_DAYS = 30;
