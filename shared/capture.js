/* Workshop: quick capture rules (docs/hub.md, docs/handoffs.md). Pure functions with no DOM, so Node tests can
   import them (shared/test/capture.test.mjs). Home's quick capture uses them as they are; the Builds hub uses
   toHandoff for the proposals Tandem returns.

   parseCapture turns one line into one proposal: what it is (a Tasks task or waiting on, a receipt, a note, a
   question for the hub, or a place to go), the app it goes to, and a handoff payload in the shape that app
   documents (docs/handoffs.md, Receivers). No AI: prefixes, dates and names from the people directory.

     t <text>   Tasks task (also the default with no prefix)
     w <text>   Tasks task, waiting on someone ("waiting on ..." works too)
     r <text>   People receipt, a win ("r growth: ..." and so on for the other kinds)
     n <text>   note ("note: ..." works too). "n <folder>: <text>" with one of Notes' folders makes a new note in that
                folder; "n today: <text>" adds it to today's note. Otherwise to Quick Notes (Home) or inbox/ (Builds)
     p <text>   roadmap idea for Roadmaps: a feature, bug or any thought for a project ("idea: ..." works too).
                "p <roadmap>: <text>" with a roadmap's name goes to that roadmap; otherwise to Roadmaps' Pending page
     s <text>   a request for Builds' New ("request: ..." works too). "s #1234 <note>", or a line that starts with
                "#1234", is a request for that ADO work item
     b <text>   build it with Tandem: Builds' drop box, filled in, its kind guessed (build, diagnose a log, or ask),
                started at once when Tandem is connected ("build: ..." works too, "build ..." is a task; a pasted block after "b " is one item)
     ? <text>   a question for the Builds hub (a line that ends in "?" too)
     > <app>    go to an app ("> 1:1s" opens People's 1:1s tab)
     "clean up this document" (or "tidy up my note", "polish this article"): Notes cleans up the open note
                (apps/notes/js/cleanup.js); "... and overwrite it" (or "in place") replaces it instead of a copy

   Dates (tasks): today, tomorrow, a weekday, M/D, YYYY-MM-DD, optionally after "by", "on" or "due".
   "!" on its own, or "!!", marks a task urgent. */

/* Where each capture kind goes, app names, and places for "> <name>". These are the built-in defaults; useApps()
   replaces them in place from the manifests on this site (ws.apps.list(); docs/app-manifest.md capture and
   aliases, docs/hub.md "Which app takes a capture"), so every function here follows the apps that are there. */
export const TARGETS = { task: 'tasks', waiting: 'tasks', receipt: 'people', note: 'notes', idea: 'roadmaps', request: 'builds', build: 'builds' };
export const TARGET_NAMES = { tasks: 'Tasks', people: 'People', notes: 'Notes', roadmaps: 'Roadmaps', builds: 'Builds' };
export const RECEIPT_KINDS = ['win', 'feedback', 'growth', 'concern', 'note'];
export const KINDS = ['task', 'waiting', 'receipt', 'note', 'idea', 'request'];
const MAX_TEXT = 2000;
const MAX_BUILD = 8000; // the drop box's description cap (Builds lanes.js dropStart)

/* Places "> name" can go: words people use to the app id. */
export const PLACES = {
  home: 'home', docket: 'tasks', tasks: 'tasks', board: 'tasks', dispatch: 'builds', agents: 'builds', loom: 'builds',
  hub: 'chat', chat: 'chat', ask: 'chat', receipts: 'people', rapport: 'people', notes: 'notes', settings: 'settings', '1:1s': 'people',
  '1:1': 'people', oneonones: 'people', 'one-on-ones': 'people', goals: 'people', okrs: 'people', roadmaps: 'roadmaps', roadmap: 'roadmaps'
};
/* Places that open a part of their app: the path after #/<app>/. 1:1s are part of People since 2.0.0, Goals since 2.1.0. */
export const PLACE_PATHS = { '1:1s': 'people', '1:1': 'people', oneonones: 'people', 'one-on-ones': 'people', goals: 'team', okrs: 'team' };

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

/* People and groups from the directory (docs/people.md) that the text names: an @handle (people and groups),
   or for people a full name or a first name only one person has, without case. Groups need their @handle, since
   group names are often ordinary words. people: the directory's items (shared/people.js
   `items`). You are left out. */
