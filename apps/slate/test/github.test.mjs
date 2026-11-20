// Loom with GitHub team areas: calls route to the GitHub connector by connection (a repo), the board reads only the
// groups whose connector is ready, and GitHub cards say GitHub on their buttons, marks and dialogs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectorState, trackerOf, ado } from '../js/data.js';
import { nextOf, panelHtml, publishDialogHtml } from '../js/view.js';
import { cleanItem, cleanPrefs, newItem, shapeState } from '../js/model.js';
import { setAdo } from '../../../shared/ado.js';
// These checks are written for Azure DevOps on; no-ado.test.mjs covers it off.
setAdo(true);

const base = (item, extra = {}) => ({
  item, dev: false, files: {}, draft: { kind: null }, editing: false, shapeEditing: null, shape: shapeState({}), back: [], triage: null,
  agent: null, column: 'new', run: null, assigneeName: '', owners: [], age: 0, details: null, prefs: cleanPrefs(), error: '', ...extra
});
const card = (connection, extra = {}) => cleanItem({ ...newItem({ title: 'x' }), stage: 'triaged', ado: { id: 42, type: 'User Story', url: 'https://github.com/acme/web/issues/42', connection }, ...extra });
const fakeWs = (states) => ({
  backend: 'agent',
  calls: [],
  connectors: {
    list: async () => Object.entries(states).map(([id, state]) => ({ id, enabled: state !== 'off', status: { state: state === 'off' ? 'disabled' : state, message: state === 'error' ? `${id} needs a token` : null } })),
    async call(id, action, args) { this.owner.calls.push([id, action, args]); return { ok: true }; }
  }
});

test('a repo connection goes to GitHub; an ADO connection name or none goes to ADO', async () => {
  assert.equal(trackerOf({ connection: 'acme/web' }), 'github');
  assert.equal(trackerOf({ connection: 'work' }), 'ado');
  assert.equal(trackerOf({}), 'ado');
  const ws = fakeWs({});
  ws.connectors.owner = ws;
  await ado(ws, 'workitem.get', { id: 42, connection: 'acme/web' });
  await ado(ws, 'workitem.get', { id: 42, connection: 'work' });
  assert.deepEqual(ws.calls.map(c => c[0]), ['github', 'ado']);
});

test('connector state: either tracker ready makes the board ready; each is reported on its own', async () => {
  const gh = await connectorState(fakeWs({ ado: 'off', github: 'ready', opencode: 'ready' }));
  assert.equal(gh.ado, true);
  assert.equal(gh.github, true);
  assert.match(gh.adoOnly, /Turn on the Azure DevOps connector/);
  const none = await connectorState(fakeWs({ ado: 'off', github: 'error' }));
  assert.match(none.ado, /Turn on the Azure DevOps connector/);
  assert.equal(none.github, 'github needs a token');
  const browser = await connectorState({ backend: 'browser' });
  assert.match(browser.github, /GitHub/);
});

test('a GitHub card: Post on, Open in and Resolved say GitHub and carry the GitHub mark; an ADO card is unchanged', () => {
  const triage = { summary: 's', route: 'delegate', size: 'S', repos: [], questions: ['q1'] };
  const gh = nextOf(base(card('acme/web'), { column: 'triage', triage, canLocal: true, canAdo: true }));
  assert.match(gh.shown[0], />Post on #42 <span class="out-mark" data-out="github"/);
  assert.match(gh.shown[0], /comment on the GitHub item/);
  const adoCard = nextOf(base(card('work'), { column: 'triage', triage, canLocal: true, canAdo: true }));
  assert.match(adoCard.shown[0], /data-out="ado"/);
  const panel = panelHtml(base(card('acme/web')));
  assert.match(panel, /#42 in GitHub<\/a>/);
  assert.doesNotMatch(panel, /in ADO<\/a>/);
});

test('publishing into a repo says GitHub', () => {
  const plan = [{ ref: 'item', op: 'create', type: 'User Story', title: 'T', fields: { description: 'd' } }];
  const h = publishDialogHtml(plan, { area: 'github:acme/web', connection: 'acme/web' });
  assert.match(h, /<h2>Publish to GitHub<\/h2>/);
  assert.match(h, /in acme\/web/);
  assert.match(h, /data-out="github"/);
  assert.match(publishDialogHtml(plan, { area: 'Proj\\Team', connection: 'work' }), /<h2>Publish to ADO<\/h2>/);
});
