/* Workshop: quick capture rules (docs/hub.md, docs/handoffs.md). Pure functions with no DOM, so Node tests can
   import them (shared/test/capture.test.mjs). Home's quick capture uses them as they are; the Dispatch hub uses
   toHandoff for the proposals Tandem returns.

   parseCapture turns one line into one proposal: what it is (a Docket task or waiting on, a receipt, a note, a
   question for the hub, or a place to go), the app it goes to, and a handoff payload in the shape that app
   documents (docs/handoffs.md, Receivers). No AI: prefixes, dates and names from the people directory.

     t <text>   Docket task (also the default with no prefix)
     w <text>   Docket task, waiting on someone ("waiting on ..." works too)
     r <text>   Rapport receipt, a win ("r growth: ..." and so on for the other kinds)
     n <text>   note ("note: ..." works too)
     p <text>   roadmap idea for Runway: a feature, bug or any thought for a project ("idea: ..." works too).
                "p <roadmap>: <text>" with a roadmap's name goes to that roadmap; otherwise to Runway's Pending page
     ? <text>   a question for the Dispatch hub (a line that ends in "?" too)
     > <app>    go to an app ("> 1:1s" opens Rapport's 1:1s tab)

   Dates (tasks): today, tomorrow, a weekday, M/D, YYYY-MM-DD, optionally after "by", "on" or "due".
   "!" on its own, or "!!", marks a task urgent. */

/* Where each capture kind goes, app names, and places for "> <name>". These are the built-in defaults; useApps()
   replaces them in place from the manifests on this site (ws.apps.list(); docs/app-manifest.md capture and
   aliases, docs/hub.md "Which app takes a capture"), so every function here follows the apps that are there. */
export const TARGETS = { task: 'prioritizer', waiting: 'prioritizer', receipt: 'receipts', note: 'notes', idea: 'runway' };
export const TARGET_NAMES = { prioritizer: 'Docket', receipts: 'Rapport', notes: 'Notes', runway: 'Runway' };
export const RECEIPT_KINDS = ['win', 'feedback', 'growth', 'concern', 'note'];
export const KINDS = ['task', 'waiting', 'receipt', 'note', 'idea'];
const MAX_TEXT = 2000;

/* Places "> name" can go: words people use to the app id. */
export const PLACES = {
  home: 'home', docket: 'prioritizer', tasks: 'prioritizer', board: 'prioritizer', dispatch: 'agents', agents: 'agents',
  hub: 'agents', receipts: 'receipts', rapport: 'receipts', notes: 'notes', settings: 'settings', '1:1s': 'receipts',
  '1:1': 'receipts', oneonones: 'receipts', 'one-on-ones': 'receipts', goals: 'receipts', okrs: 'receipts', runway: 'runway', roadmap: 'runway'
};
/* Places that open a part of their app: the path after #/<app>/. 1:1s are part of Rapport since 2.0.0, Goals since 2.1.0. */
export const PLACE_PATHS = { '1:1s': '1on1s', '1:1': '1on1s', oneonones: '1on1s', 'one-on-ones': '1on1s', goals: 'goals', okrs: 'goals' };

const DEFAULTS = {
  targets: { ...TARGETS }, names: { ...TARGET_NAMES }, places: { ...PLACES }, paths: { ...PLACE_PATHS }
};
const replace = (obj, next) => { for (const k of Object.keys(obj)) delete obj[k]; Object.assign(obj, next); };

/* Routing from manifests: apps is ws.apps.list() ([{id, name, order, capture, aliases}], sorted by order).
   Built-in defaults count only for apps that are there, so a removed app drops out with no edit here; what a
   manifest declares is added on top, so a new app needs no edit either. A kind goes to the first app by order
   that lists it in `capture`. Returns {targets, names, places, paths}; null or [] gives the defaults. */
export function routingFrom(apps) {
  if (!Array.isArray(apps) || !apps.length) return { targets: { ...DEFAULTS.targets }, names: { ...DEFAULTS.names }, places: { ...DEFAULTS.places }, paths: { ...DEFAULTS.paths } };
  const ids = new Set(apps.map(a => a && a.id).filter(Boolean));
  const keep = obj => Object.fromEntries(Object.entries(obj).filter(([, id]) => ids.has(id)));
  const targets = {}, names = {}, places = keep(DEFAULTS.places), paths = {};
  for (const [w, p] of Object.entries(DEFAULTS.paths)) if (places[w]) paths[w] = p;
  for (const a of apps) {
    if (!a || !a.id) continue;
    names[a.id] = a.name || a.id;
    for (const k of Array.isArray(a.capture) ? a.capture : []) if (KINDS.includes(k) && !targets[k]) targets[k] = a.id;
    const add = (word, path) => {
      const w = String(word || '').trim().toLowerCase();
      if (!w || (places[w] && places[w] !== a.id)) return;
      places[w] = a.id;
      if (path) paths[w] = path; else delete paths[w];
    };
    add(a.id); add(a.name);
    for (const al of Array.isArray(a.aliases) ? a.aliases : []) typeof al === 'string' ? add(al) : al && add(al.name, al.path);
  }
  for (const [k, id] of Object.entries(DEFAULTS.targets)) if (!targets[k] && ids.has(id)) targets[k] = id;
  return { targets, names: { ...keep(DEFAULTS.names), ...names }, places, paths };
}

