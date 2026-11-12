import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BYTES, linkMaps, planImport, rewriteNote } from '../js/vault.js';
import { SEG } from '../js/model.js';
import { facts } from '../js/markdown.js';

const FILES = [
  { path: 'My Vault/Projects/Q4 Plan.md', size: 10 },
  { path: 'My Vault/Daily.md', size: 5 },
  { path: 'My Vault/img/Shot 1.PNG', size: 5 },
  { path: 'My Vault/.obsidian/app.json', size: 5 },
  { path: 'My Vault/a/b/c/d/Deep.md', size: 1 },
  { path: 'My Vault/big.md', size: MAX_BYTES + 1 },
  { path: 'My Vault/doc.pdf', size: 1 }
];

test('the plan: slugs under one vault folder, depth limited, nothing taken, junk skipped', () => {
  const plan = planImport(FILES, new Set(['my-vault/x.md']));
  assert.equal(plan.root, 'my-vault-2');
  const to = Object.fromEntries(plan.items.map(i => [i.from, i.to]));
  assert.equal(to['My Vault/Projects/Q4 Plan.md'], 'my-vault-2/projects/q4-plan.md');
  assert.equal(to['My Vault/img/Shot 1.PNG'], 'my-vault-2/img/shot-1.png');
  assert.equal(to['My Vault/a/b/c/d/Deep.md'], 'my-vault-2/a/b-c-d/deep.md');
  for (const p of Object.values(to)) { const segs = p.split('/'); assert.ok(segs.length <= 4); segs.slice(0, -1).forEach(s => assert.ok(SEG.test(s), s)); }
  assert.deepEqual(plan.skipped.map(s => s.reason).sort(), ['hidden', 'not a note or image', 'over 10 MB']);
});

test('links: wikilinks, embeds and relative links point at the new paths; code is left alone', () => {
  const plan = planImport(FILES);
  const maps = linkMaps(plan);
  const daily = plan.items.find(i => i.from === 'My Vault/Daily.md');
  const out = rewriteNote('See [[Q4 Plan#Big Goals|the plan]], [[Q4 Plan]], ![[Shot 1.PNG]], [d](Projects/Q4%20Plan.md), [w](https://x.com) and [[Nowhere]]. `[[Q4 Plan]]`\n```\n[[Q4 Plan]]\n```\n',
    { from: daily.from, to: daily.to, ...maps, title: 'Daily' });
  assert.match(out, /\[the plan\]\(projects\/q4-plan\.md#big-goals\)/);
  assert.match(out, /\[Q4 Plan\]\(projects\/q4-plan\.md\)/);
  assert.match(out, /!\[Shot 1\.PNG\]\(img\/shot-1\.png\)/);
  assert.match(out, /\[d\]\(projects\/q4-plan\.md\)/);
  assert.match(out, /\[w\]\(https:\/\/x\.com\)/);
  assert.match(out, /\[\[Nowhere\]\]/);
  assert.match(out, /`\[\[Q4 Plan\]\]`\n```\n\[\[Q4 Plan\]\]\n```/);
  assert.equal(facts(out).title, 'Daily');
});

test('a note with its own title keeps it; existing frontmatter gets the title added', () => {
  const opts = { from: 'V/a.md', to: 'v/a.md', byOld: new Map(), byName: new Map(), title: 'Old Name' };
  assert.equal(rewriteNote('# Mine\n', opts), '# Mine\n');
  assert.equal(facts(rewriteNote('---\ntags: [x]\n---\nbody', opts)).title, 'Old Name');
});
