// 1:1s views and the Markdown preview: everything from other apps or the person is escaped, links are only
// http(s), and the draft step only shows when it is on and the connector is ready. Synthetic data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { inline, render } from '../js/markdown.js';
import { buildPacket, notePath } from '../js/oneonones/model.js';
import { aiHtml, homeHtml, logHtml, noteHtml, packetHtml, personForm, personHtml, settingsHtml, startPanelHtml } from '../js/oneonones/view.js';
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

test('people list, settings and the note escape names and text', () => {
  const person = { ...PERSON, name: BAD };
  assert.ok(noRaw(homeHtml([{ person, lastDay: '', days: null, due: true }], { selected: -1 })));
  const v = { people: [person], settings: { aiDraft: true } };
  const pick = { choices: [{ id: 'p_r1', name: BAD, relation: 'report', archived: false }], fromDirectory: [], embedded: true };
  assert.ok(noRaw(settingsHtml(v, pick, person)));
  assert.ok(noRaw(personForm({ ...person, personId: 'p_lost' }, pick)));
  assert.ok(noRaw(settingsHtml({ people: [{ ...person, linked: true, relation: 'report', handle: 'dev' }], settings: { aiDraft: true } }, { choices: directoryChoices(DIR), fromDirectory: [], embedded: false }, null)));
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

test("a report's page: the 1:1 section, or one click to start, both escaped", async () => {
  const start = startPanelHtml('<b>Dev</b>');
  assert.ok(start.includes('data-start-report'));
  assert.ok(!start.includes('<b>Dev</b>') && start.includes('&lt;b&gt;Dev&lt;/b&gt;'));
  const p = { ...PERSON, name: 'Dev <One>' };
  const packet = buildPacket({ person: p, today: TODAY, now: NOW, notes: [], lastText: null, src: {} });
  const html = personHtml({ person: p, packet, note: null, notes: [], today: TODAY, ai: { state: 'idle' }, aiOpts: { enabled: true, ready: false }, panel: true, due: { lastDay: '', days: null, due: true } });
  assert.ok(html.includes('oo-panel') && html.includes('Due') && html.includes('data-log'));
  assert.ok(!html.includes('Dev <One>'), 'the name is not drawn raw');
  assert.ok(!html.includes('All 1:1s'), 'no way back on a report page: it is already on their page');
});
