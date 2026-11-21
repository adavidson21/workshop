// Conversation pieces shared by hub threads and the Chat tab (js/thread.js). Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastTandem, since, turnsHtml } from '../js/thread.js';

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
  const { groupChats, matchChat } = await import('../js/thread.js');
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
  // Chat 4.2.0: waiting on you, or finished while away (and not busy again), first.
  const needy = items.map(c => c.session === 'b' ? { ...c, waiting: true } : c.session === 'c' ? { ...c, unread: true } : c.session === 'd' ? { ...c, unread: true, busy: true } : c);
  assert.deepEqual(groupChats(needy, now).map(g => [g.label, g.items.map(c => c.session)]),
    [['Needs you', ['c', 'b']], ['Today', ['d', 'a']], ['Previous 7 days', ['e']]]);
  assert.equal(matchChat(items[0], 'api SAMPLE'), true);
  assert.equal(matchChat(items[0], 'api billing'), false);
  assert.equal(matchChat(items[0], '  '), true);
});

test('echoes: a sent message stays until opencode stores it, or a minute passes with opencode idle', async () => {
  const { liveEchoes, ECHO_MS } = await import('../js/thread.js');
  const now = 1_000_000;
  const e = { text: 'fix the build', base: 2, at: now };
  const two = [{ role: 'you', text: 'hi' }, { role: 'tandem', text: 'hello' }];
  assert.equal(liveEchoes([e], two, { now }).length, 1, 'not stored yet: still shown');
  assert.equal(liveEchoes([e], [...two, { role: 'you', text: 'fix the build' }], { now }).length, 0, 'stored: gone');
  assert.equal(liveEchoes([e], two, { now: now + ECHO_MS + 1 }).length, 0, 'never stored and idle: gone after a minute');
  assert.equal(liveEchoes([e], two, { now: now + ECHO_MS + 1, busy: true }).length, 1, 'kept while opencode is working');
  const blind = { text: 'fix the build', base: null, at: now };
  assert.equal(liveEchoes([blind], two, { now }).length, 1, 'turns were not read when sent: kept until the text shows');
  assert.equal(liveEchoes([blind], [...two, { role: 'you', text: ' fix the build ' }], { now }).length, 0);
  assert.deepEqual(liveEchoes(null, null), []);
});
