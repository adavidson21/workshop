// 1:1s views and the Markdown preview: everything from other apps or the person is escaped, links are only
// http(s), and the draft step only shows when it is on and the connector is ready. Synthetic data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { inline, render } from '../js/markdown.js';
import { buildPacket, notePath } from '../js/model.js';
import { aiHtml, homeHtml, logHtml, noteHtml, packetHtml, personForm, settingsHtml } from '../js/view.js';
import { NOW, PERSON, TODAY, docketTasks, entry, item, queueSettings, queueSnapshot, receiptsEntries, task } from './fake.mjs';

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

test('the packet escapes task titles, receipts and work item titles', () => {
  const p = buildPacket({
    person: PERSON, today: TODAY, now: NOW, notes: [], lastText: null,
    src: {
      docketTasks: docketTasks([task('t1', { people: ['DevA'], title: BAD })]),
      receiptsEntries: receiptsEntries([entry('r1', { text: BAD })]),
      queueSnapshot: queueSnapshot([item(1, { title: BAD, state: BAD })]),
      queueSettings: queueSettings()
    }
  });
  const html = packetHtml(p);
  assert.ok(noRaw(html), html);
  assert.ok((html.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 4);
});

test('unlinked and unreadable sources say so instead of showing nothing', () => {
  const p = buildPacket({ person: { ...PERSON, links: {} }, today: TODAY, now: NOW, notes: [], lastText: null, src: { docketTasks: docketTasks([], 9) } });
  const html = packetHtml(p);
  assert.equal((html.match(/Not linked/g) || []).length, 3);
  const p2 = buildPacket({ person: PERSON, today: TODAY, now: NOW, notes: [], lastText: null, src: { docketTasks: docketTasks([], 9) } });
  assert.ok(packetHtml(p2).includes('version this app does not know'));
});

test('people list, settings and the note escape names and text', () => {
  const person = { ...PERSON, name: BAD };
  assert.ok(noRaw(homeHtml([{ person, lastDay: '', days: null, due: true }], { selected: -1 })));
  const v = { people: [person], settings: { aiDraft: true } };
  const pick = { docket: [BAD], receipts: [{ id: 'p_r1', name: BAD, archived: false }], queue: [{ key: BAD, name: BAD }], states: { docket: 'ok', receipts: 'ok', queue: 'ok' } };
  assert.ok(noRaw(settingsHtml(v, pick, person)));
  assert.ok(noRaw(personForm({ ...person, links: { docket: BAD } }, pick)));
  const note = { day: TODAY, path: notePath(PERSON.id, TODAY), text: `</textarea>${BAD}`, mtime: 1, dirty: false, mode: 'edit' };
  const ed = noteHtml(note, [{ day: TODAY }], TODAY);
  assert.ok(!ed.includes('</textarea><img'), 'the note cannot close its textarea');
  assert.ok(noRaw(noteHtml({ ...note, mode: 'preview' }, [], TODAY)));
  assert.ok(noRaw(logHtml({ followUps: [BAD], wins: [BAD], canOffer: true, docketLinked: true })));
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
