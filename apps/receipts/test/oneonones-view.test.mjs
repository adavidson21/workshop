// 1:1s views and the Markdown preview: everything from other apps or the person is escaped, links are only
// http(s), and the draft step only shows when it is on and the connector is ready. Synthetic data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { inline, render } from '../js/markdown.js';
import { buildPacket, notePath } from '../js/oneonones/model.js';
import { aiHtml, noteHtml, packetHtml, personHtml, startHtml, wrapHtml } from '../js/oneonones/view.js';
import { DIR, NOW, PERSON, TODAY, docketSummary, entry, receiptsEntries, task } from './oneonones-fake.mjs';
import { directoryChoices } from '../js/oneonones/model.js';

const BAD = '<img src=x onerror=alert(1)>"\'&';
const noRaw = html => !html.includes('<img') && !html.includes('onerror=alert(1)>');

test('markdown: raw HTML is text, only http(s) links are clickable, nothing else is markup', () => {
  const html = render(`# Title ${BAD}\n\n<script>alert(1)</script>\n\n- [ ] task ${BAD}\n- [x] done\n\n[ok](https://example.com/a?b=1&c=2) [q](https://example.com/"x") [bad](javascript:alert(1)) ![img](https://example.com/i.png)\n\n\`\`\`\n<b>code</b>\n\`\`\`\n\n**bold** and *em* and \`<i>\``);
  assert.ok(noRaw(html), html);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">ok</a>'));
  assert.ok(!html.includes('href="https://example.com/&quot;') && !html.includes('href="https://example.com/"'), 'a URL with a quote stays text');
  assert.ok(!/href="javascript/i.test(html), 'javascript: links stay text');
  assert.ok(html.includes('<input type="checkbox" disabled aria-label="Open">'));
  assert.ok(html.includes('&lt;b&gt;code&lt;/b&gt;'));
  assert.ok(html.includes('<strong>bold</strong>') && html.includes('<em>em</em>') && html.includes('<code>&lt;i&gt;</code>'));
  assert.equal(inline('a\u0000b'), 'ab', 'placeholder characters in the input are dropped');
});

test('the packet escapes task titles and receipts', () => {
  const p = buildPacket({
    person: PERSON, today: TODAY, now: NOW, notes: [], lastText: null,
    src: {
      docketSummary: docketSummary([{ id: 'p_r1', open: [task('t1', { title: BAD, via: 'g_lead', viaName: BAD })], waiting: [] }]),
      receiptsEntries: receiptsEntries([entry('r1', { text: BAD })])
    }
  });
  const html = packetHtml(p);
  assert.ok(noRaw(html), html);
  assert.ok((html.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 2);
});

test('unlinked and unreadable sources say so instead of showing nothing', () => {
  const p = buildPacket({ person: { ...PERSON, personId: '', relation: '' }, today: TODAY, now: NOW, notes: [], lastText: null, src: { docketSummary: docketSummary([], 9) } });
  const html = packetHtml(p);
  assert.equal((html.match(/Not in People/g) || []).length, 2);
  const p2 = buildPacket({ person: PERSON, today: TODAY, now: NOW, notes: [], lastText: null, src: { docketSummary: docketSummary([], 9) } });
  assert.ok(packetHtml(p2).includes('version this app does not know'));
});

test('no Docket summary yet says to open Docket once', () => {
  const p = buildPacket({ person: PERSON, today: TODAY, now: NOW, notes: [], lastText: null, src: { docketSummary: null } });
  assert.ok(packetHtml(p).includes('Open Docket once'));
});

test('the start card, the note and Wrap up escape names and text', () => {
  assert.ok(noRaw(startHtml(BAD)));
  const note = { day: TODAY, path: notePath(PERSON.id, TODAY), text: `</textarea>${BAD}`, mtime: 1, dirty: false, mode: 'edit' };
  const ed = noteHtml(note, [{ day: TODAY }], TODAY);
  assert.ok(!ed.includes('</textarea><img'), 'the note cannot close its textarea');
  assert.ok(noRaw(noteHtml({ ...note, mode: 'preview' }, [], TODAY)));
  assert.ok(noRaw(wrapHtml({ followUps: [{ text: BAD, owner: 'them', sent: false, tandem: true }], wins: [{ text: BAD }], canOffer: true, canSend: true, linked: true, name: BAD, day: TODAY })));
});

test('the draft step shows only when it is on and the opencode connector is ready', () => {
  const ai = { state: 'done', text: `- ${BAD}`, error: '', includeConcerns: false };
  assert.equal(aiHtml(ai, { enabled: false, ready: true }), '');
  assert.equal(aiHtml(ai, { enabled: true, ready: false }), '');
  const html = aiHtml(ai, { enabled: true, ready: true });
  assert.ok(html.includes('data-draft') && html.includes('data-include-concerns') && !html.includes('data-include-concerns checked'));
  assert.ok(noRaw(html));
  assert.ok(noRaw(aiHtml({ ...ai, state: 'failed', error: BAD }, { enabled: true, ready: true })));
});

test("a person's 1:1 tab: Bring up, today's note, Copy for Lattice and Wrap up, escaped", async () => {
  const p = { ...PERSON, name: 'Dev <One>' };
  const packet = buildPacket({ person: p, today: TODAY, now: NOW, notes: [], lastText: null, src: {} });
  const html = personHtml({ person: p, packet, note: null, notes: [], today: TODAY, ai: { state: 'idle' }, aiOpts: { enabled: true, ready: false } });
  assert.ok(html.includes('Bring up') && html.includes('data-lattice-points') && !html.includes('data-wrap'), 'Wrap up shows once there is a note');
  assert.ok(!html.includes('Dev <One>'), 'the name is not drawn raw');
  const note = { day: TODAY, path: notePath(PERSON.id, TODAY), text: '# hi', mtime: 1, dirty: false, mode: 'edit' };
  const withNote = personHtml({ person: { ...p, canLog: true }, packet, note, notes: [{ day: TODAY }], today: TODAY, ai: { state: 'idle' }, aiOpts: { enabled: false, ready: true }, wrap: { state: 'running' } });
  assert.ok(withNote.includes('data-wrap disabled') && withNote.includes('Tandem is reading the note'));
  assert.ok(withNote.includes('wins to the Log'));
});
