// Loom with Azure DevOps off (shared/ado.js): the floor, the flows, the board's cards and its panel name it nowhere.
// The other tests run with ADO on.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setAdo } from '../../../shared/ado.js';
import { S, resetUi } from '../js/dispatch/state.js';
import { lanesHtml } from '../js/dispatch/lanes.js';
import { FLOWS, setFlowsAdo, flowById } from '../js/dispatch/flows.js';
import { adoLinkHtml, adoNoticeHtml } from '../js/dispatch/factory.js';
import { setPickable } from '../js/loom.js';
import { panelHtml, nextOf, boardHtml, delegateDialogHtml } from '../js/view.js';
import { cleanItem, newItem, cleanPrefs, shapeState } from '../js/model.js';
import { healthHtml } from '../js/health.js';

const ADO = /\bADO\b|Azure DevOps/;
const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/state.json', import.meta.url), 'utf8'));
const strip = html => html.replace(/<[^>]*\bdata-ado-only\b[^>]*>[\s\S]*?<\/section>/g, '').replace(/<[^>]+>/g, ' ');
const visible = html => strip(html) + ' ' + [...html.matchAll(/(?:title|placeholder|aria-label)="([^"]*)"/g)].map(m => m[1]).join(' ');

beforeEach(() => {
  setAdo(false); setFlowsAdo(false);
  S.D = JSON.parse(JSON.stringify(FIXTURE));
  S.D.adoNotice = { count: 6 };
  S.D.tandem = { ...(S.D.tandem || {}), ado: true };
  S.L = S.D.liveMode.live;
  S.conn = 'on'; S.connector = { state: 'ready', message: null };
  S.mode = 'local'; S.embedded = true; S.now = Date.parse('2026-10-21T12:00:00Z');
  S.today = '2026-10-21'; S.yest = '2026-10-20'; S.copyStore = []; S.files = {}; S.slate = new Map();
  resetUi(); S.ui.tab = 'lanes'; S.view = { project: 'all', lanes: 'list' };
});

test('the floor: no notice, no ADO number in the drop box, no From ADO, no link rows', () => {
  setPickable([{ id: 41001, title: 'Backlog item', type: 'User Story' }]);
  S.ui.drafts['lanes:drop'] = '41001'; S.ui.dropAdo = { id: 41001 };
  const html = lanesHtml();
  assert.ok(!ADO.test(visible(html)), visible(html).match(new RegExp('.{0,60}(' + ADO.source + ').{0,60}'))?.[0]);
  assert.equal(adoNoticeHtml(), '');
  assert.equal(adoLinkHtml(S.D.items[0], true), '');
  setAdo(true);
  assert.match(adoNoticeHtml(), /no longer updates ADO/);
});

test('every flow and step says nothing about ADO while it is off, and its own words again when on', () => {
  for (const f of FLOWS) {
    assert.ok(!ADO.test(f.when), `${f.id}: ${f.when}`);
    for (const s of f.steps || []) assert.ok(!ADO.test(s.name + ' ' + s.what), `${f.id}.${s.key}: ${s.name} ${s.what}`);
  }
  assert.equal(flowById('epic').steps.at(-1).name, 'Create the stories');
  setFlowsAdo(true);
  assert.equal(flowById('epic').steps.at(-1).name, 'Create in ADO');
  setFlowsAdo(false);
});

test('a board item with an ADO link reads as a local one, in its card, panel and next step', () => {
  const it = cleanItem({ ...newItem({ title: 'Export orders' }), ado: { id: 41207, url: 'https://ado.example.com/x/41207', connection: 'Main', type: 'User Story' }, stage: 'dev' });
  const p = { item: it, dev: true, files: {}, draft: { kind: null }, editing: false, shapeEditing: null, shape: shapeState({}), back: [], forward: [], triage: null,
    agent: null, column: 'merged', run: null, assigneeName: '', owners: [], age: 0, details: null, prefs: cleanPrefs(), error: '', canAdo: false, canLocal: true, timeline: [] };
  for (const column of ['merged', 'review', 'build', 'resolved', 'done']) {
    const html = panelHtml({ ...p, column });
    assert.ok(!ADO.test(visible(html)), `${column}: ` + visible(html).match(new RegExp('.{0,60}(' + ADO.source + ').{0,60}'))?.[0]);
    const n = nextOf({ ...p, column });
    assert.ok(!ADO.test(visible([n.text || '', ...(n.shown || []), ...(n.more || [])].join(' '))), column);
  }
  const board = boardHtml([{ key: 'build', title: 'Build', cards: [{ ...it, noAdo: true }] }], { open: null, noAdo: false });
  assert.ok(!ADO.test(visible(board)));
  assert.ok(!ADO.test(visible(delegateDialogHtml([], { canBrief: true, canAssign: true }))));
});

test('Health hides Sprints and Team reports (they need ADO)', () => {
  const html = healthHtml({ cols: {}, oldest: [], load: {}, toDecision: { median: null }, toResolved: null });
  assert.ok(!ADO.test(visible(html)));
});
