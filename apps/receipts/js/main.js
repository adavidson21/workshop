/* Rapport: your private notebook about the people you work with. Lattice is the shared record; Rapport feeds it.

   Rapport 5.0.0 has one way to do each thing:
   - People (the home page) lists everyone: your team's goals, you, your reports, your manager and the peers you
     meet with, sorted by who is due for a 1:1.
   - One Log box at the top of every page adds a receipt. `@handle` or the open page says who it is about.
   - One page per person, the same for everyone, with the tabs that person has: 1:1 (prep, today's note, Wrap up),
     Log (their receipts), Goals (a report's OKRs for a quarter) and Review (a draft by section). You have Log and
     Review; a peer has 1:1.
   - My team holds the team's goals as a tree, with Import from Lattice.
   - Copy for Lattice is the one way out: talking points, a receipt, a goal, a review section.
   - Rapport's settings (review cycle, review sections, flag after, Tandem) are in Workshop's Settings, Apps;
     people are in Settings, People.

   The app id stays `receipts`. Everything goes through the Workshop SDK (shared/workshop-sdk.js); the page makes no
   other network requests (see the CSP in index.html). state.js and lattice.js are the logic; js/oneonones/ is the
   1:1 tab and js/goals/ the goals; this file paints and handles input. */
import { connect } from '../../../shared/workshop-sdk.js';
import { mountBar } from '../../../shared/standalone-bar.js';
import * as R from './state.js';
import * as L from './lattice.js';
import * as D from '../../../shared/people.js';
import { createSummaryWriter } from '../../../shared/summary.js';
import { createHolder } from '../../../shared/focus.js';
import { createOneOnOnesPage } from './oneonones/page.js';
import { createGoalsPage } from './goals/page.js';
import { ownerFolder, quarterKey, quarterLabel, isQuarter } from './goals/model.js';

const app = document.getElementById('app');
const ws = await connect({ app: R.APP });
document.documentElement.classList.toggle('embed', ws.embedded);
if (!ws.embedded) mountBar('Rapport');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------- data ---------- */
const NAMES = ['entries', 'config'];
const store = {};
const blank = name => ({ schema: `${R.APP}.${name}`, version: R.VERSION, rev: 0, items: [], deleted: {}, ...(name === 'config' ? { meta: { ...R.DEFAULT_CONFIG, updatedAt: 0 } } : {}) });

// Rapport's summary for other apps (R.summaryCards): written after loading and after each save of entries.
const summary = createSummaryWriter({ data: ws.data, app: R.APP, build: () => store.entries && store.entries.version === R.VERSION ? R.summaryCards(store.entries, { due: oo && oo.dueList ? oo.dueList() : [], upcoming: oo && oo.upcomingList ? oo.upcomingList() : [], cycleEnd: cfg().cycleEnd || '', today: R.isoDay(new Date()) }).concat(held.card() ? [held.card()] : []) : null });
// Focus hours (Workshop docs/focus.md): receipts picked up during focus or lunch are added as always, without a toast,
// and counted in Rapport's `held` summary card for Workshop's release toast and the digest.
const held = createHolder(ws, { label: n => `${n} receipt${n === 1 ? '' : 's'} picked up`, route: 'me', onChange: () => summary.schedule() });
// Senders of offers come from the manifests (ws.apps.list); R.SENDERS is updated in place. Not awaited here, so
// the page's route and command handlers are in place before the first event; loadOffers waits for it.
const sendersReady = (ws.apps && ws.apps.list ? ws.apps.list() : Promise.resolve([])).catch(() => []).then(apps => {
  const found = R.sendersFrom(apps);
  for (const k of Object.keys(R.SENDERS)) delete R.SENDERS[k];
  Object.assign(R.SENDERS, found);
});
async function loadAll() {
  for (const n of NAMES) store[n] = (await ws.data.get(n)) || blank(n);
  await loadDirectory();
  await loadAppSettings();
  await moveSettings();
  await moveOldReports();
  await loadOffers();
  summary.schedule();
}
// Reports Rapport 2.x kept itself, copied into the directory once with their ids (R.oldReports), so they and
// their receipts show again. config meta.reportsMovedAt says it ran; the old collection is only read, never changed.
async function moveOldReports() {
  if (!ws.people || !ws.people.adopt || cfg().reportsMovedAt || dir.unreadable) return;
  let list;
  try { list = R.oldReports(await ws.data.get(R.OLD_PEOPLE)); } catch (e) { return; }
  if (!list.length) return;
  try {
    const added = await ws.people.adopt(list);
    await saveConfig({ reportsMovedAt: Date.now() });
    if (added.length) {
      await loadDirectory();
      ws.toast(`${added.length === 1 ? '1 report' : `${added.length} reports`} moved into People, with their receipts.`, { kind: 'success' });
    }
  } catch (e) { /* tried again next load */ }
}
// Workshop's people directory (ws.people; docs/people.md in workshop): you, your reports, your manager, peers.
// People are added and changed only in Settings, People.
let dir = D.EMPTY;
async function loadDirectory() {
  try { dir = await ws.people.get(); } catch (e) { /* keep what we had */ }
}

/* Rapport's settings live in Workshop's Settings, Apps (app.json `settings`, docs/app-settings.md): review cycle,
   review sections, flag after, Tandem. Until 5.0.0 they were in config.meta (and Tandem in the 1:1s settings):
   copied over once (config meta.settingsMovedAt), and config.meta stays the fallback where there is no registry. */
let appVals = {};
async function loadAppSettings() {
  if (!ws.appSettings) return;
  try { appVals = await ws.appSettings.get(); } catch (e) { /* keep what we had */ }
}
const MOVED = ['sections', 'cycleStart', 'cycleEnd', 'staleDays'];
async function moveSettings() {
  if (!ws.appSettings || !store.config || (store.config.meta || {}).settingsMovedAt) return;
  const m = store.config.meta || {};
  const patch = {};
  for (const k of MOVED) if (m[k] !== undefined && JSON.stringify(m[k]) !== JSON.stringify(R.DEFAULT_CONFIG[k])) patch[k] = m[k];
  try {
    if (Object.keys(patch).length) appVals = await ws.appSettings.set(patch);
    await saveConfig({ settingsMovedAt: Date.now() });
  } catch (e) { /* tried again next load */ }
}
// Tandem (the old 1:1s "AI steps" switch): copied once, after the 1:1s settings have loaded.
async function moveTandem() {
  if (!ws.appSettings || !oo || (store.config.meta || {}).tandemMovedAt) return;
  try {
    if (oo.v.settings && oo.v.settings.aiDraft === false) appVals = await ws.appSettings.set({ tandem: false });
    await saveConfig({ tandemMovedAt: Date.now() });
  } catch (e) { /* tried again next load */ }
}
const tandem = () => (typeof appVals.tandem === 'boolean' ? appVals.tandem : !(oo && oo.v.settings && oo.v.settings.aiDraft === false));

