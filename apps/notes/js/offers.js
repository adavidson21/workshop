/* Notes: action items to Docket and wins to Rapport (Workshop docs/handoffs.md).

   In a note, `- [ ] ...` lines are action items, and lines tagged #win, #feedback, #growth or #concern are for
   Rapport. `@handle`s on a line name people from Workshop's People directory (plan 2). The side panel lists them
   with a button each. Clicking sends:
     - an action item as a Docket task. The click is the acceptance (handoffs.md, rule 4), so it is an accepted
       offer, payload.kind 'task', and Docket adds it with no second click. The line's people go in payload.who.
     - a tagged line as an ordinary offer to Rapport (app id `receipts`), payload.kind the tag's kind. One offer
       per direct report named, with payload.about their id, so it lands on their page. Rapport only files
       receipts under you or your reports, so a line naming no report goes as your own.
   Offers go in Notes' own `handoffs` collection (notes.handoffs v1); Notes never writes another app's data.
   The same line sent again keeps its id, so a receiver never sees it twice. Ticking the item in the note does
   not close the task: after you send it, Docket owns it.

   Pure: no DOM and no SDK. main.js reads and writes the collection. */
import { frontmatter } from './markdown.js';

export const VERSION = 1;
export const SCHEMA = 'notes.handoffs';
export const KEEP = 300;
const ITEM = /^\s{0,8}[-*+]\s+\[( |x|X)\]\s+(.+?)\s*$/;
export const RAPPORT_KINDS = ['win', 'feedback', 'growth', 'concern'];
const TAG = /(^|[\s(])#(win|feedback|growth|concern)(?![A-Za-z0-9_/-])/i;
const TAGS = /(^|\s)#(win|feedback|growth|concern)(?![A-Za-z0-9_/-])/gi;
const HANDLE = /(^|[\s(])@([a-z0-9][a-z0-9._-]{0,39})(?![a-z0-9._-])/gi;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Lines outside frontmatter and fenced code: [{line, text}] with 0-based line numbers in the whole note. */
function proseLines(text) {
  const { body, offset } = frontmatter(String(text || ''));
  const out = [];
  let fence = null;
  body.split('\n').forEach((l, k) => {
    const f = FENCE.exec(l);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return; }
    if (!fence) out.push({ line: k + offset, text: l });
  });
  return out;
}

/* An item that is only a link to a Docket task is already Docket's: never offered back to it. */
const DOCKET_ONLY = /^\[[^\]]*\]\(\s*ws:prioritizer\/[^)\s]*\s*\)$/;

/** Open and done action items: [{line, text, done}]. */
export function actionItems(text) {
  const out = [];
  for (const { line, text: l } of proseLines(text)) {
    const m = ITEM.exec(l);
    if (m && m[2].trim() && !DOCKET_ONLY.test(m[2].trim())) out.push({ line, text: m[2].trim(), done: m[1] !== ' ' });
  }
  return out;
}

/** The @handles on a line, lower case, each once, in order. */
export function handlesIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(HANDLE)) { const h = m[2].toLowerCase().replace(/[._-]+$/, ''); if (h && !out.includes(h)) out.push(h); }
  return out;
}

/** Lines for Rapport: [{line, kind, text, handles}], text with the list marker, checkbox and tags taken out. */
export function forRapport(text) {
  const out = [];
  for (const { line, text: l } of proseLines(text)) {
    const m = TAG.exec(l);
    if (!m) continue;
    const t = l.replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '').replace(TAGS, ' ').replace(/\s+/g, ' ').trim();
    if (t) out.push({ line, kind: m[2].toLowerCase(), text: t, handles: handlesIn(t) });
  }
  return out;
}
/** Lines tagged #win (forRapport's wins). */
export const wins = (text) => forRapport(text).filter(r => r.kind === 'win').map(({ line, text: t }) => ({ line, text: t }));

/**
 * Who a line is about, from the People directory (shared/people.js directory()): {people, reports, others}.
 * people: every active person or group a handle names. reports: the direct reports among them (Rapport files a
 * receipt only under you or a report). others: the people who aren't reports, for the panel's "isn't a report".
 */