/* Use the apps on this site for every function in this module. useApps(null) goes back to the defaults. */
export function useApps(apps) {
  const r = routingFrom(apps);
  replace(TARGETS, r.targets); replace(TARGET_NAMES, r.names); replace(PLACES, r.places); replace(PLACE_PATHS, r.paths);
  return r;
}

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

/* The roadmap a "p" capture names before a colon: {map, rest} or null. maps: [{id, title}] from Runway's index.
   The name matches a title without case, or the start of exactly one title. */
export function findMap(text, maps = []) {
  const m = /^([^:\n]{1,120}):\s*(\S[\s\S]*)$/.exec(String(text || ''));
  if (!m) return null;
  const want = m[1].trim().toLowerCase();
  const live = (maps || []).filter(x => x && typeof x.id === 'string' && typeof x.title === 'string' && x.title.trim());
  const exact = live.filter(x => x.title.trim().toLowerCase() === want);
  const hits = exact.length ? exact : live.filter(x => x.title.trim().toLowerCase().startsWith(want));
  return want && hits.length === 1 ? { map: hits[0], rest: m[2].trim() } : null;
}

/* One line to one proposal, or null for an empty line.
   ctx: {today: 'YYYY-MM-DD', people: directory items, lists: Docket list names, maps: Runway roadmaps [{id, title}]}.
   Returns {kind, to, text, title, payload} for a capture, {kind: 'ask', text} or {kind: 'go', app, text}. */
export function parseCapture(line, ctx = {}) {
  let s = String(line || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!s) return null;
  const today = isYmd(ctx.today || '') ? ctx.today : ymd(new Date());
  let kind = null, rkind = 'win';

  let m;
  if ((m = /^>\s*(.+)$/.exec(s))) {
    const word = m[1].trim().toLowerCase();
    const key = PLACES[word] ? word : word.replace(/^the\s+/, '');
    const app = PLACES[key] || null;
    return app ? { kind: 'go', app, ...(PLACE_PATHS[key] ? { path: PLACE_PATHS[key] } : {}), text: s } : { kind: 'ask', text: s.replace(/^>\s*/, '') };
  }
  if ((m = /^\?\s*(.*)$/.exec(s))) return { kind: 'ask', text: m[1].trim() || s };
  if ((m = /^(t|task)(?::\s*|\s+)(.+)$/i.exec(s))) { kind = 'task'; s = m[2]; }
  else if (/^waiting\s+(?:on|for)\s+/i.test(s)) kind = 'waiting';
  else if ((m = /^(w|waiting)(?::\s*|\s+)(.+)$/i.exec(s))) { kind = 'waiting'; s = m[2]; }
  else if ((m = /^(n|note)(?::\s*|\s+)(.+)$/i.exec(s))) { kind = 'note'; s = m[2]; }
  else if ((m = /^(p|idea)(?::\s*|\s+)(.+)$/i.exec(s))) { kind = 'idea'; s = m[2]; }
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
  // No app here takes this kind: its prefix means nothing, so the whole line is a task (or a question when no
  // app takes tasks either).
  if (!TARGETS[kind]) {
    if (!TARGETS.task) return { kind: 'ask', text: String(line || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) };
    kind = 'task'; s = String(line || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  }
  if (!s.trim()) return null;

  if (kind === 'idea') {
    const named = findMap(s.trim(), ctx.maps);
    const body = cap((named ? named.rest : s).trim());
    if (!body) return null;
    const payload = { kind: 'idea' };
    if (named) { payload.map = named.map.id; payload.mapTitle = named.map.title.trim().slice(0, 120); }
    return { kind, to: TARGETS[kind], text: body, title: body.split('\n')[0].slice(0, 200), payload };
  }
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
  const prefix = { task: 't ', waiting: 'w ', receipt: 'r ', note: 'n ', idea: 'p ' }[kind];
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
  if (p.kind === 'go') return 'Go to ' + (TARGET_NAMES[p.app] || p.app);
  const q = p.payload || {};
  if (p.kind === 'idea') return q.map ? `Runway · ${q.mapTitle || 'roadmap'}, unscheduled` : 'Runway · Pending assignment';
  const bits = [p.kind === 'waiting' || q.waiting ? 'Docket, waiting on' : p.kind === 'receipt' ? `Rapport, ${q.kind || 'win'}` : TARGET_NAMES[p.to] || p.to];
  if (q.people && q.people.length) bits.push(q.people.join(', '));
  if (q.list) bits.push('#' + q.list);
  if (q.due) bits.push('due ' + q.due);
  if (q.urgent) bits.push('urgent');
  return bits.join(' · ');
}
