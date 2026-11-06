// Dispatch sidebar (Dispatch App Experience Plan, P2): projects, folders, pins, Needs you and run status,
// on the synthetic fixture plus a `projects` block shaped like the opencode connector's state.projects
// (connectors/opencode/lib/projects.mjs). Folders and pins are browser-only state (local.js).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { S, resetUi } from '../js/state.js';
import { render, startRequest } from '../js/view.js';
import { sidebarHtml, scopeHeadHtml, inScope, scope, scopeProject, runStatus, needsReview, runsIn, projectOf, projectChip, projectArgs, projectSheetHtml, moveSheetHtml, INBOX } from '../js/sidebar.js';
import { emptyLocal, cleanLocal, loadLocal, saveLocal, addFolder, renameFolder, removeFolder, placeProject, togglePin, isPinned, toggleClosed, pruneLocal, LOCAL_KEY } from '../js/local.js';

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/state.json', import.meta.url), 'utf8'));
const clone = v => JSON.parse(JSON.stringify(v));
const PROJECTS = {
  inbox: INBOX,
  colors: ['slate', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'rose', 'violet'],
  projects: [
    { id: INBOX, name: 'Inbox', color: 'slate', builtIn: true },
    { id: 'orders-api', name: 'Orders API', color: 'blue', repo: 'orders-api', baseBranch: 'main', instructions: 'Run npm test.' },
    { id: 'billing', name: 'Billing', color: 'teal' }
  ],
  runs: { '41207-fix-login-timeout': 'orders-api', '41300-export-retry-fails': 'orders-api', 'tsd-billing-api': 'billing' }
};

function load({ projects = true } = {}) {
  S.D = clone(FIXTURE);
  if (projects) S.D.projects = clone(PROJECTS);
  S.L = S.D.liveMode.live;
  S.conn = 'on';
  S.connector = { state: 'ready', message: null };
  S.mode = 'local';
  S.embedded = true;
  S.now = Date.parse('2026-10-21T12:00:00Z');
  S.today = '2026-10-21'; S.yest = '2026-10-20';
  S.copyStore = [];
  S.local = emptyLocal();
  resetUi();
}
const item = folder => S.D.items.find(i => i.folder === folder);
const memStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

beforeEach(() => load());

test('the page has the sidebar beside the list, with Start work, Needs you and every project', () => {
  const html = render();
  assert.match(html, /<div class="layout"><nav class="side"/);
  assert.match(html, /class="btn primary new-run" data-start-open="1"/);
  assert.match(html, /data-side-scope="needs"><span class="sl">Needs you<\/span><span class="cnt">2<\/span>/);
  for (const p of PROJECTS.projects) assert.match(html, new RegExp(`data-side-id="${p.id}"`), p.id);
  // runs under their project, with a status dot
  const side = sidebarHtml();
  assert.match(side, /data-side-run="41207-fix-login-timeout"/);
  assert.match(side, /class="sd review"/);
  assert.doesNotMatch(side, /<h3 id="sh-pin">/, 'no Pinned section until something is pinned');
});

test('Needs you lists runs waiting on you across all projects, newest first', () => {
  const needs = needsReview().map(i => i.folder);
  assert.deepEqual(needs.sort(), ['41300-export-retry-fails', '41502-csv-export']);
  S.ui.scope = { kind: 'needs' };
  assert.ok(inScope(item('41502-csv-export')), 'Inbox run that needs you');
  assert.ok(inScope(item('41300-export-retry-fails')), 'project run that needs you');
  assert.ok(!inScope(item('41207-fix-login-timeout')));
  assert.match(scopeHeadHtml(), /2 runs waiting on you, across all projects/);
});

test('a run with no project is in Inbox; a project scope filters the list and seeds Start work', () => {
  assert.equal(projectOf(item('41455-audit-log-filter')), INBOX);
  assert.equal(projectOf(item('tsd-billing-api')), 'billing');
  assert.deepEqual(runsIn('orders-api').map(i => i.folder).sort(), ['41207-fix-login-timeout', '41300-export-retry-fails']);
  S.ui.scope = { kind: 'project', id: 'orders-api' };
  assert.equal(scopeProject(), 'orders-api');
  const html = render();
  assert.match(html, /id="item-41207"/);
  assert.doesNotMatch(html, /id="item-41455"/, 'Inbox run hidden');
  assert.match(html, /<h2>Orders API<\/h2>/);
  assert.match(html, /<span class="mono">orders-api<\/span>/);
  assert.doesNotMatch(html, /Pick up here/, 'Pick up here belongs to All runs');
});

