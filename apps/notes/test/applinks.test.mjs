import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appHref, appLink, appRefs } from '../js/applinks.js';
import { render } from '../js/markdown.js';
import { buildIndex } from '../js/model.js';

test('ws: links name an app and a route, and nothing else', () => {
  assert.deepEqual(appLink('ws:prioritizer/task/t_k2f9'), { app: 'prioritizer', path: 'task/t_k2f9' });
  assert.deepEqual(appLink('ws:runway'), { app: 'runway', path: '' });
  for (const bad of ['ws:Prioritizer/x', 'ws:prioritizer/../x', 'ws:a/b?c=1', 'ws:a/<script>', 'ws://evil.com', 'javascript:alert(1)', 'ws:a/b c', '']) assert.equal(appLink(bad), null, bad);
  assert.equal(appHref('receipts', 'team/p_1'), 'ws:receipts/team/p_1');
  assert.throws(() => appHref('receipts', '../x'), RangeError);
});

test('the renderer shows ws: links as chips with the app name, escaped', () => {
  const html = render('[Fix "it"](ws:prioritizer/task/t_1)', { appName: (id) => (id === 'prioritizer' ? 'Docket' : id) });
  assert.match(html, /<a href="#" class="app-link" data-app="prioritizer" data-app-path="task\/t_1" title="Open in Docket">Fix &quot;it&quot;<span class="app-chip">Docket<\/span><\/a>/);
  assert.doesNotMatch(render('[x](ws:a/../b)'), /app-link/);
});

test('appRefs: which notes link to which app records', () => {
  const ix = buildIndex([
    { path: 'a.md', content: '# A\n\nSee [t](ws:prioritizer/task/t_1) and [r](ws:runway)', mtime: 2 },
    { path: 'b.md', content: '# B\n\n[t](ws:prioritizer/task/t_1)\n\n`[no](ws:runway)`', mtime: 1 }
  ]);
  const refs = appRefs(new Map([...ix.notes].map(([p, n]) => [p, { links: n.appLinks }])));
  assert.deepEqual(refs.get('prioritizer/task/t_1').map(r => r.from), ['a.md', 'b.md']);
  assert.deepEqual(refs.get('runway').map(r => r.from), ['a.md']);
});