// Offers other apps left for Rapport in their own handoffs collection (read only; docs/handoffs.md in workshop).
const offerEnvs = {};
async function loadOffers() {
  await sendersReady;
  for (const app of Object.keys(R.SENDERS)) {
    try { offerEnvs[app] = await ws.data.get('handoffs', { app }); } catch (e) { offerEnvs[app] = null; }
  }
}
// Captures you already accepted elsewhere (accepted: true): added with no second click.
let picking = false;
async function pickUp() {
  if (picking || !store.entries || !store.config) return;
  const known = reports().map(p => p.id);
  const seen = [...store.entries.items.map(e => e.id), ...Object.keys(store.entries.deleted || {})];
  const todo = Object.keys(R.SENDERS).flatMap(app => R.acceptedOffers(app, offerEnvs[app], cfg().handled, known, seen));
  if (!todo.length) return;
  picking = true;
  try {
    const made = todo.map(o => R.entryFromOffer(o));
    await save('entries', env => { const ids = new Set(env.items.map(e => e.id)); env.items.push(...made.filter(e => !ids.has(e.id))); });
    await saveConfig({ handled: R.markHandled(cfg().handled, todo.map(o => o.key)) });
    if (!held.add(todo.length)) ws.toast(todo.length === 1 ? `Receipt added from ${todo[0].from}.` : `${todo.length} receipts added from ${todo[0].from}.`, { kind: 'success', hold: true });
  } catch (e) { /* tried again on the next change */ }
  finally { picking = false; }
}
const offers = () => {
  const known = reports().map(p => p.id);
  return Object.keys(R.SENDERS).flatMap(app => R.pendingOffers(app, offerEnvs[app], cfg().handled, known));
};
const entries = () => store.entries.items.map(R.cleanEntry);
// Reports, archived ones included.
const reports = () => R.reportsFrom(dir);
const cfg = () => {
  const out = { ...R.DEFAULT_CONFIG, ...(store.config.meta || {}) };
  for (const k of MOVED) if (appVals[k] !== undefined) out[k] = appVals[k];
  if (!Array.isArray(out.sections) || !out.sections.length) out.sections = R.DEFAULT_SECTIONS;
  return out;
};

// The write loop from the data format: stamp, put, and on a conflict merge with what is stored and put again.
async function save(name, mutate) {
  const before = store[name];
  const after = structuredClone(before);
  mutate(after);
  ws.data.stamp(before, after);
  try {
    const r = await ws.data.put(name, after);
    store[name] = { ...after, rev: r.rev, updatedAt: r.updatedAt };
  } catch (err) {
    if (err.code !== 'conflict' || !err.current) throw err;
    const merged = ws.data.merge(after, err.current);
    const r = await ws.data.put(name, merged);
    store[name] = { ...merged, rev: r.rev, updatedAt: r.updatedAt };
  }
  if (name === 'entries') summary.schedule();
}
async function safely(fn, okText) {
  try { await fn(); if (okText) ws.toast(okText, { kind: 'success' }); }
  catch (err) { ws.toast(err.message || 'Could not save.', { kind: 'error' }); }
  paint();
}
const upsertEntry = e => save('entries', env => {
  const i = env.items.findIndex(x => x.id === e.id);
  if (i >= 0) env.items[i] = e; else env.items.push(e);
});
const removeEntry = id => save('entries', env => { env.items = env.items.filter(x => x.id !== id); });
const saveConfig = patch => save('config', env => { env.meta = { ...(env.meta || {}), ...patch }; });

/* ---------- people ---------- */
const managerOf = () => D.manager(dir);
const upName = () => (managerOf() || {}).name || cfg().upLabel || 'My manager';
const nameOf = about => about === 'me' ? 'Me' : about === 'up' ? upName() : D.label(dir, about, 'Former report');
const isReport = id => reports().some(p => p.id === id);
// Whose receipts a directory person's Log holds: a report's own id, your manager's 'up', '' for anyone else.
const aboutOf = id => (isReport(id) ? id : (managerOf() && managerOf().id === id) || id === 'up' ? 'up' : '');
const firstName = n => String(n || '').split(' ')[0] || 'them';
const RELATION = { report: '', manager: 'Manager', peer: 'Peer', contact: 'Contact', self: 'You' };

/** A person's page: who, whose receipts, and which tabs. route: {id (directory id or 'up'), oid (1:1s only)}. */
function personOf(route) {
  if (route.oid) {
    const p = oo.v.people.find(x => x.id === route.oid);
    return p ? { key: `o/${p.id}`, oid: p.id, dirId: '', name: p.name, sub: 'Not in People', about: '', tabs: ['1on1'] } : null;
  }
  const mgr = managerOf();
  const id = route.id === 'up' && mgr ? mgr.id : route.id;
  if (id === 'up') return { key: 'up', dirId: '', name: upName(), sub: 'Manager', about: 'up', tabs: ['log', 'review'] };
  const d = dir.byId.get(id);
  if (!d || d.kind !== 'person') return null;
  const about = aboutOf(id);
  const tabs = d.relation === 'self' ? ['log', 'review'] : about === 'up' ? ['1on1', 'log', 'review'] : about ? ['1on1', 'log', 'goals', 'review'] : ['1on1'];
  return { key: `p/${id}`, dirId: d.relation === 'self' ? '' : id, name: d.name, sub: [d.role, RELATION[d.relation]].filter(Boolean).join(' · ') || (about ? 'Direct report' : ''), about: d.relation === 'self' ? 'me' : about, tabs, archived: !!d.archived, self: d.relation === 'self' };
}
const ME = () => ({ key: 'me', dirId: '', name: 'Me', sub: 'Self review', about: 'me', tabs: ['log', 'review'] });

/* ---------- view state ---------- */
const S = {
  route: { view: 'people' },
  filters: {},          // per about: {period, kind, star, q}
  peopleFilter: 'all',  // People: 'all', 'due', 'reports', 'up'
  coverage: false,      // People: review season (section coverage instead of since last 1:1)
  log: null,            // the Log box's draft
  logAbout: '',         // the Log box's About, when picked by hand ('' follows the page)
  more: false,          // the Log box's details open
  review: {},           // per about: {period, texts: {section: edited text}}
  editing: null,
};
const filterFor = key => (S.filters[key] ||= { period: cfg().cycleStart ? 'cycle' : 'quarter', kind: '', star: false, q: '' });
const reviewFor = about => (S.review[about] ||= { period: cfg().cycleStart ? 'cycle' : 'quarter', texts: {} });

/* ---------- routing ----------
   Inside Workshop the shell owns the hash (#/receipts/<path>) and tells us the path with the route event; on its
   own page the hash is #/<path>.
     ''                     People                      team[/<quarter>[/team]]  My team's goals
     me[/review]            your Log, your Review       p/<id>[/<tab>[/<quarter>]] a person (tab 1on1, log, goals, review)
     o/<1:1s id>            a 1:1s person not in People up                       your manager's Log
   Old addresses (Rapport 4) open the same places: team/<id>, 1on1s[/<id>], goals[/<q>[/<owner>]], review, settings. */
