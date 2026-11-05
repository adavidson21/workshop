/* Notes: action items to Docket and wins to Rapport (Workshop docs/handoffs.md).

   In a note, `- [ ] ...` lines are action items and lines with #win are wins. The side panel lists them with a
   button each. Clicking sends one:
     - an action item becomes a Docket task. The click is the acceptance (handoffs.md, rule 4), so it is an
       accepted offer, payload.kind 'task', and Docket adds it with no second click.
     - a win becomes an ordinary offer to Rapport (app id `receipts`), payload.kind 'win'. You accept it in
       Rapport, where you pick who it is about.
   Offers go in Notes' own `handoffs` collection (notes.handoffs v1); Notes never writes another app's data.
   The same line sent again keeps its id, so a receiver never sees it twice. Ticking the item in the note does
   not close the task: after you send it, Docket owns it.

   Pure: no DOM and no SDK. main.js reads and writes the collection. */
import { frontmatter } from './markdown.js';

export const VERSION = 1;
export const SCHEMA = 'notes.handoffs';
export const KEEP = 300;
const ITEM = /^\s{0,8}[-*+]\s+\[( |x|X)\]\s+(.+?)\s*$/;
const WIN = /(^|[\s(])#win(?![A-Za-z0-9_/-])/i;
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

/** Open and done action items: [{line, text, done}]. */
export function actionItems(text) {
  const out = [];
  for (const { line, text: l } of proseLines(text)) {
    const m = ITEM.exec(l);
    if (m && m[2].trim()) out.push({ line, text: m[2].trim(), done: m[1] !== ' ' });
  }
  return out;
}

/** Lines tagged #win, with the list marker, checkbox and tag taken out: [{line, text}]. */
export function wins(text) {
  const out = [];
  for (const { line, text: l } of proseLines(text)) {
    if (!WIN.test(l)) continue;
    const t = l.replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '').replace(/(^|\s)#win(?![A-Za-z0-9_/-])/gi, ' ').replace(/\s+/g, ' ').trim();
    if (t) out.push({ line, text: t });
  }
  return out;
}

/* A short stable hash (FNV-1a, 32-bit) as base 36. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** The offer id for a line of a note: the same note, kind and text always give the same id. */
export const offerId = (kind, path, text) => `n-${kind}-${hash(`${path}\n${text.trim().toLowerCase()}`)}`;

/**
 * The handoff item for one action item or win. kind: 'task' or 'win'. note: {path, title}. day: YYYY-MM-DD.
 */
export function offerFor(kind, note, text, { day, now = new Date() }) {
  const t = String(text).trim().slice(0, 2000);
  const from = `From the note "${note.title || note.path}" (${note.path}) in Notes.`;
  const base = { id: offerId(kind, note.path, t), to: kind === 'task' ? 'prioritizer' : 'receipts', date: day, createdAt: now.toISOString(), text: t, source: { app: 'notes', id: note.path } };
  if (kind === 'task') return { ...base, accepted: true, payload: { kind: 'task', title: t.slice(0, 300), notes: from } };
  return { ...base, payload: { kind: 'win', note: from } };
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
