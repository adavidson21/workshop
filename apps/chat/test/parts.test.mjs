// Tests for Chat's composer reading, transcript drawing and Markdown (js/parts.js, js/md.js). Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTINS, cycleAgent, diffHtml, filesIn, matchCommands, matchModels, modelFromKey, modelKey, modelLabel, parseInput, popupFor, promptHtml, questionAnswers, richRows, splitRevert, tokens, toolHtml } from '../js/parts.js';
import { inline, mdHtml } from '../js/md.js';

test('the composer reads !shell, /commands (Chat\'s own and opencode\'s) and plain text', () => {
  assert.deepEqual(parseInput('  '), { kind: 'empty' });
  assert.deepEqual(parseInput('!git status'), { kind: 'shell', command: 'git status' });
  assert.deepEqual(parseInput('!'), { kind: 'empty' });
  assert.deepEqual(parseInput('/undo'), { kind: 'builtin', name: 'undo', args: '' });
  assert.deepEqual(parseInput('/spike how does auth\nwork'), { kind: 'command', name: 'spike', args: 'how does auth\nwork' });
  assert.deepEqual(parseInput('//etc/hosts is odd'), { kind: 'text', text: '/etc/hosts is odd' });
  assert.deepEqual(parseInput('fix the build'), { kind: 'text', text: 'fix the build' });
  assert.ok(BUILTINS.some(b => b.name === 'compact'));
});

test('popups: / at the start, @ after a space; commands match by prefix first; picked files still in the text', () => {
  assert.deepEqual(popupFor('/sp'), { kind: 'slash', q: 'sp' });
  assert.equal(popupFor('/spike x'), null);
  assert.deepEqual(popupFor('look at @src/ap', 15), { kind: 'file', q: 'src/ap', start: 8 });
  assert.equal(popupFor('mail me@x'), null);
  const names = matchCommands('re', [{ name: 'review', description: 'Review' }, { name: 'pr-review' }, { name: 'redo' }]).map(c => c.name);
  assert.deepEqual(names, ['redo', 'review', 'pr-review'], "Chat's own first, opencode's next, then anything containing it");
  assert.deepEqual(filesIn('see @src/a.cs and @b.md', new Set(['src/a.cs', 'gone.cs', 'b.md'])), ['src/a.cs', 'b.md']);
});

test('agents cycle with Tab both ways; models by key, filter and label', () => {
  const list = [{ name: 'hub' }, { name: 'build' }, { name: 'plan' }];
  assert.equal(cycleAgent(list, 'build'), 'plan');
  assert.equal(cycleAgent(list, 'plan'), 'hub');
  assert.equal(cycleAgent(list, 'hub', true), 'plan');
  const models = [{ provider: 'anthropic', providerName: 'Anthropic', id: 'claude-x', name: 'Claude X' }, { provider: 'openai', providerName: 'OpenAI', id: 'gpt-y', name: 'GPT Y' }];
  assert.equal(modelKey(models[0]), 'anthropic/claude-x');
  assert.deepEqual(modelFromKey('openrouter/meta/llama'), { provider: 'openrouter', id: 'meta/llama' });
  assert.equal(modelFromKey(''), null);
  assert.deepEqual(matchModels('openai', models).map(m => m.id), ['gpt-y']);
  assert.equal(modelLabel('anthropic/claude-x', models), 'Claude X');
  assert.equal(modelLabel('', models), 'Default model');
  assert.equal(tokens(12345), '12k');
  assert.equal(tokens(1500), '1.5k');
});

test('tool calls fold; diffs and failures open by default; flipping one keeps the rest', () => {
  const bash = { type: 'tool', tool: 'bash', status: 'completed', input: 'dotnet test', output: 'Passed!' };
  assert.doesNotMatch(toolHtml(bash, 'm:1', { open: new Set() }), /Passed!/);
  assert.match(toolHtml(bash, 'm:1', { open: new Set(['m:1']) }), /Passed!/);
  assert.match(toolHtml(bash, 'm:1', { details: true }), /Passed!/);
  const edit = { type: 'tool', tool: 'edit', status: 'completed', input: 'src/a.cs', diff: '-old\n+new <b>' };
  const h = toolHtml(edit, 'm:2', { open: new Set() });
  assert.match(h, /class="df-add">\+new &lt;b&gt;/);
  assert.doesNotMatch(toolHtml(edit, 'm:2', { open: new Set(['m:2']) }), /df-add/);
  assert.match(toolHtml({ type: 'tool', tool: 'task', status: 'running', input: 'general: find', child: 'ses_kid' }, 'k'), /data-chat-open="ses_kid"/);
  assert.match(toolHtml({ type: 'tool', tool: 'todowrite', status: 'completed', todos: [{ content: 'Ship <it>', status: 'completed' }] }, 'k'), /Ship &lt;it&gt;/);
  assert.match(diffHtml('@@ -1 +1 @@'), /df-hunk/);
});

