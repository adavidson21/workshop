// Tests for js/voice-model.js (Settings, Writing). Synthetic text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../js/voice-model.js';

test('defaults round-trip through an envelope; a bad file falls back', () => {
  const env = V.toEnvelope(null, V.defaults(), 5);
  assert.equal(env.schema, 'settings.writing');
  const { value, saved } = V.fromEnvelope(env);
  assert.equal(saved, true);
  assert.deepEqual(value.audiences.map(a => a.id), ['leadership', 'business']);
  assert.equal(V.fromEnvelope({ schema: 'other' }).saved, false);
  assert.equal(V.fromEnvelope({ schema: 'settings.writing', meta: { audiences: 'x', rules: [{ text: 'a', status: 'weird' }] } }).value.rules[0].status, 'proposed');
});

test('pasted samples split on --- or blank lines, skip short bits and duplicates', () => {
  const t = 'First message that is long enough.\n---\nSecond message that is long enough.\n\n\n\nThird message that is long enough.\n---\nok';
  const s = V.splitSamples(t);
  assert.equal(s.length, 3);
  let v = V.addSamples(V.defaults(), 'leadership', s, 'you', 1);
  v = V.addSamples(v, 'leadership', [s[0]], 'you', 2);
  assert.equal(V.sampleCount(v, 'leadership'), 3);
  assert.equal(V.totalSamples(v), 3);
});

test('over the cap, oldest sent drafts go first and your own samples stay', () => {
  let v = V.addSamples(V.defaults(), 'business', Array.from({ length: V.MAX_SAMPLES - 1 }, (_, i) => `mine number ${i}`), 'you', 1);
  v = V.addSamples(v, 'business', ['approved one'], 'approved', 2);
  assert.equal(V.sampleCount(v, 'business'), V.MAX_SAMPLES);
  v = V.addSamples(v, 'business', ['approved two'], 'approved', 3);
  const texts = v.samples.business.map(s => s.text);
  assert.ok(!texts.includes('approved one'));
  assert.ok(texts.includes('approved two'));
  v = V.addSamples(v, 'business', ['mine extra one', 'mine extra two'], 'you', 4);
  assert.equal(v.samples.business.filter(x => x.from === 'you').length, V.MAX_SAMPLES + 1, 'samples you pasted are never dropped automatically');
});

test('feedback: sent as is and edits become samples, a reason becomes an active rule', () => {
  let v = V.defaults();
  v = V.applyFeedback(v, { verdict: 'approved', audience: 'leadership', draft: 'Draft A' });
  v = V.applyFeedback(v, { verdict: 'edited', audience: 'leadership', draft: 'Draft B', final: 'Sent B' });
  assert.deepEqual(v.samples.leadership.map(s => [s.text, s.from]), [['Draft A', 'approved'], ['Sent B', 'approved']]);
  v = V.applyFeedback(v, { verdict: 'rejected', audience: 'leadership', reason: '' });
  assert.equal(v.rules.length, 0);
  v = V.applyFeedback(v, { verdict: 'rejected', audience: 'leadership', reader: 'Erik', reason: 'Too formal' });
  assert.deepEqual(v.rules.map(r => [r.text, r.status, r.reader]), [['Too formal', 'active', 'Erik']]);
  assert.equal(V.liveRules(v, 'leadership', 'Erik').length, 1);
  assert.equal(V.liveRules(v, 'leadership', '').length, 0, 'a reader rule is only for that reader');
  assert.equal(V.liveRules(v, 'business', 'Erik').length, 0);
});

test('learn: a new change is proposed, the same kind again makes it active', () => {
  assert.deepEqual(V.parseLearn('RULE: Cut the root cause paragraph.'), { kind: 'new', text: 'Cut the root cause paragraph.' });
  assert.deepEqual(V.parseLearn(' SAME: 2 '), { kind: 'same', index: 1 });
  assert.deepEqual(V.parseLearn('NONE'), { kind: 'none' });
  const ctx = { audience: 'leadership', draft: 'd' };
  let v = V.applyLearn(V.defaults(), V.parseLearn('RULE: Cut the root cause.'), ctx);
  assert.equal(v.rules[0].status, 'proposed');
  assert.match(V.learnPrompt(v, { audience: 'leadership', draft: 'a', final: 'b' }), /1\. Cut the root cause\./);
  v = V.applyLearn(v, { kind: 'same', index: 0 }, ctx);
  assert.equal(v.rules[0].status, 'active');
  v = V.setRuleStatus(v, v.rules[0].id, 'rejected');
  v = V.applyLearn(v, V.parseLearn('RULE: Cut the root cause.'), ctx);
  assert.equal(v.rules.length, 1);
  assert.equal(v.rules[0].status, 'rejected', 'a rejected rule is not brought back');
});

test('the check flags em dashes, banned words and length, and nothing else', () => {
  const v = V.defaults();
  assert.deepEqual(V.check(v, 'leadership', 'We ship Friday. Risk is low.'), []);
  const w = V.check(v, 'leadership', 'We will leverage the cache \u2014 fast. One. Two. Three. Four.');
  assert.equal(w.length, 3);
  assert.match(w[1], /leverage/);
  assert.match(w[2], /5 sentences; Leadership is set to 4/);
});

test('prompts carry the rules, samples, style and draft, fenced', () => {
  let v = V.addSamples(V.defaults(), 'leadership', ['A sample I sent to leadership.'], 'you', 1);
  v = Object.assign({}, v, { style: 'Short and plain.' });
  const p = V.rewritePrompt(v, { audience: 'leadership', draft: 'My long draft', reader: V.readerOf({ name: 'Pat', role: 'VP', relation: 'manager' }) });
  for (const want of ['At most 4 sentences.', 'No em dashes.', 'Never use these words: leverage', '<<<DRAFT\nMy long draft\nDRAFT>>>', 'Short and plain.', 'A sample I sent', 'The reader is Pat (VP, manager)']) assert.ok(p.includes(want), want);
  assert.match(V.stylePrompt(v), /Samples for Leadership/);
  assert.ok(!/\u2014/.test(p + V.stylePrompt(v) + V.learnPrompt(v, { audience: 'leadership', draft: 'a', final: 'b' })), 'prompts have no em dashes');
});

test('audiences: add with a unique id', () => {
  let v = V.addAudience(V.defaults(), 'Leadership');
  assert.equal(v.audiences[2].id, 'leadership-2');
  assert.deepEqual(V.lines(' a \n\n b '), ['a', 'b']);
});
