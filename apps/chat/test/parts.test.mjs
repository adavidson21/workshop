// Tests for Chat's composer reading, transcript drawing and Markdown (js/parts.js, js/md.js). Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTINS, attHtml, cycleAgent, diffHtml, filesIn, matchCommands, matchModels, modelFromKey, modelKey, modelLabel, parseInput, partsHtml, popupFor, promptClick, promptHtml, questionAnswers, richRows, splitRevert, tokens, toolHtml, workspacePath } from '../js/parts.js';
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
  assert.match(html, /att-chip" data-open-file="a\.cs"[^>]*>a\.cs</, "an attached file opens in Files (Chat 4.0.0)");
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

test('your turns name the agent only when it changed (Chat 2.3.0)', () => {
  const html = richRows([
    { id: 'u1', role: 'you', text: 'one', agent: 'build', parts: [] },
    { id: 'u2', role: 'you', text: 'two', agent: 'build', parts: [] },
    { id: 'u3', role: 'you', text: 'three', agent: 'plan', parts: [] },
  ]);
  assert.deepEqual([...html.matchAll(/you-agent">(\w+)/g)].map(m => m[1]), ['plan']);
});

/* ---------- Chat 4.0.0: the workbench in the thread ---------- */
test('files a tool read or changed open in Files; paths outside the workspace do not', () => {
  for (const ok of ['src/app.cs', 'api/Program.cs', 'my docs/notes.md']) assert.equal(workspacePath(ok), ok);
  for (const bad of ['/etc/passwd', 'C:\\x.cs', '..', '../x', '~/x', '**/*.cs', '', 'a\nb']) assert.equal(workspacePath(bad), '', bad);
  const edit = toolHtml({ type: 'tool', tool: 'edit', status: 'completed', input: 'src/a.cs', diff: '-a\n+b' }, 'k');
  assert.match(edit, /<div class="tool-row"><button type="button" class="tool-line"[\s\S]*<\/button><button type="button" class="lnk tool-file" data-open-file="src\/a\.cs"/, 'the Open button sits beside the line, not inside it');
  assert.doesNotMatch(toolHtml({ type: 'tool', tool: 'bash', status: 'completed', input: 'ls src' }, 'k'), /data-open-file/);
  assert.doesNotMatch(toolHtml({ type: 'tool', tool: 'read', status: 'completed', input: '/abs/x.cs' }, 'k'), /data-open-file/);
  const patch = partsHtml({ id: 'm', parts: [{ type: 'patch', files: ['a.cs', '/outside/b.cs'] }] });
  assert.match(patch, /data-open-file="a\.cs"[^>]*>a\.cs</);
  assert.match(patch, /, \/outside\/b\.cs</);
});

test('a pasted image is a picture filled in later; it never carries its data in the HTML', () => {
  assert.equal(attHtml({ type: 'file', name: 'shot.png', image: true, mime: 'image/png', part: 2 }, 'msg_1', 'ses_1'),
    '<button type="button" class="att-pic" data-img-view title="shot.png"><img alt="shot.png" data-img-ref="ses_1|msg_1|2"></button>');
  assert.match(attHtml({ type: 'file', name: 'x.png', image: true, local: 'l1' }), /data-img-local="l1"/);
  assert.equal(attHtml({ type: 'file', name: 'x.png', image: true }, '', ''), '<span class="att-chip">x.png</span>', 'no way to load it: just its name');
  const rows = richRows([{ id: 'msg_9', role: 'you', text: 'see', parts: [{ type: 'file', name: 'a"b.png', image: true, part: 1 }] }], { session: 'ses_2' });
  assert.match(rows, /data-img-ref="ses_2\|msg_9\|1"/);
  assert.match(rows, /alt="a&quot;b\.png"/);
});

test('/terminal, /files, /side and /tui are Chat\'s own; prompts answer the same way in a side chat', () => {
  for (const n of ['terminal', 'files', 'side', 'tui']) assert.ok(BUILTINS.some(b => b.name === n), n);
  assert.deepEqual(parseInput('/side what does Program.cs do?'), { kind: 'builtin', name: 'side', args: 'what does Program.cs do?' });
  const prompts = [{ kind: 'question', id: 'q1', questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }] }];
  const state = { answers: {}, custom: {} };
  assert.deepEqual(promptClick({ perm: 'once', id: 'p1' }, prompts, state), { answer: { kind: 'permission', id: 'p1', reply: 'once' } });
  assert.deepEqual(promptClick({ qPick: 'q1', qi: '0', label: 'B' }, prompts, state), { redraw: true });
  assert.deepEqual(promptClick({ qSend: 'q1' }, prompts, state), { answer: { kind: 'question', id: 'q1', answers: [['B']] } });
  assert.deepEqual(promptClick({ qReject: 'q1' }, prompts, state), { answer: { kind: 'question', id: 'q1', reject: true } });
  assert.equal(promptClick({ tool: 'x' }, prompts, state), null);
});