test('turns: one block per answer with its meta line, files on your turns, everything escaped', () => {
  const html = richRows([
    { id: 'u', role: 'you', text: 'hi <script>', agent: 'plan', parts: [{ type: 'file', name: 'a.cs' }] },
    { id: 'a1', role: 'tandem', text: '', agent: 'plan', model: { provider: 'p', id: 'm-1' }, cost: 0.01, parts: [{ type: 'reasoning', text: 'hmm' }, { type: 'tool', tool: 'read', status: 'completed', input: 'a.cs' }] },
    { id: 'a2', role: 'tandem', text: 'Done', agent: 'plan', model: { provider: 'p', id: 'm-1' }, tokens: { input: 900, output: 100, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0.02, parts: [{ type: 'text', text: '**Done**' }] },
  ], { busy: true, activity: 'Reading <x>' });
  assert.match(html, /hi &lt;script&gt;/);
  assert.match(html, /att-chip">a\.cs/);
  assert.equal((html.match(/class="turn tandem"/g) || []).length, 1, 'two steps, one answer');
  assert.match(html, /plan · m-1 · 1\.0k tokens · \$0\.03/);
  assert.match(html, /<b>Done<\/b>/);
  assert.match(html, /Reading &lt;x&gt;\.\.\./);
});

test('permission prompts and questions carry what is needed to answer them', () => {
  const p = promptHtml({ kind: 'permission', id: 'per_1', permission: 'bash', title: 'rm -rf <build>', always: ['rm *'] });
  assert.match(p, /run a command/);
  assert.match(p, /rm -rf &lt;build&gt;/);
  for (const r of ['once', 'always', 'reject']) assert.match(p, new RegExp(`data-perm="${r}" data-id="per_1"`));
  const q = { kind: 'question', id: 'que_1', questions: [{ question: 'Which db?', options: [{ label: 'SQL' }, { label: 'Mongo' }], multiple: false }, { question: 'Notes?', options: [] }] };
  const h = promptHtml(q, { answers: { que_1: [['SQL']] } });
  assert.match(h, /class="chip on"[^>]*data-label="SQL"/);
  assert.deepEqual(questionAnswers(q, { que_1: [['SQL']] }, { que_1: { 1: ' typed ' } }), [['SQL'], ['typed']]);
});

test('turns after an undo hide until redo', () => {
  const turns = [{ id: 'u1', role: 'you' }, { id: 'a1', role: 'tandem' }, { id: 'u2', role: 'you' }, { id: 'a2', role: 'tandem' }];
  assert.deepEqual(splitRevert(turns, 'u2'), { shown: turns.slice(0, 2), undone: 1 });
  assert.deepEqual(splitRevert(turns, null), { shown: turns, undone: 0 });
  assert.deepEqual(splitRevert(turns, 'gone'), { shown: turns, undone: 0 });
});

test('Markdown: code fences, lists, tables, links; no HTML gets through', () => {
  const h = mdHtml('# Plan\n\n1. First `a<b>`\n2. Second\n\n- [x] done\n- [ ] todo\n\n```ts\nconst x = "<y>";\n```\n\n| A | B |\n|---|---|\n| 1 | **2** |\n\n> quote\n\n<img src=x onerror=alert(1)> [docs](https://example.com/a?b=1&c=2) [bad](javascript:alert(1))');
  assert.match(h, /<h4>Plan<\/h4>/);
  assert.match(h, /<ol><li>First <code>a&lt;b&gt;<\/code><\/li><li>Second<\/li><\/ol>/);
  assert.match(h, /class="task done"/);
  assert.match(h, /<span class="code-lang">ts<\/span>.*<code>const x = &quot;&lt;y&gt;&quot;;<\/code>/s);
  assert.match(h, /<table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td><b>2<\/b><\/td><\/tr>/);
  assert.match(h, /<blockquote>quote<\/blockquote>/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(h, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs<\/a>/);
  assert.doesNotMatch(h, /href="javascript/);
  assert.equal(inline('*it* and _it_ and snake_case_name'), '<i>it</i> and <i>it</i> and snake_case_name');
});