export function whoOf(handles, dir) {
  const items = dir && Array.isArray(dir.items) ? dir.items.filter(it => it && !it.archived) : [];
  const people = handles.map(h => items.find(it => it.handle === h)).filter(Boolean);
  const reports = people.filter(p => p.kind === 'person' && p.relation === 'report');
  const others = people.filter(p => p.kind === 'person' && p.relation !== 'report' && p.relation !== 'self');
  return { people, reports, others };
}

/** A line's text with each known @handle replaced by the person's name: what the receiver shows. */
export function readable(text, dir) {
  const items = dir && Array.isArray(dir.items) ? dir.items.filter(it => it && !it.archived) : [];
  return String(text).replace(HANDLE, (m, pre, h) => {
    const it = items.find(x => x.handle === h.toLowerCase());
    return it ? `${pre}${it.name}` : m;
  });
}

/* A short stable hash (FNV-1a, 32-bit) as base 36. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** The offer id for a line of a note: the same note, kind, text (and person) always give the same id. */
export const offerId = (kind, path, text, about = '') => `n-${kind}-${hash(`${path}\n${text.trim().toLowerCase()}${about ? `\n${about}` : ''}`)}`;

/**
 * The handoff item for one action item or win. kind: 'task' or 'win'. note: {path, title}. day: YYYY-MM-DD.
 */
export function offerFor(kind, note, text, { day, now = new Date(), dir = null, about = '', shown = '' } = {}) {
  const t = String(text).trim().slice(0, 2000);
  const from = `From the note "${note.title || note.path}" (${note.path}) in Folio.`;
  const body = (shown || readable(t, dir)).trim().slice(0, 2000);
  if (kind === 'task') {
    const who = whoOf(handlesIn(t), dir).people.slice(0, 10).map(p => p.id);
    return { id: offerId(kind, note.path, t), to: 'prioritizer', date: day, createdAt: now.toISOString(), text: body, source: { app: 'notes', id: note.path },
      accepted: true, payload: { kind: 'task', title: body.slice(0, 300), notes: from, ...(who.length ? { who } : {}) } };
  }
  const k = RAPPORT_KINDS.includes(kind) ? kind : 'win';
  return { id: offerId(k, note.path, t, about), to: 'receipts', date: day, createdAt: now.toISOString(), text: body, source: { app: 'notes', id: note.path },
    payload: { kind: k, note: from, ...(about ? { about } : {}) } };
}

/**
 * The Rapport offers for one line (forRapport): one per report it names, each with payload.about, or one as your
 * own when it names none. [{offer, who}] where who is the report's name or 'You'.
 */
export function rapportOffers(note, item, { day, now = new Date(), dir = null } = {}) {
  const { reports } = whoOf(item.handles, dir);
  const shown = readable(item.text, dir);
  if (!reports.length) return [{ offer: offerFor(item.kind, note, item.text, { day, now, dir, shown }), who: 'You' }];
  return reports.map(p => ({ offer: offerFor(item.kind, note, item.text, { day, now, dir, about: p.id, shown }), who: p.name }));
}

/** An empty notes.handoffs envelope. */
export const emptyOffers = () => ({ schema: SCHEMA, version: VERSION, rev: 0, items: [], deleted: {} });

/** A readable envelope, or null for another schema or version (a newer Notes: send nothing). */
export function readOffers(env) {
  if (!env) return emptyOffers();
  if (env.schema !== SCHEMA || env.version !== VERSION || !Array.isArray(env.items)) return null;
  return env;
}

/** The envelope with `item` added (or left alone when its id is there), newest KEEP kept. Returns a new envelope. */
export function withOffer(env, item) {
  const next = JSON.parse(JSON.stringify(env));
  if (!next.items.some(i => i.id === item.id)) next.items.push(item);
  if (next.items.length > KEEP) next.items = next.items.slice(-KEEP);
  return next;
}

/** Ids already sent, for the panel's "Sent" marks. */
export const sentIds = (env) => new Set(env && Array.isArray(env.items) ? env.items.map(i => i.id) : []);
