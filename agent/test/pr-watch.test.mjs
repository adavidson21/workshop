// agent/lib/pr-watch.mjs: the after-Publish watcher's pass, against a stub connector host.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PrWatch, SAME_MS, fingerprint } from '../lib/pr-watch.mjs';

function host({ items, status = {}, fail = {} }) {
  const calls = [];
  return { calls, async call(id, action, body, meta) {
    calls.push({ id, action, args: body.args, confirm: body.confirm, meta });
    if (fail[`${id}.${action}`]) throw Object.assign(new Error(fail[`${id}.${action}`].message), { code: fail[`${id}.${action}`].code });
    if (action === 'published.watch') return { items };
    if (action === 'pr.status') return status[body.args.branch];
    if (action === 'published.record') return { ok: true };
    throw new Error('unexpected');
  } };
}
const items = [{ folder: 'L1-a', id: 'L1', repos: [{ repo: 'web', branch: 'b1', target: 'main', remote: 'https://github.com/acme/web', host: 'github' }, { repo: 'api', branch: 'b2', target: 'main', remote: 'https://ado.example/C/P/_git/api', host: 'ado' }] }];
const st = (over = {}) => ({ found: true, status: 'active', head: 'abc', ci: { state: 'running', checks: [] }, review: 'waiting', conflict: false, threads: [], ...over });

test('a pass asks each host and records each repo; reads are quiet, records are a routine\'s writes', async () => {
  const h = host({ items, status: { b1: st(), b2: st({ ci: { state: 'failed', checks: [] } }) } });
  let now = 1000;
  const w = new PrWatch({ connectors: h, now: () => now });
  assert.equal(await w.tick(), 2);
  assert.deepEqual(h.calls.map(c => `${c.id} ${c.action}`), ['opencode published.watch', 'github pr.status', 'opencode published.record', 'ado pr.status', 'opencode published.record']);
  assert.deepEqual(h.calls[1].args, { remote: 'https://github.com/acme/web', branch: 'b1', target: 'main', logs: true });
  assert.equal(h.calls[1].meta.quiet, true);
  assert.equal(h.calls[2].confirm, true);
  assert.equal(h.calls[2].meta.caller, 'routine');
  assert.equal(h.calls[4].args.status.ci.state, 'failed');
  // Nothing changed: not recorded again until SAME_MS has passed.
  assert.equal(await w.tick(), 0);
  now += SAME_MS;
  assert.equal(await w.tick(), 2);
});

test('a host connector that is off is recorded as an error that says how to fix it; opencode off: nothing', async () => {
  const h = host({ items, status: { b1: st() }, fail: { 'ado.pr.status': { code: 'disabled', message: 'off' } } });
  await new PrWatch({ connectors: h }).tick();
  const rec = h.calls.filter(c => c.action === 'published.record').map(c => c.args);
  assert.equal(rec[1].error, 'Turn on the Azure DevOps connector in Settings to follow this PR.');
  const off = host({ items, fail: { 'opencode.published.watch': { code: 'disabled', message: 'off' } } });
  assert.equal(await new PrWatch({ connectors: off }).tick(), 0);
  assert.equal(off.calls.length, 1);
});

test('the fingerprint ignores the time but sees CI, review, comments and the head', () => {
  assert.equal(fingerprint(st()), fingerprint(st()));
  assert.notEqual(fingerprint(st()), fingerprint(st({ review: 'approved' })));
  assert.notEqual(fingerprint(st()), fingerprint(st({ threads: [{ resolved: false }] })));
  assert.equal(fingerprint({ found: false }), 'none');
});