test('a scope for a project that is gone falls back to All runs', () => {
  S.ui.scope = { kind: 'project', id: 'deleted' };
  assert.deepEqual(scope(), { kind: 'all' });
  assert.equal(scopeProject(), INBOX);
});

test('an empty project says so and offers Start work', () => {
  S.D.projects.projects.push({ id: 'empty', name: 'Empty', color: 'rose' });
  S.ui.scope = { kind: 'project', id: 'empty' };
  assert.match(render(), /No runs in this project yet\./);
});

test('run status: needs review, ready to ship, paused, up next', () => {
  assert.equal(runStatus(item('41502-csv-export')), 'review');
  assert.equal(runStatus(item('41610-rate-limit-headers')), 'done');
  assert.equal(runStatus(item('41455-audit-log-filter')), 'paused');
  const blocked = Object.assign(clone(item('41455-audit-log-filter')), { blocked: true });
  assert.equal(runStatus(blocked), 'failed');
});

test('starting from a project sends it; from Inbox it does not', () => {
  const drafts = { 'start:title': 'Add retries' };
  assert.deepEqual(startRequest({ mode: 'describe', lane: 'feature', project: 'orders-api' }, drafts).args, { title: 'Add retries', lane: 'feature', project: 'orders-api' });
  assert.deepEqual(startRequest({ mode: 'describe', lane: 'feature', project: INBOX }, drafts).args, { title: 'Add retries', lane: 'feature' });
  assert.deepEqual(startRequest({ mode: 'ado', lane: 'bug', project: 'billing' }, { 'start:id': '123' }).args, { id: '123', lane: 'bug', project: 'billing' });
});

test('the start sheet picks a project when there are any', () => {
  S.ui.start = { mode: 'describe', lane: 'feature', project: 'billing', busy: false, error: null };
  const html = render();
  assert.match(html, /<select data-start-project="1">/);
  assert.match(html, /<option value="billing" selected>Billing<\/option>/);
});

test('an older connector with no projects: everything in Inbox, no project controls', () => {
  load({ projects: false });
  const side = sidebarHtml();
  assert.match(side, /Update Workshop to group runs into projects\./);
  assert.doesNotMatch(side, /data-proj-new/);
  assert.equal(projectChip(item('41207-fix-login-timeout')), '');
  assert.equal(projectOf(item('41207-fix-login-timeout')), INBOX);
  S.ui.start = { mode: 'describe', lane: 'feature', project: INBOX, busy: false, error: null };
  assert.doesNotMatch(render(), /data-start-project/);
});

test('each run card shows its project and opens the move sheet', () => {
  assert.match(projectChip(item('41207-fix-login-timeout')), /data-move="41207-fix-login-timeout"[^>]*>.*Orders API/);
  S.ui.move = { folder: '41207-fix-login-timeout', busy: false, error: null };
  const sheet = moveSheetHtml();
  assert.match(sheet, /data-move-to="orders-api" disabled>.*Here now/);
  assert.match(sheet, /data-move-to="inbox">/);
});

test('project sheet: create sends only what was typed; edit sends only what changed', () => {
  assert.deepEqual(projectArgs({ color: 'teal' }, { 'proj:name': '  Search  ' }, null), { args: { name: 'Search', color: 'teal' } });
  assert.match(projectArgs({}, {}, null).error, /name/);
  assert.match(projectArgs({}, { 'proj:name': 'x', 'proj:baseBranch': 'bad branch' }, null).error, /branch/);
  const cur = PROJECTS.projects[1];
  assert.deepEqual(projectArgs({ color: 'blue' }, {}, cur), { args: { id: 'orders-api' } });
  assert.deepEqual(projectArgs({ color: 'red' }, { 'proj:instructions': 'Lint first.' }, cur), { args: { id: 'orders-api', color: 'red', instructions: 'Lint first.' } });
  S.ui.project = { id: 'orders-api', color: 'blue', busy: false, error: null, confirmDelete: true };
  assert.match(projectSheetHtml(), /Remove, move 2 runs to Inbox/);
});