export function findPeople(text, people = []) {
  const live = (people || []).filter(p => p && p.id && typeof p.name === 'string' && p.name.trim() && !p.archived && p.relation !== 'self');
  const raw = String(text || '');
  const low = ' ' + raw.toLowerCase().replace(/[^\p{L}\p{N}' -]+/gu, ' ') + ' ';
  const firsts = new Map();
  for (const p of live) if (p.kind !== 'group') { const f = p.name.trim().split(/\s+/)[0].toLowerCase(); firsts.set(f, (firsts.get(f) || 0) + 1); }
  const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = [];
  for (const p of live) {
    const full = p.name.trim().toLowerCase(), first = full.split(/\s+/)[0];
    const byHandle = p.handle && new RegExp(`(^|\\s)@${esc(p.handle)}(?=$|[\\s,;:!?)]|\\.(\\s|$))`, 'i').test(raw);
    const byName = p.kind !== 'group' && (low.includes(' ' + full + ' ') || low.includes(' ' + full + "'s "));
    const byFirst = p.kind !== 'group' && firsts.get(first) === 1 && (low.includes(' ' + first + ' ') || low.includes(' ' + first + "'s "));
    if (byHandle || byName || byFirst) out.push(p);
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

/* The Notes folder (or "today") an "n" capture names before a colon: {folder, rest} or null. folders: [{id, title}]
   from Notes' summary. Case and "-" versus a space don't matter; otherwise like findMap. A name no folder has is
   left as part of the text. */
export function findFolder(text, folders = []) {
  const m = /^([^:\n]{1,120}):\s*(\S[\s\S]*)$/.exec(String(text || ''));
  if (!m) return null;
  const norm = (s) => s.trim().toLowerCase().replace(/[-_\s]+/g, ' ').replace(/\/+$/, '');
  const want = norm(m[1]);
  const live = (folders || []).filter(x => x && typeof x.id === 'string' && typeof x.title === 'string' && x.title.trim());
  const exact = live.filter(x => norm(x.title) === want);
  const hits = exact.length ? exact : live.filter(x => norm(x.title).startsWith(want));
  return want && hits.length === 1 ? { folder: hits[0], rest: m[2].trim() } : null;
}

/* The roadmap a "p" capture names before a colon: {map, rest} or null. maps: [{id, title}] from Roadmaps' index.
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
   ctx: {today: 'YYYY-MM-DD', people: the directory's items (people and groups), lists: Tasks list names, maps: Roadmaps roadmaps [{id, title}],
   folders: Notes' folders [{id, title}] (with a row id 'today' for today's note)}.
   Returns {kind, to, text, title, payload} for a capture, {kind: 'ask', text} or {kind: 'go', app, text}. */
/**
 * "clean up this document" and the like: {replace} when the line asks Notes to clean up a note, else null. The
 * original is kept (a cleaned copy is saved next to it) unless the words say to overwrite it.
 */
export function cleanupAsk(line) {
  const s = String(line || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!]+$/, '');
  const m = /^(?:please\s+|can you\s+|could you\s+)?(?:clean\s*up|tidy\s*up|clean|tidy|polish)\s+(?:up\s+)?(?:this|the|my|that)\s+(?:document|doc|note|article|page|draft|write-?up)\b(.*)$/.exec(s);
  if (!m) return null;
  return { replace: /\b(overwrite|in place|replace (?:it|the original|the note|the document)|don'?t keep (?:a copy|the original)|no copy)\b/.test(m[1]) };
}

/** "b <text>" or "build: <text>": {text} to hand to Tandem (whitespace and line breaks kept), else null. */
export function buildAsk(text) {
  // "build" needs its colon: "Build the Q4 deck" is still a task.
  const m = /^\s*(?:b(?::|[ \t]|\r?\n)|build:)[ \t]*\r?\n?([\s\S]+)$/i.exec(String(text || ''));
  const body = m ? m[1].trim().slice(0, MAX_BUILD) : '';
  return body ? { text: body } : null;
}
/** A build as a proposal: open Builds' drop box filled in, started there (Builds' start/go route). */
const buildGo = (text) => ({ kind: 'go', app: TARGETS.build, path: 'start/go/' + encodeURIComponent(text), text, build: true });

export function parseCapture(line, ctx = {}) {
  // Build with Tandem: before the line is squeezed to one line, so a pasted story keeps its shape.
  const built = TARGETS.build ? buildAsk(line) : null;
  if (built) return buildGo(built.text);
  let s = String(line || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!s) return null;
  const today = isYmd(ctx.today || '') ? ctx.today : ymd(new Date());
  let kind = null, rkind = 'win';

  let m;
  // "clean up this document": Notes' Clean up on the open note (a question mark does not make it a question).
  const clean = TARGETS.note === 'notes' ? cleanupAsk(s.replace(/\?$/, '')) : null;
  if (clean) return { kind: 'go', app: 'notes', path: clean.replace ? 'cleanup/replace' : 'cleanup', text: s };
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
  else if ((m = /^(s|request)(?::\s*|\s+)(.+)$/i.exec(s))) { kind = 'request'; s = m[2]; }
  else if (TARGETS.request && /^#\d{1,10}(?=[\s:.,;]|$)/.test(s)) kind = 'request';
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

  if (kind === 'request') {
    // "#1234 note": a request for that ADO work item; anything else is a new request's text.
    const id = /^#(\d{1,10})(?=[\s:.,;]|$)[\s:.,;]*(.*)$/.exec(s.trim());
    const payload = { kind: 'request' };
    let body = s.trim();
    if (id) { payload.ado = Number(id[1]); body = id[2].trim(); }
    if (body) payload.note = body.slice(0, 4000);
    const text = payload.ado ? `#${payload.ado}${body ? ' ' + body : ''}` : body;
    return { kind, to: TARGETS[kind], text, title: (body ? cap(body.split('\n')[0]) : `#${payload.ado}`).slice(0, 200), payload };
  }
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
    const named = findFolder(s.trim(), ctx.folders);
    const body = (named ? named.rest : s).trim();
    if (!body) return null;
    const title = cap(tidy(body.split(/[.!?\n]/)[0] || body)).slice(0, 120);
    const payload = { kind: 'note', title };
    if (named && named.folder.id === 'today') payload.daily = today;
    else if (named) payload.folder = named.folder.id;
    return { kind, to: TARGETS[kind], text: body, title, payload };
  }
  if (kind === 'receipt') {
    const body = cap(tidy(nameCase(s, found)));
    const report = found.find(p => p.kind !== 'group' && p.relation === 'report');
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
  if (found.length) payload.who = found.slice(0, 10).map(p => p.id);
  if (kind === 'waiting') payload.waiting = true;
  if (due) payload.due = due;
  if (urgent) payload.urgent = true;
  if (list) payload.list = list;
  return { kind, to: TARGETS[kind], text: title, title, payload, ...(found.length ? { names: found.slice(0, 10).map(p => p.name.trim()) } : {}) };
}

/* Several pasted lines to proposals, one per non-empty line. */
export function parseLines(text, ctx) {
  // "b " then a pasted story, log or question: the whole paste is one thing to build, not one item per line.
  const built = TARGETS.build ? buildAsk(text) : null;
  if (built) return [buildGo(built.text)];
  return String(text || '').split(/\r?\n/).map(l => parseCapture(l, ctx)).filter(Boolean);
}

/* A proposal that can be sent: a capture with a known target. */
export const isCapture = p => !!(p && TARGETS[p.kind] && p.to === TARGETS[p.kind]);

/* Change what a proposal is (Tab in the review list), keeping the words. */
export function retarget(p, kind, ctx = {}) {
  if (!p || !KINDS.includes(kind)) return p;
  const prefix = { task: 't ', waiting: 'w ', receipt: 'r ', note: 'n ', idea: 'p ', request: 's ' }[kind];
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

/* A YYYY-MM-DD date as people read it: "Fri, Nov 6" (the year only when it is not this year's). */
export function dayLabel(iso, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const opts = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (+m[1] !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

/* One line describing a proposal for the review list: where it goes and what was filled in. */
export function describe(p) {
  if (!p) return '';
  if (p.kind === 'ask') return 'Ask in Builds';
  if (p.kind === 'go' && p.build) return `Build with Tandem in ${TARGET_NAMES[p.app] || 'Builds'}: starts when you press Enter`;
  if (p.kind === 'go' && /^cleanup/.test(p.path || '')) return `Clean up the open note in ${TARGET_NAMES[p.app] || 'Notes'}${p.path === 'cleanup/replace' ? ', replacing it' : ', as a copy'}`;
  if (p.kind === 'go') return 'Go to ' + (TARGET_NAMES[p.app] || p.app);
  const q = p.payload || {};
  if (p.kind === 'request') return q.ado ? `${TARGET_NAMES[p.to] || 'Builds'} · #${q.ado}${q.note ? ', with a note' : ''}` : `${TARGET_NAMES[p.to] || 'Builds'} · New`;
  if (p.kind === 'idea') return q.map ? `Roadmaps · ${q.mapTitle || 'roadmap'}, unscheduled` : 'Roadmaps · Pending assignment';
  const bits = [p.kind === 'waiting' || q.waiting ? 'Tasks, waiting on' : p.kind === 'receipt' ? `People, ${q.kind || 'win'}` : TARGET_NAMES[p.to] || p.to];
  if (p.names && p.names.length) bits.push(p.names.join(', '));
  if (p.kind === 'note' && q.daily) bits.push("today's note");
  else if (p.kind === 'note' && q.folder) bits.push(`${q.folder}/ · new note "${String(q.title || p.title || '').slice(0, 60)}"`);
  if (q.list) bits.push('#' + q.list);
  if (q.due) bits.push('due ' + dayLabel(q.due));
  if (q.urgent) bits.push('urgent');
  return bits.join(' · ');
}
