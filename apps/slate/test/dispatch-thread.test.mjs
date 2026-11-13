// Conversation pieces shared by hub threads and the Chat tab (js/thread.js). Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastTandem, since, turnsHtml } from '../js/dispatch/thread.js';

test('turns: yours as escaped text, Tandem as safe Markdown, a writing line while busy', () => {
  const html = turnsHtml([
    { role: 'you', text: '<script>alert(1)</script> **not bold**' },
    { role: 'tandem', text: 'On `net8.0` <img src=x onerror=1>\n- **Confirmed**: tests.csproj line 4\n[x](javascript:alert(1))' },
    { role: 'tandem', text: '' }
  ], { busy: true });
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /\*\*not bold\*\*/, 'your own text is not rendered as Markdown');
  assert.match(html, /<code>net8.0<\/code>/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|<script|href="javascript/);
  assert.equal((html.match(/class="turn /g) || []).length, 3, 'empty turns are skipped; the writing line is added');
  assert.match(html, /Writing/);
  assert.equal(turnsHtml([]), '');
  assert.equal(turnsHtml(null), '');
});

test('lastTandem and since', () => {
  assert.equal(lastTandem([{ role: 'tandem', text: 'a' }, { role: 'you', text: 'b' }, { role: 'tandem', text: '' }]), 'a');
  assert.equal(lastTandem(undefined), '');
  const now = 10 * 864e5;
  assert.equal(since(now - 20e3, now), 'just now');
  assert.equal(since(now - 5 * 60e3, now), '5 min ago');
  assert.equal(since(now - 3 * 3600e3, now), '3 h ago');
  assert.equal(since(now - 2 * 864e5, now), '2 d ago');
  assert.equal(since(0, now), '');
});

test('the Chat sidebar: groups by day, newest first, and search by every word', async () => {
  const { groupChats, matchChat } = await import('../js/dispatch/thread.js');
  const now = new Date(2026, 10, 12, 15).getTime(), h = 3600000;
  const items = [
    { session: 'a', title: 'Sample API version', last: now - h },
    { session: 'b', title: 'Old question', last: now - 40 * 24 * h },
    { session: 'c', title: 'Yesterday thing', last: now - 20 * h },
    { session: 'd', title: 'Newest', last: now - 60000 },
    { session: 'e', title: 'Last week', last: now - 4 * 24 * h }
  ];
  assert.deepEqual(groupChats(items, now).map(g => [g.label, g.items.map(c => c.session)]),
    [['Today', ['d', 'a']], ['Yesterday', ['c']], ['Previous 7 days', ['e']], ['Older', ['b']]]);
  assert.deepEqual(groupChats([], now), []);
  assert.equal(matchChat(items[0], 'api SAMPLE'), true);
  assert.equal(matchChat(items[0], 'api billing'), false);
  assert.equal(matchChat(items[0], '  '), true);
});