test('folders group projects; pins show above; both live in this browser only', () => {
  const f = addFolder(S.local, 'Platform');
  assert.ok(f.id);
  placeProject(S.local, 'billing', f.id);
  togglePin(S.local, 'run', '41502-csv-export');
  togglePin(S.local, 'project', 'orders-api');
  const side = sidebarHtml();
  assert.match(side, /<h3 id="sh-pin">Pinned<\/h3>/);
  assert.match(side, /class="sfolder">.*Platform.*data-side-id="billing"/s);
  assert.match(side, /aria-label="Unpin #41502 /);
  toggleClosed(S.local, f.id);
  assert.doesNotMatch(sidebarHtml(), /class="sfolder">[^]*data-side-id="billing"/, 'collapsed folder hides its projects');
  removeFolder(S.local, f.id);
  assert.deepEqual(S.local.placement, {});
  assert.ok(isPinned(S.local, 'project', 'orders-api'));
});

test('local state: validates names, survives bad storage, prunes what is gone', () => {
  const st = emptyLocal();
  assert.match(addFolder(st, '  ').error, /name/);
  const { id } = addFolder(st, 'A');
  assert.match(renameFolder(st, 'f-nope', 'B').error, /gone/);
  renameFolder(st, id, 'B');
  assert.equal(st.folders[0].name, 'B');
  const cleaned = cleanLocal({ folders: [{ id, name: 'B' }, { id: 'bad id', name: 'x' }, { id, name: 'dupe' }], placement: { p: id, q: 'f-missing' }, pins: [{ kind: 'run', id: 'r' }, { kind: 'run', id: 'r' }, { kind: 'x', id: 'y' }], closed: { a: true, b: 1 } });
  assert.deepEqual(cleaned, { folders: [{ id, name: 'B' }], placement: { p: id }, pins: [{ kind: 'run', id: 'r' }], closed: { a: true } });
  assert.deepEqual(cleanLocal('nope'), emptyLocal());
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadLocal(throwing), emptyLocal());
  assert.equal(saveLocal(throwing, st), false);
  const ms = memStorage();
  ms.m.set(LOCAL_KEY, '{not json');
  assert.deepEqual(loadLocal(ms), emptyLocal());
  assert.ok(saveLocal(ms, cleaned));
  assert.deepEqual(loadLocal(ms), cleaned);
  cleaned.pins.push({ kind: 'project', id: 'gone' });
  assert.equal(pruneLocal(cleaned, new Set(['p']), new Set(['r'])), true);
  assert.deepEqual(cleaned.pins, [{ kind: 'run', id: 'r' }]);
  assert.equal(pruneLocal(cleaned, new Set(['p']), new Set(['r'])), false);
});

test('sidebar text is escaped', () => {
  S.D.projects.projects.push({ id: 'x', name: '<img src=x onerror=alert(1)>', color: 'red' });
  assert.doesNotMatch(sidebarHtml(), /<img src=x/);
  addFolder(S.local, '<b>f</b>');
  assert.doesNotMatch(sidebarHtml(), /<b>f<\/b>/);
});

test('Chat is its own page: a Conversations entry in the sidebar, a slot for chat.js, and no runs in it', () => {
  assert.match(sidebarHtml(), /<h3 id="sh-talk">Conversations<\/h3>.*data-side-scope="chat"/s);
  S.ui.scope = { kind: 'chat' };
  const html = render();
  assert.match(html, /<div class="solo"><div id="chat-slot"><\/div><\/div>/);
  assert.match(sidebarHtml(), /class="srow chatrow on" data-side-scope="chat"/);
  assert.doesNotMatch(html, /id="item-/, 'automated runs never show on the Chat page');
  assert.equal(inScope(item('41207-fix-login-timeout')), false);
  assert.equal(scopeHeadHtml(), '');
});
