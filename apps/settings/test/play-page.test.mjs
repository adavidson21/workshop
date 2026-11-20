// Settings, Google Play: the release sets list (js/play-page.js). Pure HTML, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releasesHtml } from '../js/play-page.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const waiting = { ok: true, id: 'gp-20261119-abc123', app: 'org.example.wishlist', title: 'Wishlist <1.3> to testers', why: 'Share fix', item: 'L9', from: 'Tandem', created: '2026-11-19T15:00:00Z', status: 'waiting', steps: [{ summary: 'Upload app-release-bundle.aab (version code 4), then release it to Internal testing for everyone on that track.' }] };
const done = { id: 'gp-20261118-def456', app: 'org.example.wishlist', title: 'Ship 1.2', from: 'you', created: '2026-11-18T10:00:00Z', decided: '2026-11-18T10:05:00Z', status: 'failed', steps: [{ summary: 'A' }, { summary: 'B' }, { summary: 'C' }], results: [{ ok: false, skipped: true, error: 'Not done: Play takes these changes together, and one of them failed.' }, { ok: false, error: 'HTTP 403' }, { ok: true, note: 'Play wants this sent for review by hand.' }] };

test('waiting sets show the app and every step and send you to Approvals; finished ones show what happened', () => {
  const html = releasesHtml([waiting, done], esc);
  assert.match(html, /Wishlist &lt;1\.3&gt; to testers/, 'titles are escaped');
  assert.match(html, /org\.example\.wishlist, from Tandem for L9/);
  assert.match(html, /<li>Upload app-release-bundle\.aab \(version code 4\)/);
  assert.match(html, /data-goto-page="approvals">Review in Approvals</);
  assert.doesNotMatch(html, /data-apply|data-reject/, 'one way to approve: Approvals');
  assert.match(html, /<span class="cf-skip">Not done<\/span> A<div class="cf-err">Not done: Play takes these changes together/);
  assert.match(html, /<span class="cf-fail">Failed<\/span> B<div class="cf-err">HTTP 403/);
  assert.match(html, /<span class="cf-ok">Done<\/span> C<div class="sub">Play wants this sent for review by hand\./);
  assert.match(html, /play\/log\.md/);
});

test('nothing waiting says so, and a set with a problem says to reject it', () => {
  assert.match(releasesHtml([], esc), /Nothing waiting/);
  const bad = { ...waiting, ok: false, steps: [{ summary: 'X', problem: 'The bundle file changed since this was proposed.' }] };
  assert.match(releasesHtml([bad], esc), /The bundle file changed since this was proposed\. Reject it, and ask for a new one\./);
});

test('a secret field shows the command for its kind: token, key file or password', async () => {
  const { secretCommand } = await import('../js/forms.js');
  assert.equal(secretCommand('cloudflare'), 'workshop secret set cloudflare --expires YYYY-MM-DD');
  assert.equal(secretCommand('play', 'key-file'), 'workshop secret set play --from-file <key.json>');
  assert.equal(secretCommand('play-wishlist', 'password'), 'workshop secret set play-wishlist --password');
});