function parse(path) {
  const seg = String(path || '').replace(/^#?\/?/, '').split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  const [a, b, c, d] = seg;
  if (a === 'me') return { view: 'person', me: true, tab: b === 'review' ? 'review' : 'log' };
  if (a === 'p' && b) return { view: 'person', id: b, tab: c || '', q: d || '' };
  if (a === 'o' && b) return { view: 'person', oid: b, tab: '1on1' };
  if (a === 'up') return { view: 'person', id: 'up', tab: b || 'log' };
  if (a === 'team') {
    if (b && !isQuarter(b)) return { view: 'person', id: b, tab: '' }; // Rapport 4: team/<report id>
    return { view: 'team', q: b || '', owner: c === 'team' ? 'team' : '' };
  }
  if (a === 'goals') {
    if (c && c !== 'team') return { view: 'person', folder: c, tab: 'goals', q: b || '' };
    return { view: 'team', q: isQuarter(b) ? b : '', owner: c === 'team' ? 'team' : '' };
  }
  if (a === '1on1s') return b && b !== 'settings' ? { view: 'person', legacyOid: b, tab: '1on1' } : { view: 'people' };
  if (a === 'review') return { view: 'person', me: true, tab: 'review' };
  if (a === 'settings') return { view: 'settings' };
  return { view: 'people' };
}
/** The route with old forms resolved against what is loaded: a goals folder or an old 1:1s id to a person. */
function resolve(r) {
  if (r.view !== 'person') return r;
  if (r.folder) { const p = reports().find(x => ownerFolder(x.id) === r.folder); return p ? { ...r, id: p.id, folder: '' } : { view: 'team', q: r.q, owner: '' }; }
  if (r.legacyOid && oo && oo.v.loaded) {
    const p = oo.v.people.find(x => x.id === r.legacyOid);
    if (!p) return { view: 'people' };
    return p.personId && dir.byId.get(p.personId) ? { ...r, id: p.personId, legacyOid: '' } : { ...r, oid: p.id, legacyOid: '' };
  }
  return r;
}
let oo = null;     // the 1:1 tab (js/oneonones/)
let goals = null;  // goals (js/goals/)
let P = null;      // the person whose page is open
function setRoute(r) {
  S.route = r;
  const rr = resolve(r);
  P = rr.view === 'person' && !rr.legacyOid ? (rr.me ? ME() : personOf(rr)) : null;
  if (P && rr.me === undefined && P.self) P = { ...P, key: 'me' };
  const tab = P ? (P.tabs.includes(rr.tab) ? rr.tab : P.tabs[0]) : '';
  S.tab = tab;
  if (P && P.key !== S.lastKey) { S.logAbout = ''; S.lastKey = P.key; }
  if (!P) S.lastKey = '';
  if (oo) oo.show(P && tab === '1on1' ? (P.oid ? { oid: P.oid } : { dirId: P.dirId }) : null);
  if (goals) {
    if (rr.view === 'team') goals.route('goals', rr.q || quarterKey(), rr.owner, { inPerson: false });
    else if (P && tab === 'goals' && P.dirId) goals.route('goals', isQuarter(rr.q) ? rr.q : quarterKey(), ownerFolder(P.dirId), { inPerson: true });
    else goals.route('off');
  }
  paint();
}
function go(path) {
  if (ws.embedded) ws.open({ app: R.APP, path });
  else if (location.hash !== '#/' + path) location.hash = '#/' + path;
  else setRoute(parse(path));
}
if (ws.embedded) ws.on('route', ({ path }) => setRoute(parse(path)));
else window.addEventListener('hashchange', () => { setRoute(parse(location.hash)); window.scrollTo(0, 0); });
S.route = parse(ws.embedded ? '' : location.hash);
const openSettings = page => { if (ws.embedded) ws.open({ app: 'settings', path: page }).catch(() => {}); else window.open(R.WORKSHOP_SETTINGS_URL + page, '_blank', 'noopener'); };

/* ---------- 1:1s and goals ---------- */
// Wins from Wrap up become receipts here directly. Ids are stable, so a win already added (or deleted) is not added again.
async function addWins(list) {
  const have = new Set([...store.entries.items.map(e => e.id), ...Object.keys(store.entries.deleted || {})]);
  const fresh = list.filter(e => !have.has(e.id) && isReport(e.about)).map(R.cleanEntry);
  if (fresh.length) { await save('entries', env => { env.items.push(...fresh); }); paint(); }
  return fresh.length;
}
oo = createOneOnOnesPage(ws, app, { repaint: () => { paint(); summary.schedule(); }, isReport, reportName: id => D.label(dir, id, 'them'), addWins, tandem });
goals = createGoalsPage(ws, app, {
  repaint: () => paint(),
  reports: () => reports(),
  meNames: () => [(D.self(dir) || {}).name].filter(Boolean),
  open: (q, owner) => {
    if (!owner || owner === 'team') return go(`team/${q}${owner === 'team' ? '/team' : ''}`);
    const p = reports().find(x => ownerFolder(x.id) === owner);
    go(p ? `p/${p.id}/goals/${q}` : `team/${q}`);
  }
});

/* ---------- icons ---------- */
const I = {
  star: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/></svg>',
  starOn: '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/></svg>',
  lock: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="4" y="9" width="12" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 016 0V9"/></svg>',
  copy: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M13 7V4.5A1.5 1.5 0 0011.5 3h-7A1.5 1.5 0 003 4.5v7A1.5 1.5 0 004.5 13H7"/></svg>',
  down: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v10M6 9l4 4 4-4M4 16h12"/></svg>',
};

/* ---------- pieces ---------- */
const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
const plural = (n, w, ws_ = w + 's') => `${n} ${n === 1 ? w : ws_}`;
const day = d => { const t = R.parseDay(d); return t ? t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };

/* The Log box: the one place to add a receipt, on every page. About follows the open page unless picked. */
const logAbout = () => S.logAbout || (P && P.about) || 'me';
const logDraft = () => (S.log ||= R.blankEntry('me', cfg()));
function logBoxHtml() {
  const about = logAbout();
  const d = logDraft();
  const who = [['me', 'Me'], ...reports().filter(p => !p.archived || p.id === about).map(p => [p.id, p.name]), ...(managerOf() || about === 'up' ? [['up', upName()]] : [])];
  const ph = about === 'me' ? 'Something you did, feedback you got, something you learned' : about === 'up' ? `Support from ${firstName(upName())}, an ask, or feedback to share`
    : `Something ${firstName(nameOf(about))} did, or feedback you gave`;
  return `<form class="composer logbox${d.text ? ' has-text' : ''}" autocomplete="off" aria-label="Log a receipt">
    <div class="lrow">
      <label class="lbl" for="log-text">Log</label>
      <textarea id="log-text" name="text" rows="1" placeholder="${esc(ph)}   (@name for someone else)">${esc(d.text)}</textarea>
      <label class="sr" for="log-about">About</label><select id="log-about" name="about" class="lsel">${who.map(([v, l]) => opt(v, `About: ${l}`, about)).join('')}</select>
      <label class="sr" for="log-kind">Kind</label><select id="log-kind" name="kind" class="lsel">${R.kindOptions(about).map(([k, l]) => opt(k, l, d.kind)).join('')}</select>
      <button class="btn primary" type="submit" title="Save (Ctrl+Enter)">Save</button>
    </div>
    <div class="lmore">
      <div class="chips" role="group" aria-label="Review sections">${cfg().sections.map(s => `<button type="button" class="chip${d.sections.includes(s) ? ' on' : ''}" data-act="draft-sec" data-sec="${esc(s)}" aria-pressed="${d.sections.includes(s)}">${esc(s)}</button>`).join('')}</div>
      <button type="button" class="ibtn star${d.star ? ' on' : ''}" data-act="draft-star" aria-pressed="${d.star}" aria-label="Star for the review" title="Star for the review">${d.star ? I.starOn : I.star}</button>
      <button type="button" class="lnk" data-act="more" aria-expanded="${S.more}">${S.more ? 'Fewer details' : 'More details'}</button>
    </div>
    <div class="details"${S.more ? '' : ' hidden'}>
      <label>Date<input type="date" name="date" value="${esc(d.date)}"></label>
      ${detailFields(d)}
    </div>
  </form>`;
}
function detailFields(d) {
  return `<label>Impact<select name="impact">${opt(0, 'Not set', d.impact)}${[1, 2, 3].map(n => opt(n, R.IMPACT[n], d.impact)).join('')}</select></label>
      <label>Metric<input name="metric" value="${esc(d.metric)}" placeholder="-35% deploy time"></label>
      <label class="wide">Evidence<input name="evidence" value="${esc(d.evidence)}" placeholder="Link, ticket, doc, or where to find it"></label>
      <label class="wide">People involved<input name="people" value="${esc(d.people)}" placeholder="Teams or roles"></label>`;
}

function entryHtml(e) {
  const tags = [
    `<span class="kind k-${e.kind}">${esc(R.kindLabel(e.kind, e.about))}</span>`,
    ...e.sections.map(s => `<span class="tag">${esc(s)}</span>`),
    e.impact ? `<span class="tag imp">${esc(R.IMPACT[e.impact])} impact</span>` : '',
    e.kind === 'concern' ? '<span class="tag soft">Private, never copied</span>' : '',
  ].join('');
  const extra = [
    e.metric ? `<span><b>Metric</b> ${esc(e.metric)}</span>` : '',
    e.evidence ? `<span><b>Evidence</b> ${esc(e.evidence)}</span>` : '',
    e.people ? `<span><b>With</b> ${esc(e.people)}</span>` : '',
  ].filter(Boolean).join('');
  return `<li class="entry" data-id="${esc(e.id)}">
    <div class="edate mono">${esc(R.shortDate(e.date))}</div>
    <div class="ebody">
      <button type="button" class="etext" data-act="edit" title="Edit">${esc(e.text)}</button>
      ${extra ? `<div class="extra">${extra}</div>` : ''}
      <div class="etags">${tags}</div>
    </div>
    <div class="eacts">
      <button class="ibtn star${e.star ? ' on' : ''}" data-act="star" aria-pressed="${e.star}" aria-label="${e.star ? 'Unstar' : 'Star'}">${e.star ? I.starOn : I.star}</button>
      ${e.kind !== 'concern' ? `<button class="btn ghost small" data-act="copy-receipt" title="For feedback or praise in Lattice">Copy for Lattice</button>` : ''}
    </div>
  </li>`;
}
function feedHtml(list, emptyText) {
  if (!list.length) return `<p class="empty">${esc(emptyText)}</p>`;
  return R.groupByMonth(list).map(g => `<section class="month"><h3 class="section-label">${esc(g.label)}<span class="n mono">${g.items.length}</span></h3><ul class="feed">${g.items.map(e => entryHtml(e)).join('')}</ul></section>`).join('');
}
const periodSelect = (key, cur, attr) => `<label class="sr" for="per-${esc(key)}">Period</label><select id="per-${esc(key)}" ${attr} class="lsel">${R.periods(cfg()).map(p => opt(p.key, p.label, cur)).join('')}</select>`;

/* ---------- offers: Keep or Dismiss on top of that person's Log ---------- */
function offersHtml(about) {
  const list = offers().filter(o => o.about === about);
  if (!list.length) return '';
  return `<ul class="offers" aria-label="Waiting to be kept">${list.map(o => `<li class="offer" data-key="${esc(o.key)}">
      <span class="ofrom">From ${esc(o.from)}</span>
      <label class="sr" for="of-${esc(o.key)}">Receipt</label><input class="otext" id="of-${esc(o.key)}" value="${esc(o.text)}" maxlength="2000">
      <select class="okind" aria-label="Kind">${R.kindOptions(o.about).map(([k, l]) => opt(k, l, o.kind)).join('')}</select>
      <span class="odate mono">${esc(R.shortDate(o.date))}</span>
      <button class="btn primary" data-act="offer-accept">Keep</button><button class="btn" data-act="offer-dismiss">Dismiss</button>
    </li>`).join('')}</ul>`;
}
async function handleOffers(rows, accept) {
  const byKey = new Map(offers().map(o => [o.key, o]));
  const picked = rows.map(r => ({ r, o: byKey.get(r.dataset.key) })).filter(x => x.o);
  if (!picked.length) return;
  const keys = picked.map(x => x.o.key);
  await safely(async () => {
    if (accept) {
      const made = picked.map(({ r, o }) => R.entryFromOffer({ ...o, text: r.querySelector('.otext').value.trim() || o.text, kind: r.querySelector('.okind').value }));
      await save('entries', env => { env.items.push(...made); });
    }
    await saveConfig({ handled: R.markHandled(cfg().handled, keys) });
  }, accept ? 'Kept.' : 'Dismissed.');
}

/* ---------- People ---------- */
function peopleView() {
  const all = entries();
  const t = R.today();
  const per = R.findPeriod(cfg(), cfg().cycleStart ? 'cycle' : 'quarter');
  const stale = cfg().staleDays;
  const off = offers();
  const last = about => R.sortEntries(all.filter(e => e.about === about))[0];
  const lastCell = (about, flag) => {
    const e = last(about);
    if (!e) return `<span class="${flag ? 'stale' : 'dim'}">Nothing logged</span>`;
    const n = R.daysBetween(e.date, t);
    return `<span class="${flag && n > stale ? 'stale' : ''}">${n === 0 ? 'Today' : `${n}d ago`}</span>`;
  };
  const nextCell = g => {
    if (!g) return '<span class="dim">No 1:1s</span>';
    if (!g.lastDay) return '<span class="due">Due now</span>';
    if (g.due) return `<span class="due">Overdue ${plural(Math.max(1, R.daysBetween(g.next, t)), 'day')}</span>`;
    const n = R.daysBetween(t, g.next);
    return n <= 1 ? (n === 1 ? 'Tomorrow' : 'Today') : n < 7 ? R.parseDay(g.next).toLocaleDateString('en-US', { weekday: 'long' }) : day(g.next);
  };
  const coverageCell = about => {
    const rv = R.buildReview(all, { about, period: per, sections: cfg().sections });
    const n = rv.coverage.filter(c => c.count).length;
    return `${n} of ${rv.coverage.length} sections <span class="dim">· ${plural(rv.total, 'receipt')}</span>`;
  };
  const sinceCell = (about, g) => {
    if (S.coverage && about) return coverageCell(about);
    const bits = [];
    if (about) {
      const since = g && g.lastDay ? g.lastDay : '';
      const fresh = all.filter(e => e.about === about && (!since || e.date > since)).length;
      if (fresh) bits.push(`${plural(fresh, 'new receipt')}`);
    }
    if (g && g.open) bits.push(`${plural(g.open, 'follow-up')} open`);
    if (g && g.waiting) bits.push(`${g.waiting} waiting in Docket`);
    return bits.join(', ') || '<span class="dim">Nothing new</span>';
  };
  const keep = about => { const n = off.filter(o => o.about === about).length; return n ? ` <span class="keep">${n} to keep</span>` : ''; };
  const rows = [];
  const me = D.self(dir);
  rows.push({ kind: 'me', path: 'me', name: 'Me', sub: 'Self review', about: 'me', g: null, flag: false });
  for (const p of reports().filter(p => !p.archived)) rows.push({ kind: 'report', path: `p/${p.id}`, name: p.name, sub: p.role || 'Direct report', about: p.id, g: oo.glance({ dirId: p.id }), flag: true });
  const mgr = managerOf();
  if (mgr) rows.push({ kind: 'up', path: `p/${mgr.id}`, name: mgr.name, sub: [mgr.role, 'Manager'].filter(Boolean).join(' · '), about: 'up', g: oo.glance({ dirId: mgr.id }), flag: false });
  else if (all.some(e => e.about === 'up')) rows.push({ kind: 'up', path: 'up', name: upName(), sub: 'Manager', about: 'up', g: null, flag: false });
  for (const p of D.withRelation(dir, 'peer')) rows.push({ kind: 'up', path: `p/${p.id}`, name: p.name, sub: [p.role, 'Peer'].filter(Boolean).join(' · '), about: '', g: oo.glance({ dirId: p.id }), flag: false });
  for (const p of D.withRelation(dir, 'contact')) { const g = oo.glance({ dirId: p.id }); if (g) rows.push({ kind: 'up', path: `p/${p.id}`, name: p.name, sub: [p.role, 'Contact'].filter(Boolean).join(' · '), about: '', g, flag: false }); }
  for (const p of oo.unlinked()) rows.push({ kind: 'up', path: `o/${p.id}`, name: p.name, sub: 'Not in People', about: '', g: oo.glance({ oid: p.id }), flag: false });
  const isDue = r => r.g && (r.g.due || !r.g.lastDay);
  const shown = rows.filter(r => S.peopleFilter === 'all' || (S.peopleFilter === 'due' ? isDue(r) : S.peopleFilter === 'reports' ? r.kind === 'report' : r.kind === 'up'));
  const rank = r => (r.kind === 'me' ? 0 : isDue(r) ? 1 : 2);
  shown.sort((a, b) => rank(a) - rank(b));
  const chip = (k, l) => `<button type="button" class="chip${S.peopleFilter === k ? ' on' : ''}" data-act="pfilter" data-k="${k}" aria-pressed="${S.peopleFilter === k}">${esc(l)}</button>`;
  const dueN = rows.filter(isDue).length;
  const team = `<li><a class="prow2 teamrow" href="#" data-act="go" data-path="team">
      <span class="pname"><b>My team</b><span>Team goals, ${esc(quarterLabel(quarterKey()))}</span></span><span class="dim">Goals tree, Import from Lattice</span><span></span><span></span></a></li>`;
  const noTeam = !reports().length && !mgr;
  return `<div class="bar pbar" role="toolbar" aria-label="Filter people">${chip('all', 'Everyone')}${chip('due', `Due for a 1:1${dueN ? ` (${dueN})` : ''}`)}${chip('reports', 'Reports')}${chip('up', 'Up and across')}
      <span class="grow"></span><label class="tog"><input type="checkbox" data-act="coverage"${S.coverage ? ' checked' : ''}> Review season</label></div>
    ${noTeam ? `<div class="engcard"><h2>Who do you work with?</h2><p>Add your reports, your manager and the peers you meet with in Settings, People. They show here, each with a 1:1, a Log and a Review.</p><div class="acts"><button class="btn primary" data-act="people-settings">Open People</button></div></div>` : ''}
    <div class="ptable" role="table" aria-label="People">
      <div class="prow2 phead2" role="row"><span role="columnheader">Person</span><span role="columnheader">Next 1:1</span><span role="columnheader">${S.coverage ? 'Review coverage, this cycle' : 'Since last 1:1'}</span><span role="columnheader">Last logged</span></div>
      <ul class="plist">${S.peopleFilter === 'all' ? team : ''}${shown.map(r => `<li><a class="prow2${isDue(r) ? ' isdue' : ''}" href="#" data-act="go" data-path="${esc(r.path)}">
        <span class="pname"><b>${esc(r.name)}</b><span>${esc(r.sub)}</span>${r.about ? keep(r.about) : ''}</span>
        <span>${r.kind === 'me' ? '<span class="dim">None</span>' : nextCell(r.g)}</span>
        <span>${sinceCell(r.about, r.g)}</span>
        <span>${r.about ? lastCell(r.about, r.flag) : '<span class="dim">No Log</span>'}</span></a></li>`).join('') || '<li class="empty">No one here.</li>'}</ul>
    </div>
    <p class="legend">Highlighted: due for a 1:1, or a report with nothing logged in ${esc(stale)} days. Add or rename people in Settings, People. <button class="lnk" data-act="people-settings">Open People</button></p>
    ${reports().some(p => p.archived) ? `<details class="archived"><summary>Archived reports (${reports().filter(p => p.archived).length})</summary><ul>${reports().filter(p => p.archived).map(p => `<li><button class="lnk" data-act="go" data-path="p/${esc(p.id)}">${esc(p.name)}</button></li>`).join('')}</ul></details>` : ''}`;
}

/* ---------- a person's tabs ---------- */
function logView(about) {
  const f = filterFor(about);
  const period = R.findPeriod(cfg(), f.period);
  const all = entries();
  const inP = R.filterEntries(all, { about, period, q: f.q, star: f.star });
  const list = f.kind ? inP.filter(e => e.kind === f.kind) : inP;
  const count = k => inP.filter(e => e.kind === k).length;
  const chip = (k, l) => `<button type="button" class="chip${f.kind === k ? ' on' : ''}" data-act="kind" data-k="${k}" aria-pressed="${f.kind === k}">${esc(l)} <span class="n">${k ? count(k) : inP.length}</span></button>`;
  const labels = { win: 'Wins', feedback: about === 'me' ? 'Feedback received' : about === 'up' ? 'Feedback to share' : 'Feedback', growth: about === 'me' ? 'Learned' : about === 'up' ? 'Asks' : 'Growth', concern: about === 'me' ? 'Blockers' : 'Concerns', note: 'Notes' };
  if (about === 'up') labels.win = 'Support';
  return `${offersHtml(about)}
    <div class="filters" data-key="${esc(about)}">
      <div class="chips" role="group" aria-label="Kind">${chip('', 'All')}${R.KINDS.filter(k => count(k) || f.kind === k).map(k => chip(k, labels[k])).join('')}</div>
      <span class="grow"></span>
      ${periodSelect(about, f.period, 'name="period"')}
      <label class="sr" for="q-${esc(about)}">Search</label><input type="search" name="q" value="${esc(f.q)}" placeholder="Search" id="q-${esc(about)}">
      <button type="button" class="chip${f.star ? ' on' : ''}" data-act="starred" aria-pressed="${f.star}">Starred</button>
    </div>
    <div class="list">${feedHtml(list, all.some(e => e.about === about) ? 'Nothing matches.' : 'Nothing logged yet. Use the Log box above.')}</div>
    <p class="fine">Click a line to edit it.</p>`;
}

function reviewView(about) {
  const c = cfg();
  const rv = reviewFor(about);
  const period = R.findPeriod(c, rv.period);
  const review = R.buildReview(entries(), { about, period, sections: c.sections });
  const unlisted = R.unlistedSections(R.filterEntries(entries(), { about, period }).filter(e => !e.sections.some(x => c.sections.includes(x))), c.sections);
  const covered = review.coverage.filter(x => x.count).length;
  const textOf = g => rv.texts[g.section] != null ? rv.texts[g.section] : L.sectionText(g);
  const groups = [...c.sections.map(s => review.groups.find(g => g.section === s) || { section: s, items: [] }), ...review.groups.filter(g => g.section === 'Other' && g.items.length)];
  const concerns = review.groups.reduce((n, g) => n + g.items.filter(e => e.kind === 'concern').length, 0);
  return `<div class="filters review-ctl">
      ${periodSelect('rv-' + about, rv.period, 'name="rperiod"')}
      <span class="statline">${plural(review.total, 'receipt')} · ${covered} of ${c.sections.length} sections covered</span>
      <span class="grow"></span>
      <button class="btn primary" data-act="copy-review"${review.total ? '' : ' disabled'}>${I.copy} Copy all for Lattice</button>
      <button class="btn ghost" data-act="dl-csv-review" title="Every receipt in this period">${I.down} .csv</button>
    </div>
    ${unlisted.length ? `<p class="note">Under No section because their sections are not in your list: ${esc(unlisted.join(', '))}. <button class="lnk" type="button" data-act="add-unlisted">Add them to your sections</button></p>` : ''}
    <div class="rsecs">${groups.map((g, i) => {
      const other = g.section === 'Other';
      const n = g.items.filter(e => e.kind !== 'concern').length;
      return `<section class="rsec${g.items.length ? '' : ' empty'}" data-sec="${esc(g.section)}">
        <div class="rsname"><b>${other ? 'No section' : esc(g.section)}</b><span class="dim">${g.items.length ? plural(g.items.length, 'receipt') : 'Nothing yet'}</span></div>
        ${n ? `<label class="sr" for="rs-${i}">Draft for ${esc(other ? 'No section' : g.section)}</label><textarea id="rs-${i}" class="rsdraft" data-sec="${esc(g.section)}" rows="${Math.min(10, n + 1)}">${esc(textOf(g))}</textarea>
          <button class="btn ghost small" data-act="copy-section" data-sec="${esc(g.section)}">Copy</button>`
        : `<p class="dim rsnone">${other ? '' : g.items.length ? 'Only concerns here; they are never copied.' : 'Nothing logged for this section yet.'}</p><span></span>`}
        ${other ? '<p class="fine rsfoot">Pick a section on each line in the Log to place them.</p>' : ''}
      </section>`;
    }).join('')}</div>
    <p class="fine">Starred and big-impact receipts come first. Edits to a draft stay until you leave Rapport.${concerns ? ` ${plural(concerns, 'concern')} in this period ${concerns === 1 ? 'is' : 'are'} never copied.` : ''} Change review sections and your cycle in Settings, Apps, Rapport. <button class="lnk" data-act="rapport-settings">Open</button></p>`;
}

function personPage() {
  if (!P) return `<div class="engcard"><h2>Not found</h2><p>This person is not in People.</p><div class="acts"><button class="btn" data-act="go" data-path="">People</button></div></div>`;
  const tab = S.tab;
  const LABEL = { '1on1': '1:1', log: 'Log', goals: 'Goals', review: 'Review' };
  const base = P.key === 'me' ? 'me' : P.key;
  const path = t => P.key === 'me' ? (t === 'log' ? 'me' : `me/${t}`) : `${base}/${t}`;
  const tabs = P.tabs.length > 1 ? `<nav class="tabs" aria-label="${esc(P.name)}">${P.tabs.map(t => `<button data-act="go" data-path="${esc(path(t))}"${t === tab ? ' class="on" aria-current="page"' : ''}>${LABEL[t]}</button>`).join('')}</nav>` : '';
  let body = '';
  if (tab === '1on1') body = oo.panel(P.oid ? { oid: P.oid } : { dirId: P.dirId, name: P.name });
  else if (tab === 'log') body = logView(P.about);
  else if (tab === 'goals') body = goals.view();
  else if (tab === 'review') body = reviewView(P.about);
  return tabs + `<div class="tabbody t-${tab}">${body}</div>`;
}

function cadenceHtml() {
  if (!P || !P.tabs.includes('1on1')) return '';
  const g = P.oid ? oo.glance({ oid: P.oid }) : P.dirId ? oo.glance({ dirId: P.dirId }) : null;
  if (!g) return '';
  const days = g.cadenceDays;
  const opts = [...new Set([7, 14, 21, 30, days])].sort((a, b) => a - b);
  return `<label class="cad"><span class="sr">How often you meet</span><select data-cadence="${esc(g.id)}" class="lsel">${opts.map(d => opt(d, `1:1 every ${d} days`, days)).join('')}${opt(0, 'No regular 1:1s', '')}</select></label>`;
}

function settingsView() {
  // Only on Rapport's own page; inside Workshop the address opens Settings.
  const where = ws.storage === 'folder' ? 'in the folder you picked' : ws.storage === 'agent' ? 'in your Workshop folder' : 'in this browser';
  return `<section class="set">
      <h3 class="section-label">Privacy and storage</h3>
      <p class="lede">${I.lock} Your receipts, 1:1 notes and goals stay on this computer, ${esc(where)}.</p>
      ${ws.storage === 'indexeddb' ? '<div class="acts"><button class="btn" data-act="folder">Save to a folder</button></div>' : ''}
      <div class="acts">
        <button class="btn" data-act="export">${I.down} Back up (.json)</button>
        <label class="btn">Restore from a backup<input type="file" accept=".json,application/json" data-act="import" hidden></label>
        <button class="btn" data-act="dl-csv-all">${I.down} All receipts (.csv)</button>
      </div>
      <p class="fine">Inside Workshop, backups and Rapport's settings are in Workshop's Settings.</p>
    </section>`;
}

/* ---------- paint ---------- */
let loaded = false;
function paint() {
  if (!loaded) return;
  const r = resolve(S.route);
  const a = document.activeElement;
  const keep = a && a.id ? { id: a.id, s: a.selectionStart, e: a.selectionEnd, top: a.scrollTop } : null;
  oo.setOwn(store.entries, dir);
  let crumb, body, cls;
  if (r.view === 'team') {
    crumb = `<button class="lnk crumb" data-act="go" data-path="">People</button><span class="sep" aria-hidden="true">/</span><h1 class="ptitle">My team</h1><span class="psub">Team goals, with each report's under the one they support</span>`;
    body = goals.view(); cls = 'v-goals';
  } else if (r.view === 'person') {
    crumb = `<button class="lnk crumb" data-act="go" data-path="">People</button><span class="sep" aria-hidden="true">/</span><h1 class="ptitle">${esc(P ? P.name : 'Not found')}</h1>${P && P.sub ? `<span class="psub">${esc(P.sub)}${P.archived ? ' · archived' : ''}</span>` : ''}${cadenceHtml()}`;
    body = personPage(); cls = `v-person v-${S.tab}${S.tab === 'goals' ? ' v-goals' : ''}`;
  } else if (r.view === 'settings' && !ws.embedded) {
    crumb = `<button class="lnk crumb" data-act="go" data-path="">People</button><span class="sep" aria-hidden="true">/</span><h1 class="ptitle">Backups</h1>`;
    body = settingsView(); cls = 'v-settings';
  } else {
    crumb = `<h1 class="ptitle">People</h1><span class="psub">Your private notebook. Lattice is the record.</span>`;
    body = peopleView(); cls = 'v-people';
  }
  app.innerHTML = `<header class="head phead3">${crumb}</header>${logBoxHtml()}<main class="${cls}">${body}</main>`;
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); el.scrollTop = keep.top; } catch (e) { /* not a text field */ } }
  }
  const t = document.getElementById('log-text');
  if (t) grow(t);
  document.title = ws.embedded ? 'Rapport' : `${P ? P.name : 'People'} · Rapport`;
  goals.afterPaint();
}
const grow = t => { t.style.height = 'auto'; t.style.height = Math.min(160, t.scrollHeight + 2) + 'px'; };

