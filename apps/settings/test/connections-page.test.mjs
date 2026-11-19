// Settings, Connections manager and Routines: the pure HTML and rows (js/connections-page.js, js/routines-page.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityHtml, approvalsHtml, connectionRows, hostsOf, overviewHtml } from '../js/connections-page.js';
import { fromForm, routinesHtml, scheduleWords } from '../js/routines-page.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

test('All connections: what each reaches, where its token is and when it ends, last use, what Tandem may do', () => {
  assert.deepEqual(hostsOf({ apiUrl: 'https://api.cloudflare.com/client/v4', list: [{ url: 'https://mcp.example/mcp' }], other: 'x' }).sort(), ['api.cloudflare.com', 'mcp.example']);
  const list = [
    { id: 'cloudflare', name: 'Cloudflare', enabled: true, status: { state: 'ready' }, actions: [{ name: 'dns.list', agent: true, write: false }, { name: 'changes.apply', agent: 'ask', write: true }] },
    { id: 'github', name: 'GitHub', enabled: true, status: { state: 'error', message: 'Secret "github" is not set.' }, actions: [] },
    { id: 'opencode', name: 'opencode', enabled: false, status: { state: 'stopped' }, actions: [] }
  ];
  const views = {
    cloudflare: { config: { apiUrl: 'https://api.cloudflare.com/client/v4' }, env: {}, secrets: { cloudflare: { set: true, store: 'macOS Keychain', expires: '2027-02-01', daysLeft: 70 } } },
    github: { config: { connections: [{ apiUrl: 'https://api.github.com' }] }, env: { GITHUB_PAT: { set: false } }, secrets: { github: { set: false, store: null, expires: null, daysLeft: null } } }
  };
  const rows = connectionRows(list, views, { cloudflare: '2026-11-19T15:00:00Z' });
  assert.deepEqual(rows[0].tokens, [{ label: 'Secret cloudflare', ok: true, note: 'in macOS Keychain, until 2027-02-01' }]);
  assert.equal(rows[0].agentReads, 1);
  assert.equal(rows[0].agentAsks, 1);
  assert.deepEqual(rows[1].tokens.map(t => t.ok), [false, false]);
  const html = overviewHtml(rows, [{ id: 'gh', name: 'GitHub MCP', host: 'api.githubcopilot.com', tokenSecret: 'gh-mcp', tools: 40, readOnly: 25 }], esc, { now: Date.parse('2026-11-19T16:00:00Z') });
  assert.match(html, /Reaches <code>api\.cloudflare\.com<\/code>/);
  assert.match(html, /Last used 1 h ago/);
  assert.match(html, /Tandem may read \(1\) and ask to change \(1\)/);
  assert.match(html, /Stays on this computer/);
  assert.match(html, /40 tools, 25 read-only/);
  assert.match(html, /data-goto-page="c-mcp"/);
});

test('Approvals: lines from the request, approve with its digest, always-allow only on this computer', () => {
  const a = { id: 'ap-20261119-0000000a', status: 'waiting', title: 'Cloudflare: <App>', by: 'agent', requested: '2026-11-19T15:00:00Z', connectorName: 'Cloudflare', actionTitle: 'Apply a change set on Cloudflare', lines: ['1. Add DNS A record'], scopes: ['example.org'], digest: 'd'.repeat(64) };
  const html = approvalsHtml([a, { ...a, id: 'ap-20261119-0000000b', status: 'failed', error: 'HTTP 403', decided: '2026-11-19T15:05:00Z' }], [{ id: 'r-00000001', connector: 'cloudflare', action: 'changes.apply', scopes: ['example.org'], label: 'Cloudflare: Apply', created: '2026-11-19T15:00:00Z' }], esc);
  assert.match(html, /Cloudflare: &lt;App&gt;/);
  assert.match(html, /Tandem asked/);
  assert.match(html, /data-digest="d{64}"/);
  assert.match(html, /Always allow Cloudflare to apply a change set on cloudflare for example\.org/);
  assert.match(html, /data-ap-unrule="r-00000001"/);
  assert.match(html, /HTTP 403/);
  const hosted = approvalsHtml([a], [], esc, { local: false });
  assert.doesNotMatch(hosted, /data-ap-always/);
  assert.match(hosted, /from Workshop on this computer/);
  assert.match(approvalsHtml([{ ...a, problem: 'Cloudflare is off.' }], [], esc), /data-ap-approve="ap-20261119-0000000a" disabled/);
  assert.match(approvalsHtml([], [], esc), /Nothing waiting/);
});

test('Activity: who, what and how it went; never arguments', () => {
  const html = activityHtml([{ at: '2026-11-19T15:00:00Z', by: 'agent', connector: 'cloudflare', action: 'dns.list', kind: 'read', ok: true }, { at: '2026-11-19T15:01:00Z', by: 'rule', connector: 'cloudflare', action: 'changes.apply', kind: 'write', ok: false, error: 'HTTP 403' }], esc);
  assert.match(html, /Tandem<\/td><td>Read: <code>dns\.list/);
  assert.match(html, /Always-allow rule<\/td><td>Changed: <code>changes\.apply/);
  assert.match(html, /<tr class="bad">/);
  assert.match(activityHtml([], esc), /Nothing yet/);
});

test('Routines: schedule in words, next and last run, and a form only on this computer', () => {
  assert.equal(scheduleWords({ days: 'weekdays', time: '08:30' }), 'Weekdays at 08:30');
  const view = { routines: [{ id: 'rt-0000000a', name: 'Check', run: '/cloudflare why workshop', schedule: { days: 'daily', time: '07:00' }, enabled: true, next: '2026-11-20T12:00:00Z', lastRun: { at: '2026-11-19T12:00:00Z', ok: false, error: 'opencode is not connected.' } }], runs: [{ at: '2026-11-19T12:00:00Z', name: 'Check', how: 'schedule', ok: true }], catchUpHours: 6 };
  const html = routinesHtml(view, esc);
  assert.match(html, /Every day at 07:00/);
  assert.match(html, /opencode is not connected/);
  assert.match(html, /data-rt-run="rt-0000000a"/);
  assert.match(html, /Add routine/);
  assert.match(html, /at most 6 hours late/);
  assert.doesNotMatch(routinesHtml(view, esc, { local: false }), /data-rt-run|<form/);
  assert.match(routinesHtml(view, esc, { editing: view.routines[0] }), /data-id="rt-0000000a"[\s\S]*data-rt-delete/);
  const f = { elements: { name: { value: ' N ' }, run: { value: '/standup' }, agent: { value: '' }, days: { value: 'mon' }, time: { value: '09:15' }, enabled: { checked: false } } };
  assert.deepEqual(fromForm(f, 'rt-0000000b'), { id: 'rt-0000000b', name: 'N', run: '/standup', schedule: { days: 'mon', time: '09:15' }, enabled: false });
});
