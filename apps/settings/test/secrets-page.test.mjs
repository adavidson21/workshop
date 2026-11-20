// Settings, Tokens & sign-ins (secrets-page.js) and the Add token dialog (secret-dialog.js): the pure builders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionRows, otherSecrets, pageHtml, stateOf } from '../js/secrets-page.js';
import { dialogHtml, kindWords } from '../js/secret-dialog.js';
import { secretButton, secretState } from '../js/forms.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DATA = {
  store: 'macOS Keychain', platform: 'darwin',
  secrets: [
    { name: 'github', set: true, store: 'macOS Keychain', expires: '2027-01-01', daysLeft: 40, usedBy: [{ connector: 'github' }] },
    { name: 'env-ado-pat', set: true, store: 'macOS Keychain', expires: null, daysLeft: null, usedBy: [] },
    { name: 'linear-signin', set: true, usedBy: [] },
    { name: 'old', set: true, expires: '2026-01-01', daysLeft: -3, usedBy: [] }
  ],
  uses: [
    { connector: 'github', connectorName: 'GitHub', enabled: true, path: 'connections[0].tokenSecret', title: 'Token', kind: 'secret', secretKind: 'token', name: 'github', env: null },
    { connector: 'github', connectorName: 'GitHub', enabled: true, path: 'connections[0].tokenEnv', title: 'Or: token environment variable', kind: 'env', secretKind: 'token', name: 'env-github-pat', env: 'GITHUB_PAT' },
    { connector: 'ado', connectorName: 'Azure DevOps', enabled: true, path: 'connections[0].patEnv', title: 'PAT', kind: 'env', secretKind: 'token', name: 'env-ado-pat', env: 'ADO_PAT' },
    { connector: 'play', connectorName: 'Google Play', enabled: false, path: 'keySecret', title: 'Service account key', kind: 'secret', secretKind: 'key-file', name: 'play', env: null }
  ],
  signins: [{ id: 'linear', name: 'Linear', host: 'mcp.linear.app', secret: 'linear-signin', signedIn: true }]
};

test('stateOf: missing, saved, expiring, expired', () => {
  assert.deepEqual(stateOf(null), { text: 'Not added', tone: 'bad' });
  assert.equal(stateOf({ set: true }).tone, 'ok');
  assert.equal(stateOf({ set: true, daysLeft: 3, expires: 'x' }).text, 'Expires in 3 days');
  assert.equal(stateOf({ set: true, daysLeft: -1, expires: '2026-01-01' }).tone, 'bad');
});

test('connection rows: a variable beside a named token is left out; sign-in keys are not rows', () => {
  const rows = connectionRows(DATA);
  assert.deepEqual(rows.map(r => `${r.connector} ${r.path}`), ['github connections[0].tokenSecret', 'ado connections[0].patEnv', 'play keySecret']);
  assert.equal(rows.find(r => r.connector === 'play').state.text, 'Not added');
  assert.deepEqual(otherSecrets(DATA).map(s => s.name), ['old']);
});

test('the page: Add or Replace by kind, Sign in and out, read-only from a hosted page, and never a value', () => {
  const h = pageHtml(DATA, esc);
  assert.match(h.connections, /Replace token/);
  assert.match(h.connections, /Add key file/);
  assert.match(h.connections, /data-sd-env="ADO_PAT"/);
  assert.match(h.signins, /Sign in again/);
  assert.match(h.others, /data-sd-remove="old"/);
  const ro = pageHtml(DATA, esc, { local: false });
  assert.match(ro.note, /on this computer/);
  assert.equal((ro.connections.match(/data-sd-add/g) || []).length, (ro.connections.match(/ disabled>/g) || []).length - (ro.connections.match(/data-sd-remove/g) || []).length);
});

test('the dialog asks for the right thing for each kind', () => {
  assert.match(dialogHtml({ kind: 'token', name: 'github' }, esc), /type="password"[^>]*data-sd-value/);
  assert.match(dialogHtml({ kind: 'token' }, esc), /data-sd-expires/);
  assert.match(dialogHtml({ kind: 'password' }, esc), /data-sd-again/);
  assert.match(dialogHtml({ kind: 'key-file' }, esc), /type="file"/);
  assert.match(dialogHtml({ kind: 'token', env: 'ADO_PAT' }, esc), /Saved as <code>ADO_PAT<\/code>/);
  assert.match(dialogHtml({ kind: 'token', name: 'gh', replace: true }, esc), /readonly/);
  assert.equal(kindWords('key-file').add, 'Add key file');
});

test('form fields: button words and states', () => {
  assert.equal(secretButton('token', false), 'Add token');
  assert.equal(secretButton('password', true), 'Replace password');
  assert.equal(secretState(null, true).text, 'save to check');
  assert.equal(secretState({ set: false }).text, 'not added yet');
  assert.equal(secretState({ set: true, store: 'macOS Keychain' }).text, 'saved in macOS Keychain');
});