/* ---------- edit dialog ---------- */
const dlg = document.createElement('dialog');
dlg.className = 'edit';
document.body.appendChild(dlg);
function openEdit(e) {
  S.editing = structuredClone(e);
  const d = S.editing;
  dlg.innerHTML = `<form method="dialog" class="eform" autocomplete="off">
    <h2>Edit receipt <span class="mono">${esc(nameOf(d.about))}</span></h2>
    <label class="wide">Receipt<textarea name="text" rows="4" required>${esc(d.text)}</textarea></label>
    <label>Kind<select name="kind">${R.kindOptions(d.about).map(([k, l]) => opt(k, l, d.kind)).join('')}</select></label>
    <label>Date<input type="date" name="date" value="${esc(d.date)}" required></label>
    ${detailFields(d)}
    <div class="wide chips" role="group" aria-label="Review sections">${cfg().sections.concat(d.sections.filter(s => !cfg().sections.includes(s))).map(s => `<button type="button" class="chip${d.sections.includes(s) ? ' on' : ''}" data-sec="${esc(s)}" aria-pressed="${d.sections.includes(s)}">${esc(s)}</button>`).join('')}</div>
    <label class="tog wide"><input type="checkbox" name="star"${d.star ? ' checked' : ''}> Starred for the review</label>
    <div class="acts wide"><button class="btn text-danger" type="button" data-act="delete">Delete</button><span class="grow"></span><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn primary" type="submit">Save</button></div>
  </form>`;
  dlg.showModal();
  dlg.querySelector('textarea').focus();
}
dlg.addEventListener('click', ev => {
  if (ev.target === dlg) return dlg.close();
  const chip = ev.target.closest('.chip');
  if (chip) {
    const s = chip.dataset.sec, list = S.editing.sections;
    S.editing.sections = list.includes(s) ? list.filter(x => x !== s) : [...list, s];
    chip.classList.toggle('on'); chip.setAttribute('aria-pressed', chip.classList.contains('on'));
    return;
  }
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'close') dlg.close();
  if (act === 'delete') {
    const gone = S.editing;
    dlg.close();
    safely(() => removeEntry(gone.id)).then(() => ws.toast('Receipt deleted.', { action: { label: 'Undo', command: 'undo-delete' } }));
    lastDeleted = gone;
  }
});
dlg.addEventListener('submit', ev => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const e = R.cleanEntry({ ...S.editing, text: fd.get('text'), kind: fd.get('kind'), date: fd.get('date'), impact: fd.get('impact'), metric: fd.get('metric'), evidence: fd.get('evidence'), people: fd.get('people'), star: fd.get('star') === 'on' });
  if (!e.text) return;
  dlg.close();
  safely(() => upsertEntry(e));
});
let lastDeleted = null;

