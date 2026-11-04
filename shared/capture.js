/* Workshop: quick capture rules (docs/hub.md, docs/handoffs.md). Pure functions with no DOM, so Node tests can
   import them (shared/test/capture.test.mjs). Home's quick capture uses them as they are; the Dispatch hub uses
   toHandoff for the proposals Tandem returns.

   parseCapture turns one line into one proposal: what it is (a Docket task or waiting on, a receipt, a note, a
   question for the hub, or a place to go), the app it goes to, and a handoff payload in the shape that app
   documents (docs/handoffs.md, Receivers). No AI: prefixes, dates and names from the people directory.

     t <text>   Docket task (also the default with no prefix)
     w <text>   Docket task, waiting on someone ("waiting on ..." works too)
     r <text>   Receipts win ("r growth: ..." and so on for the other kinds)
     n <text>   note ("note: ..." works too)
     ? <text>   a question for the Dispatch hub (a line that ends in "?" too)
     > <app>    go to an app

   Dates (tasks): today, tomorrow, a weekday, M/D, YYYY-MM-DD, optionally after "by", "on" or "due".
   "!" on its own, or "!!", marks a task urgent. */

export const TARGETS = { task: 'prioritizer', waiting: 'prioritizer', receipt: 'receipts', note: 'notes' };
export const TARGET_NAMES = { prioritizer: 'Docket', receipts: 'Receipts', notes: 'Notes' };
export const RECEIPT_KINDS = ['win', 'feedback', 'growth', 'concern', 'note'];
export const KINDS = ['task', 'waiting', 'receipt', 'note'];
const MAX_TEXT = 2000;

/* Places "> name" can go: words people use to the app id. */
export const PLACES = {
  home: 'home', docket: 'prioritizer', tasks: 'prioritizer', board: 'prioritizer', dispatch: 'agents', agents: 'agents',
  hub: 'agents', receipts: 'receipts', queue: 'queue', notes: 'notes', settings: 'settings', '1:1s': 'oneonones',
  '1:1': 'oneonones', oneonones: 'oneonones', 'one-on-ones': 'oneonones', runway: 'runway', roadmap: 'runway'
};

