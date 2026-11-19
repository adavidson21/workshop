// Settings, Cloudflare: the change sets list (js/cloudflare-page.js). Pure HTML, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changesHtml } from '../js/cloudflare-page.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const waiting = { ok: true, digest: 'a'.repeat(64), id: 'cf-20261119-abc123', title: 'Set up <rally>', why: 'New app', item: 'L7', from: 'Tandem', created: '2026-11-19T15:00:00Z', status: 'waiting', steps: [{ summary: 'Add DNS CNAME record rally.example.org pointing to rally.workers.dev' }, { summary: 'Serve Worker rally on https://rally.example.org' }] };
const failed = { id: 'cf-20261118-def456', title: 'Roll back', from: 'you', created: '2026-11-18T10:00:00Z', decided: '2026-11-18T10:05:00Z', status: 'failed', steps: [{ summary: 'A' }, { summary: 'B' }], results: [{ ok: true }, { ok: false, error: 'HTTP 403' }] };

test('waiting sets show every step and one Apply button that says how many changes', () => {
  const html = changesHtml([waiting, failed], esc);
  assert.match(html, /Set up &lt;rally&gt;/, 'titles are escaped');
  assert.match(html, /From Tandem for L7/);
  assert.match(html, /<li>Add DNS CNAME record rally\.example\.org/);
  assert.match(html, /data-digest="a{64}"/);
  assert.match(html, /data-cf-apply="cf-20261119-abc123">Apply 2 changes on Cloudflare</);
  assert.match(html, /data-cf-reject="cf-20261119-abc123"/);
  assert.match(html, /<span class="cf-fail">Failed<\/span> B<div class="cf-err">HTTP 403/);
  assert.doesNotMatch(html, /data-cf-apply="cf-20261118/, 'no Apply on a set that already ran');
});

test('nothing waiting says so', () => {
  assert.match(changesHtml([], esc), /Nothing waiting/);
  assert.match(changesHtml([failed], esc, { open: failed.id }), /<details open>/);
});

test('a set with a problem, or without a fingerprint, cannot be applied', () => {
  const bad = { ...waiting, ok: false, steps: [{ summary: 'X', problem: 'other.net is not one of the zones.' }] };
  const html = changesHtml([bad], esc);
  assert.match(html, /data-cf-apply="cf-20261119-abc123" disabled>/);
  assert.match(html, /other\.net is not one of the zones\. Reject it/);
  assert.match(changesHtml([{ ...waiting, digest: undefined }], esc), /data-cf-apply="cf-20261119-abc123" disabled>/);
});