/* ---------- input ---------- */
// The Log box's fields into its draft, so a repaint loses nothing.
function syncLog(form) {
  const d = logDraft(), fd = new FormData(form);
  d.text = fd.get('text') || '';
  if (fd.has('kind')) d.kind = fd.get('kind');
  if (fd.has('date')) d.date = fd.get('date') || d.date;
  if (fd.has('impact')) Object.assign(d, { impact: fd.get('impact'), metric: fd.get('metric'), evidence: fd.get('evidence'), people: fd.get('people') });
  form.classList.toggle('has-text', !!d.text.trim());
}
/** `@handle` at the start of the text: the report or manager it names. */
function aboutFromText(text) {
  const m = /^@([A-Za-z0-9._-]+)\s+/.exec(text || '');
  if (!m) return null;
  const it = D.find(dir, m[1]);
  if (!it || it.kind !== 'person') return null;
  const about = it.relation === 'self' ? 'me' : aboutOf(it.id);
  return about ? { about, text: text.slice(m[0].length) } : null;
}
async function saveLog(form) {
  syncLog(form);
  const d = logDraft();
  const fd = new FormData(form);
  let about = String(fd.get('about') || logAbout()), text = d.text;
  const at = aboutFromText(text);
  if (at) { about = at.about; text = at.text; }
  const e = R.cleanEntry({ ...d, id: R.newId('r'), about, text, createdAt: new Date().toISOString() });
  if (!e.text) { document.getElementById('log-text')?.focus(); return; }
  await safely(() => upsertEntry(e), `Logged for ${nameOf(about)}.`);
  S.log = { ...R.blankEntry('me', cfg()), kind: d.kind, date: d.date };
  paint();
  document.getElementById('log-text')?.focus();
}
const copy = async (text, ok) => {
  try { await navigator.clipboard.writeText(text); ws.toast(ok, { kind: 'success' }); }
  catch (e) { ws.toast('Could not copy. Select the text and press Ctrl+C.', { kind: 'warn' }); }
};
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const currentReview = () => {
  const about = P ? P.about : 'me';
  const rv = reviewFor(about);
  return { about, rv, review: R.buildReview(entries(), { about, period: R.findPeriod(cfg(), rv.period), sections: cfg().sections }) };
};

