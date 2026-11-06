// view.js is pure HTML builders: check the Shape lane's panel parts render and escape what comes from files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardHtml, panelHtml, topHtml } from '../js/view.js';
import { cleanItem, cleanPrefs, newItem, setStage, shapeState } from '../js/model.js';

const base = (item, extra = {}) => ({
  item, lane: 'shape', files: {}, draft: { kind: null }, editing: false, shapeEditing: null, shape: shapeState({}), back: [], triage: null,
  agent: null, column: 'new', run: null, assigneeName: '', owners: [], age: 0, details: null, prefs: cleanPrefs(), error: '', ...extra
});

test('top bar: three lanes and both New buttons', () => {
  const h = topHtml({ tab: 'board', lane: 'shape', q: '', level: '' }, []);
  assert.deepEqual([...h.matchAll(/data-act="lane" data-id="(\w+)"/g)].map(m => m[1]), ['shape', 'pm', 'dev']);
  assert.match(h, /data-act="new-idea"/);
  assert.match(h, /data-act="new"/);
});

test('board: the Shape lane shows its five columns', () => {
  const it = { ...newItem({ title: 'An idea', kind: 'idea' }), age: 0, facts: null };
  const h = boardHtml({ new: [it] }, { lane: 'shape', open: null });
  assert.deepEqual([...h.matchAll(/<section class="col" aria-label="([^"]+)"/g)].map(m => m[1]), ['New', 'Triage', 'Waiting on requester', 'Interview', 'Brief']);
  assert.match(h, />Idea</);
  const pm = boardHtml({ define: [it] }, { lane: 'pm', open: null });
  assert.deepEqual([...pm.matchAll(/aria-label="([^"]+)"/g)].map(m => m[1]), ['Define', 'Publish', 'Who builds it?', 'Delegated']);
});

test('panel: an idea in New offers Shape it and Already shaped; a request offers Triage and Interview me', () => {
  const idea = newItem({ title: 'An idea', kind: 'idea' });
  const h = panelHtml(base(idea));
  assert.match(h, /data-act="shape"[^>]*>Shape it</);
  assert.match(h, /data-act="skip"/);
  const req = panelHtml(base(newItem({ title: 'A request' })));
  assert.match(req, /data-act="triage"/);
  assert.match(req, /data-act="shape"[^>]*>Interview me</);
  const delegated = panelHtml(base(setStage(newItem({ title: 'x' }), 'delegated'), { column: 'delegated', lane: 'pm' }));
  assert.doesNotMatch(delegated, /data-act="skip"/, 'only Shape and Define items can skip');
});

const Q = `Status: ASKING\nRound: 2\n\n## Q1: Who <b>needs</b> it?\n\n- A) Account managers\n- B) <script>x</script>\n\nRecommended: A\nWhy: internal today\n`;

test('panel: the interview round is a form with options, Other, Skip and notes, escaped', () => {
  const it = setStage(newItem({ title: 'An idea', kind: 'idea' }), 'shaping');
  it.work = { shape: 'shape-an-idea' };
  const files = { 'questions.md': Q, 'understanding.md': '# Understanding\n\nProblem: <img src=x>' };
  const h = panelHtml(base(it, { column: 'interview', files, shape: shapeState(files) }));
  assert.match(h, /Round 2\./);
  assert.match(h, /<input type="radio" name="qa-1" value="A" data-rec>/);
  assert.match(h, /name="qa-1" value="other"/);
  assert.match(h, /name="qa-1" value="skip"/);
  assert.match(h, /id="qo-1"/);
  assert.match(h, /id="qnotes"/);
  assert.match(h, /data-act="send-answers"/);
  assert.match(h, /data-act="use-recommended"/);
  assert.match(h, /data-act="write-brief"/);
  assert.doesNotMatch(h, /<script>|<b>needs|<img src/);
  assert.match(h, /What the agent understands/);
  assert.match(h, /data-act="edit-understanding"/);
  const busy = panelHtml(base(it, { column: 'interview', files, shape: shapeState(files, { busy: true }), agent: { busy: true } }));
  assert.doesNotMatch(busy, /data-act="send-answers"/, 'no form while the agent works');
});

test('panel: the brief offers Send to Define, Keep going and Edit', () => {
  const it = setStage(newItem({ title: 'An idea', kind: 'idea' }), 'brief');
  it.work = { shape: 'shape-an-idea' };
  const files = { 'brief.md': '# Brief: An idea\n\nProduct: Reports\nLevel: User Story\nSize: S\n\n## Problem\n\nNo export.\n' };
  const h = panelHtml(base(it, { column: 'brief', files }));
  assert.match(h, /refine \(one story\)/);
  assert.match(h, /data-act="send-define"/);
  assert.match(h, /data-act="keep-going"/);
  assert.match(h, /id="bnotes"/);
  assert.match(h, /data-act="edit-brief"/);
  assert.match(h, /<dt>Level<\/dt><dd>Story<\/dd>/);
  const editing = panelHtml(base(it, { column: 'brief', files, shapeEditing: 'brief.md' }));
  assert.match(editing, /id="shapeEdit"/);
  assert.match(editing, /data-act="save-shape-file"/);
});

test('panel: a skipped item says so in its history', () => {
  const it = cleanItem({ ...newItem({ title: 'x' }), stage: 'decide', history: [{ stage: 'new', at: '2026-11-01' }, { stage: 'decide', at: '2026-11-02', skipped: true }] });
  assert.match(panelHtml(base(it, { column: 'decide', lane: 'pm' })), /Who builds it\? \(skipped shaping\)/);
});
