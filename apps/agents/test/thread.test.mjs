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