app.addEventListener('click', async ev => {
  const chip = ev.target.closest('.logbox .chip');
  if (chip) {
    const d = logDraft(), s = chip.dataset.sec;
    d.sections = d.sections.includes(s) ? d.sections.filter(x => x !== s) : [...d.sections, s];
    chip.classList.toggle('on'); chip.setAttribute('aria-pressed', chip.classList.contains('on'));
    return;
  }
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (el.tagName === 'A') ev.preventDefault();
  const entryId = el.closest('.entry')?.dataset.id;
  switch (act) {
    case 'go': go(el.dataset.path); break;
    case 'more': syncLog(el.closest('form')); S.more = !S.more; paint(); break;
    case 'draft-star': { syncLog(el.closest('form')); const d = logDraft(); d.star = !d.star; paint(); break; }
    case 'star': { const e = entries().find(x => x.id === entryId); if (e) await safely(() => upsertEntry({ ...e, star: !e.star })); break; }
    case 'edit': { const e = entries().find(x => x.id === entryId); if (e) openEdit(e); break; }
    case 'copy-receipt': { const e = entries().find(x => x.id === entryId); if (e) copy(L.receiptText(e), 'Copied. Paste it as feedback or praise in Lattice.'); break; }
    case 'people-settings': openSettings('people'); break;
    case 'rapport-settings': openSettings('apps'); break;
    case 'pfilter': S.peopleFilter = el.dataset.k; paint(); break;
    case 'kind': { const f = filterFor(el.closest('.filters').dataset.key); f.kind = f.kind === el.dataset.k ? '' : el.dataset.k; paint(); break; }
    case 'starred': { const f = filterFor(el.closest('.filters').dataset.key); f.star = !f.star; paint(); break; }
    case 'offer-accept': await handleOffers([el.closest('.offer')], true); break;
    case 'offer-dismiss': await handleOffers([el.closest('.offer')], false); break;
    case 'copy-section': {
      const t = app.querySelector(`.rsdraft[data-sec="${CSS.escape(el.dataset.sec)}"]`);
      if (t) copy(t.value.trim() + '\n', `${el.dataset.sec === 'Other' ? 'No section' : el.dataset.sec} copied. Paste it into the review in Lattice.`);
      break;
    }
    case 'copy-review': { const { rv, review } = currentReview(); copy(L.reviewText(review, rv.texts), 'Review copied. Paste it into Lattice, one section at a time.'); break; }
    case 'dl-csv-review': {
      const { about, rv } = currentReview();
      download(`rapport-${R.slug(nameOf(about))}-${R.today()}.csv`, R.toCsv(R.filterEntries(entries(), { about, period: R.findPeriod(cfg(), rv.period) }), nameOf), 'text/csv;charset=utf-8');
      break;
    }
    case 'add-unlisted': {
      const c = cfg();
      const list = [...c.sections, ...R.unlistedSections(entries(), c.sections)].slice(0, 30);
      await safely(async () => { appVals = await ws.appSettings.set({ sections: list }); }, 'Sections added.');
      break;
    }
    case 'dl-csv-all': download(`rapport-all-${R.today()}.csv`, R.toCsv(entries(), nameOf), 'text/csv;charset=utf-8'); break;
    case 'export': { const bundle = await ws.data.export({ apps: [R.APP] }); download(`rapport-backup-${R.today()}.json`, JSON.stringify(bundle, null, 2), 'application/json'); break; }
    case 'folder': try { await ws.folder.choose(); } catch (e) { if (e.code !== 'bad_request') ws.toast(e.message, { kind: 'error' }); } break;
  }
});