const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fromYmd = s => new Date(s + 'T00:00:00Z');
const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(fromYmd(s)) === s;
const addDays = (s, n) => { const d = fromYmd(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

/* A date word to YYYY-MM-DD, or null. today: YYYY-MM-DD. A weekday is the next one after today. M/D is this year,
   or next year when that day has passed. */
export function parseDay(word, today) {
  const w = String(word || '').toLowerCase().replace(/[.,;]$/, '');
  if (!w || !isYmd(today)) return null;
  if (w === 'today' || w === 'tod') return today;
  if (w === 'tomorrow' || w === 'tmr' || w === 'tom') return addDays(today, 1);
  if (w.length >= 3) {
    const i = DOW.findIndex(d => d.startsWith(w) && (w.length >= 3));
    if (i >= 0 && /^[a-z]+$/.test(w)) {
      const diff = ((i - fromYmd(today).getUTCDay()) + 7) % 7 || 7;
      return addDays(today, diff);
    }
  }
  if (isYmd(w)) return w;
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(w);
  if (m) {
    const y = +today.slice(0, 4);
    let s = `${y}-${pad(+m[1])}-${pad(+m[2])}`;
    if (!isYmd(s)) return null;
    if (s < today) s = `${y + 1}-${pad(+m[1])}-${pad(+m[2])}`;
    return isYmd(s) ? s : null;
  }
  return null;
}

/* People from the directory (docs/people.md) that the text names, by full name or first name, without case.
   people: [{id, name, relation, archived}]. A first name shared by two people matches neither. */
export function findPeople(text, people = []) {
  const live = (people || []).filter(p => p && p.id && typeof p.name === 'string' && p.name.trim() && !p.archived && p.relation !== 'self');
  const low = ' ' + String(text || '').toLowerCase().replace(/[^\p{L}\p{N}' -]+/gu, ' ') + ' ';
  const firsts = new Map();
  for (const p of live) { const f = p.name.trim().split(/\s+/)[0].toLowerCase(); firsts.set(f, (firsts.get(f) || 0) + 1); }
  const out = [];
  for (const p of live) {
    const full = p.name.trim().toLowerCase(), first = full.split(/\s+/)[0];
    if (low.includes(' ' + full + ' ') || low.includes(' ' + full + "'s ") || (firsts.get(first) === 1 && (low.includes(' ' + first + ' ') || low.includes(' ' + first + "'s ")))) out.push(p);
  }
  return out;
}

const FILLER = /^(?:(?:please\s+)?(?:don'?t|do not)\s+forget\s+(?:about\s+|to\s+)?|remember\s+(?:to\s+)?|remind\s+me\s+(?:to\s+|about\s+)?|todo:?\s+|to do:?\s+)/i;
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const tidy = s => s.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();

/* Capitalize names the directory knows, so "for john" reads "for John" in the title. */
function nameCase(s, found) {
  let out = s;
  for (const p of found) {
    for (const part of [p.name.trim(), p.name.trim().split(/\s+/)[0]]) {
      const re = new RegExp(`(^|[^\\p{L}])(${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=[^\\p{L}]|$)`, 'giu');
      out = out.replace(re, (m, a) => a + part);
    }
  }
  return out;
}

/* One line to one proposal, or null for an empty line.
   ctx: {today: 'YYYY-MM-DD', people: directory items, lists: Docket list names}.
   Returns {kind, to, text, title, payload} for a capture, {kind: 'ask', text} or {kind: 'go', app, text}. */
export function parseCapture(line, ctx = {}) {
  let s = String(line || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!s) return null;
  const today = isYmd(ctx.today || '') ? ctx.today : ymd(new Date());
  let kind = null, rkind = 'win';

  let m;
  if ((m = /^>\s*(.+)$/.exec(s))) {
    const word = m[1].trim().toLowerCase();
    const app = PLACES[word] || PLACES[word.replace(/^the\s+/, '')] || null;
    return app ? { kind: 'go', app, text: s } : { kind: 'ask', text: s.replace(/^>\s*/, '') };
  }
  if ((m = /^\?\s*(.*)$/.exec(s))) return { kind: 'ask', text: m[1].trim() || s };
  if ((m = /^(t|task)(?::\s*|\s+)(.+)$/i.exec(s))) { kind = 'task'; s = m[2]; }
  else if (/^waiting\s+(?:on|for)\s+/i.test(s)) kind = 'waiting';
  else if ((m = /^(w|waiting)(?::\s*|\s+)(.+)$/i.exec(s))) { kind = 'waiting'; s = m[2]; }
  else if ((m = /^(n|note)(?::\s*|\s+)(.+)$/i.exec(s))) { kind = 'note'; s = m[2]; }
  else if ((m = /^(r|receipt|win|feedback|growth|concern)(?::\s*|\s+)(.+)$/i.exec(s))) {
    kind = 'receipt';
    const head = m[1].toLowerCase();
    if (RECEIPT_KINDS.includes(head)) rkind = head;
    s = m[2];
    const sub = /^(win|feedback|growth|concern|note)(?::\s*|\s+)(.+)$/i.exec(s);
    if (sub && head === 'r' || sub && head === 'receipt') { rkind = sub[1].toLowerCase(); s = sub[2]; }
  }
  if (!kind && /\?$/.test(s)) return { kind: 'ask', text: s };
  if (!kind) kind = /^waiting\s+(?:on|for)\s+/i.test(s) ? 'waiting' : 'task';
  if (!s.trim()) return null;

  const found = findPeople(s, ctx.people);
  if (kind === 'note') {
    const body = s.trim();
    const title = cap(tidy(body.split(/[.!?\n]/)[0] || body)).slice(0, 120);
    return { kind, to: TARGETS[kind], text: body, title, payload: { kind: 'note', title } };
  }
  if (kind === 'receipt') {
    const body = cap(tidy(nameCase(s, found)));
    const report = found.find(p => p.relation === 'report');
    const payload = { kind: rkind, impact: 0 };
    if (report) payload.about = report.id;
    return { kind, to: TARGETS[kind], text: body, title: body, payload };
  }

  // Tasks: dates, urgency and the list come out of the words; what is left is the title.
  const words = s.split(' ');
  let due = null, urgent = false, list = null;
  const keep = [];
  const lists = (ctx.lists || []).filter(x => typeof x === 'string' && x.trim());
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '!' || w === '!!') { urgent = true; continue; }
    if (/^#\S+/.test(w)) {
      const want = w.slice(1).toLowerCase().replace(/[-_]/g, ' ');
      const hit = lists.find(l => l.toLowerCase().startsWith(want) || l.toLowerCase().replace(/\s+/g, '').startsWith(want.replace(/\s+/g, '')));
      if (hit) { list = hit; continue; }
    }
    const d = due ? null : parseDay(w, today);
    if (d) {
      due = d;
      if (keep.length && /^(by|on|due|before)$/i.test(keep[keep.length - 1])) keep.pop();
      continue;
    }
    keep.push(w);
  }
  let title = keep.join(' ');
  if (/!$/.test(title) && !/!!$/.test(title)) { urgent = true; title = title.replace(/!$/, ''); }
  title = title.replace(FILLER, '');
  if (kind === 'waiting') title = title.replace(/^waiting\s+(?:on|for)\s+/i, 'Waiting on ');
  title = cap(tidy(nameCase(title, found))).slice(0, 300);
  if (!title) return null;
  const payload = { kind: 'task', title };
  if (found.length) payload.people = found.slice(0, 10).map(p => p.name.trim());
  if (kind === 'waiting') payload.waiting = true;
  if (due) payload.due = due;
  if (urgent) payload.urgent = true;
  if (list) payload.list = list;
  return { kind, to: TARGETS[kind], text: title, title, payload };
}

/* Several pasted lines to proposals, one per non-empty line. */
export function parseLines(text, ctx) {
  return String(text || '').split(/\r?\n/).map(l => parseCapture(l, ctx)).filter(Boolean);
}

/* A proposal that can be sent: a capture with a known target. */
export const isCapture = p => !!(p && TARGETS[p.kind] && p.to === TARGETS[p.kind]);

/* Change what a proposal is (Tab in the review list), keeping the words. */
export function retarget(p, kind, ctx = {}) {
  if (!p || !KINDS.includes(kind)) return p;
  const prefix = { task: 't ', waiting: 'w ', receipt: 'r ', note: 'n ' }[kind];
  return parseCapture(prefix + (p.text || p.title || ''), ctx) || p;
}
export const nextKind = kind => KINDS[(KINDS.indexOf(kind) + 1) % KINDS.length] || 'task';

/* A short random id for a capture. */
export const captureId = (rand = Math.random) => 'c_' + Date.now().toString(36) + rand().toString(36).slice(2, 7);

/* A proposal the person accepted, as an item of <app>.handoffs v1 with accepted: true (docs/handoffs.md, rule 4).
   sender: this app's id. Call only from the person's own Enter or click on that proposal. */
export function toHandoff(p, { sender, id = captureId(), now = new Date() } = {}) {
  if (!p || !p.to || !p.payload || !sender) return null;
  const text = String(p.text || p.title || '').trim().slice(0, MAX_TEXT);
  if (!text) return null;
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return {
    id, to: p.to, date: local.toISOString().slice(0, 10), createdAt: now.toISOString(), text,
    payload: { ...p.payload }, source: { app: sender, id }, accepted: true
  };
}

/* One line describing a proposal for the review list: where it goes and what was filled in. */
export function describe(p) {
  if (!p) return '';
  if (p.kind === 'ask') return 'Ask in Dispatch';
  if (p.kind === 'go') return 'Go to ' + p.app;
  const q = p.payload || {};
  const bits = [p.kind === 'waiting' || q.waiting ? 'Docket, waiting on' : p.kind === 'receipt' ? `Receipts, ${q.kind || 'win'}` : TARGET_NAMES[p.to] || p.to];
  if (q.people && q.people.length) bits.push(q.people.join(', '));
  if (q.list) bits.push('#' + q.list);
  if (q.due) bits.push('due ' + q.due);
  if (q.urgent) bits.push('urgent');
  return bits.join(' · ');
}
