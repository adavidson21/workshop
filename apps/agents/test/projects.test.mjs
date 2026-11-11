// Dispatch projects (Dispatch 2.0): a filter on Runs and Ship, a chip on each run, the Projects sheet, and run
// status, on the synthetic fixture plus a `projects` block shaped like the opencode connector's state.projects
// (connectors/opencode/lib/projects.mjs). The filter is kept in this browser (local.js).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { S, resetUi } from '../js/state.js';
import { render, startRequest } from '../js/view.js';
import { projectFilter, inProject, startProject, runStatus, needsReview, runsIn, projectOf, projectChip, projectArgs, projectSheetHtml, projectsSheetHtml, moveSheetHtml, projectFilterHtml, INBOX } from '../js/projects.js';
import { emptyView, cleanView, loadView, saveView, pruneView, VIEW_KEY, OLD_KEY } from '../js/local.js';

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
  S.view = emptyView();
  resetUi();
}
const item = folder => S.D.items.find(i => i.folder === folder);
const memStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };

beforeEach(() => load());

test('no sidebar: Work has project chips with counts, and All projects is the default', () => {
  S.ui.tab = 'work';
  const html = render();
  assert.doesNotMatch(html, /class="side|data-side-/);
  assert.match(html, /<div class="filters" role="group" aria-label="Project">/);
  assert.match(html, /class="fchip on" data-filter-project="all" aria-pressed="true"><span>All projects<\/span><span class="n">4<\/span>/, 'everything on Work: what is in the Inbox is not');
  assert.match(html, /data-filter-project="orders-api"[^>]*>.*?<span>Orders API<\/span><span class="n">1<\/span>/, '41300 waits in the Inbox');
  assert.match(html, /data-filter-project="billing"[^>]*>.*?<span>Billing<\/span><span class="n">1</, 'the Billing TSD is on Work too');
});

test('Needs you lists runs waiting on you across all projects, newest first', () => {
  const needs = needsReview().map(i => i.folder);
  assert.deepEqual(needs.sort(), ['41300-export-retry-fails', '41502-csv-export']);
});

test('a run with no project is in Inbox; the filter narrows Work and seeds Start work', () => {
  assert.equal(projectOf(item('41455-audit-log-filter')), INBOX);
  assert.equal(projectOf(item('tsd-billing-api')), 'billing');
  assert.deepEqual(runsIn('orders-api').map(i => i.folder).sort(), ['41207-fix-login-timeout', '41300-export-retry-fails']);
  S.view.project = 'orders-api';
  assert.equal(startProject(), 'orders-api');
  assert.ok(inProject(item('41207-fix-login-timeout')));
  assert.ok(!inProject(item('41455-audit-log-filter')));
  S.ui.tab = 'work';
  const html = render();
  assert.match(html, /id="item-41207"/);
  assert.doesNotMatch(html, /id="item-41455"/, 'Inbox run hidden');
  assert.match(html, /class="fchip on" data-filter-project="orders-api"/);
});

test('a filter for a project that is gone falls back to all projects', () => {
  S.view.project = 'deleted';
  assert.equal(projectFilter(), 'all');
  assert.equal(startProject(), INBOX);
  assert.equal(pruneView(S.view, new Set(['orders-api'])), true);
  assert.equal(S.view.project, 'all');
  assert.equal(pruneView(S.view, new Set(['orders-api'])), false);
});

test('an empty project says so', () => {
  S.D.projects.projects.push({ id: 'empty', name: 'Empty', color: 'rose' });
  S.view.project = 'empty';
  S.ui.tab = 'work';
  assert.match(render(), /Nothing here with these filters\./);
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
  assert.deepEqual(startRequest({ flow: 'quick', lane: 'feature', project: 'orders-api' }, drafts).args, { title: 'Add retries', lane: 'feature', project: 'orders-api' });
  assert.deepEqual(startRequest({ flow: 'quick', lane: 'feature', project: INBOX }, drafts).args, { title: 'Add retries', lane: 'feature' });
  S.D.tandem = { ado: true };
  assert.deepEqual(startRequest({ flow: 'bug', src: 'ado', project: 'billing' }, { 'start:id': '123' }).args, { id: '123', lane: 'bug', project: 'billing' });
});

test('the start sheet picks a project when there are any', () => {
  S.ui.start = { flow: 'quick', lane: 'feature', project: 'billing', busy: false, error: null };
  const html = render();
  assert.match(html, /<select data-start-project="1">/);
  assert.match(html, /<option value="billing" selected>Billing<\/option>/);
});

test('an older connector with no projects: everything in Inbox, no project controls', () => {
  load({ projects: false });
  assert.equal(projectFilterHtml(S.D.items), '');
  load();
  S.D.projects.projects = S.D.projects.projects.filter(p => p.builtIn);
  S.D.projects.runs = {};
  assert.equal(projectFilterHtml(S.D.items), '', 'only the built-in project: no filter');
  assert.equal(projectChip(item('41207-fix-login-timeout')), '', 'and no chips');
  load({ projects: false });
  assert.equal(projectChip(item('41207-fix-login-timeout')), '');
  assert.equal(projectOf(item('41207-fix-login-timeout')), INBOX);
  S.ui.menu = { kind: 'more', top: 0, right: 0 };
  assert.doesNotMatch(render(), /data-projects-open/);
  S.ui.menu = null;
  S.ui.start = { flow: 'quick', lane: 'feature', project: INBOX, busy: false, error: null };
  assert.doesNotMatch(render(), /data-start-project/);
});

test('each run shows its project and opens the move sheet', () => {
  assert.match(projectChip(item('41207-fix-login-timeout')), /data-move="41207-fix-login-timeout"[^>]*>.*Orders API/);
  S.ui.move = { folder: '41207-fix-login-timeout', busy: false, error: null };
  const sheet = moveSheetHtml();
  assert.match(sheet, /data-move-to="orders-api" disabled>.*Here now/);
  assert.match(sheet, /data-move-to="inbox">/);
});

test('the Projects sheet lists each project with its runs, Edit, and New project', () => {
  S.ui.menu = { kind: 'more', top: 0, right: 0 };
  assert.match(render(), /data-projects-open="1">Projects</);
  S.ui.menu = null; S.ui.projects = true;
  const html = projectsSheetHtml();
  assert.match(html, /<h3 id="projs-h">Projects<\/h3>/);
  assert.match(html, /Orders API<\/span><span class="dim">2 runs<\/span><span class="mono dim">orders-api<\/span><button type="button" class="btn" data-proj-edit="orders-api">Edit/);
  assert.match(html, /No project<\/span><span class="dim">\d runs?<\/span><span class="dim">Built in<\/span>/, 'the built-in project is not called Inbox, next to the Inbox tab');
  assert.match(html, /data-proj-new="1">New project/);
  assert.match(render(), /<h3 id="projs-h">Projects<\/h3>/);
});

test('project sheet: create sends only what was typed; edit sends only what changed', () => {
  assert.deepEqual(projectArgs({ color: 'teal' }, { 'proj:name': '  Search  ' }, null), { args: { name: 'Search', color: 'teal' } });
  assert.match(projectArgs({}, {}, null).error, /name/);
  assert.match(projectArgs({}, { 'proj:name': 'x', 'proj:baseBranch': 'bad branch' }, null).error, /branch/);
  const cur = PROJECTS.projects[1];
  assert.deepEqual(projectArgs({ color: 'blue' }, {}, cur), { args: { id: 'orders-api' } });
  assert.deepEqual(projectArgs({ color: 'red' }, { 'proj:instructions': 'Lint first.' }, cur), { args: { id: 'orders-api', color: 'red', instructions: 'Lint first.' } });
  S.ui.project = { id: 'orders-api', color: 'blue', busy: false, error: null, confirmDelete: true };
  assert.match(projectSheetHtml(), /Remove, 2 runs to No project/);
  assert.doesNotMatch(projectSheetHtml(), /Folder/, 'no folders in 2.0');
});

test('view prefs: only the project filter; bad storage gives the defaults; the 1.x sidebar key is removed', () => {
  assert.deepEqual(cleanView({ project: 'orders-api', folders: [1] }), { project: 'orders-api' });
  assert.deepEqual(cleanView({ project: 'bad id!' }), emptyView());
  assert.deepEqual(cleanView('nope'), emptyView());
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadView(throwing), emptyView());
  assert.equal(saveView(throwing, { project: 'x' }), false);
  const ms = memStorage();
  ms.m.set(OLD_KEY, '{"folders":[],"pins":[]}');
  ms.m.set(VIEW_KEY, '{not json');
  assert.deepEqual(loadView(ms), emptyView());
  assert.equal(ms.m.has(OLD_KEY), false, 'the old sidebar state is gone');
  assert.ok(saveView(ms, { project: 'billing' }));
  assert.deepEqual(loadView(ms), { project: 'billing' });
});

test('project names are escaped', () => {
  S.D.projects.projects.push({ id: 'x', name: '<img src=x onerror=alert(1)>', color: 'red' });
  S.D.projects.runs['41455-audit-log-filter'] = 'x';
  S.ui.tab = 'work';
  assert.doesNotMatch(render(), /<img src=x/);
  assert.doesNotMatch(projectsSheetHtml(), /<img src=x/);
});

test('Chat is its own tab: a slot for chat.js, and no runs in it', () => {
  S.ui.tab = 'chat';
  const html = render();
  assert.match(html, /<div class="page" data-page="chat"><div id="chat-slot"><\/div><\/div>/);
  assert.doesNotMatch(html, /id="item-/, 'automated runs never show on the Chat tab');
});