app.addEventListener('input', ev => {
  const t = ev.target;
  const box = t.closest('.logbox');
  if (box) { syncLog(box); if (t.id === 'log-text') grow(t); return; }
  if (t.matches('.rsdraft')) { reviewFor(P ? P.about : 'me').texts[t.dataset.sec] = t.value; return; }
  const filt = t.closest('.filters:not(.review-ctl)');
  if (filt && t.name === 'q') { filterFor(filt.dataset.key).q = t.value; paint(); }
});
app.addEventListener('change', async ev => {
  const t = ev.target;
  if (t.closest('.logbox')) {
    if (t.name === 'about') { syncLog(t.closest('form')); S.logAbout = t.value; paint(); }
    return;
  }
  if (t.matches('[data-cadence]')) { await oo.setCadence(Number(t.value) || 0, t.dataset.cadence); paint(); return; }
  if (t.matches('[data-act=coverage]')) { S.coverage = t.checked; paint(); return; }
  if (t.dataset.act === 'import') {
    const file = t.files && t.files[0];
    if (!file) return;
    try {
      const r = await ws.data.import(JSON.parse(await file.text()));
      await loadAll();
      ws.toast(`Restored: ${r.created} new, ${r.merged} merged.`, { kind: 'success' });
    } catch (e) { ws.toast(e instanceof SyntaxError ? 'That file is not a Rapport backup.' : e.message, { kind: 'error' }); }
    paint();
    return;
  }
  if (t.name === 'rperiod') { const rv = reviewFor(P ? P.about : 'me'); rv.period = t.value; rv.texts = {}; paint(); return; }
  const key = t.closest('.filters')?.dataset.key;
  if (key && t.name === 'period') { filterFor(key).period = t.value; paint(); }
});
app.addEventListener('submit', ev => {
  if (!ev.target.classList.contains('logbox')) return;
  ev.preventDefault();
  saveLog(ev.target);
});
app.addEventListener('keydown', ev => {
  if (ev.target.closest('.logbox') && ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey || (ev.target.id === 'log-text' && !ev.shiftKey))) {
    ev.preventDefault();
    saveLog(ev.target.closest('.logbox'));
  }
});
// N jumps to the Log box, on any page.
const focusLog = () => setTimeout(() => document.getElementById('log-text')?.focus(), 50);
document.addEventListener('keydown', ev => {
  if (ev.key !== 'n' || ev.ctrlKey || ev.metaKey || ev.altKey || dlg.open || document.querySelector('dialog[open]')) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  ev.preventDefault();
  focusLog();
});

/* ---------- commands and live updates ---------- */
ws.commands.register({ id: 'new', title: 'Log a receipt' });
ws.commands.register({ id: 'review', title: 'Build my review' });
ws.commands.register({ id: 'prep', title: 'Prep a 1:1' });
ws.commands.register({ id: 'goals', title: 'Open team goals' });
ws.on('command', async ({ id }) => {
  if (id === 'prep') { const p = oo.prep(); go(p ? `${p}${p.startsWith('p/') ? '/1on1' : ''}` : ''); }
  if (id === 'new') focusLog();
  if (id === 'review') go('me/review');
  if (id === 'undo-delete' && lastDeleted) { const e = lastDeleted; lastDeleted = null; await safely(() => upsertEntry(e), 'Restored.'); }
});
for (const n of NAMES) ws.data.subscribe(n, async () => { store[n] = (await ws.data.get(n)) || blank(n); paint(); });
ws.people.subscribe(next => { dir = next; setRoute(S.route); });
if (ws.appSettings && ws.appSettings.subscribe) ws.appSettings.subscribe(v => { appVals = v; paint(); });
sendersReady.then(() => { for (const app of Object.keys(R.SENDERS)) ws.data.subscribe('handoffs', async () => { await loadOffers(); await pickUp(); paint(); }, { app }); });
ws.on('online', async () => { await loadAll(); await pickUp(); paint(); });

/* ---------- start ---------- */
await loadAll();
loaded = true;
await pickUp();
setRoute(S.route);
await oo.start(null);
await moveTandem();
await goals.start('off');
setRoute(S.route);
const moved = !ws.embedded && ws.folder.lastMove ? ws.folder.lastMove() : null;
if (moved) ws.toast(`Now saving to the folder "${moved.folder}".`, { kind: 'success' });
if (ws.embedded && S.route.view === 'settings') openSettings('apps');
// On its own page, this site's service worker makes Rapport installable and open offline.
let swReload = null;
ws.on('command', ({ id }) => { if (id === 'sw-reload' && swReload) swReload(); });
if (!ws.embedded && window.WorkshopSw) window.WorkshopSw.register((msg, label, fn) => { swReload = fn; ws.toast(msg, { action: { label, command: 'sw-reload' } }); });
