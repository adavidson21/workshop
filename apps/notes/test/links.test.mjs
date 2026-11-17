// Folio 4.10.0: Links, the directory of web links in links.md (links.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LINKS, UNGROUPED, addLink, allLinks, blankIgnored, filterLinks, foundInNotes, groupNames, kindOf, linkLine, linksForProduct,
  nameFromUrl, parseLine, parseLinks, readableIgnored, removeLink, tagsFrom, updateLink, urlsIn, withIgnored
} from '../js/links.js';

const FILE = `# Links

- [Team calendar](https://contoso.sharepoint.com/sites/team/calendar.aspx)

## Lighthouse
- [Lighthouse runbook](https://contoso.sharepoint.com/:w:/r/sites/eng/runbook.docx) #runbook
- [Capacity](https://docs.google.com/spreadsheets/d/abc/edit) #sheet #capacity - the team's sheet

\`\`\`
- [Not a link](https://example.com/in-code)
\`\`\`

## HR
- https://hr.example.com/pto
- [ ] a task, not a link
Some words under HR.
`;

test('reads groups, links, tags and notes; skips code and tasks', () => {
  const g = parseLinks(FILE);
  assert.deepEqual(g.map(x => x.name), [UNGROUPED, 'Lighthouse', 'HR']);
  assert.deepEqual(g[1].links.map(l => l.name), ['Lighthouse runbook', 'Capacity']);
  assert.deepEqual(g[1].links[1].tags, ['sheet', 'capacity']);
  assert.equal(g[1].links[1].note, "the team's sheet");
  assert.equal(g[1].links[1].kind, 'sheet');
  assert.equal(g[1].links[0].kind, 'word');
  assert.equal(g[2].links.length, 1);
  assert.equal(g[2].links[0].name, 'pto');
  assert.equal(allLinks(g).length, 4);
  assert.deepEqual(groupNames(g), ['Lighthouse', 'HR']);
  assert.equal(parseLine('- [x](javascript:alert(1))'), null);
  assert.equal(parseLinks('# Links\n').length, 0);
});

test('kinds from the address', () => {
  assert.equal(kindOf('https://contoso.sharepoint.com/sites/x'), 'sharepoint');
  assert.equal(kindOf('https://contoso.sharepoint.com/:x:/r/sites/x/plan.xlsx'), 'excel');
  assert.equal(kindOf('https://docs.google.com/document/d/1'), 'gdoc');
  assert.equal(kindOf('https://ado.corp.local/Collection/Proj/_git/repo'), 'ado');
  assert.equal(kindOf('https://dev.azure.com/org/proj/_workitems/edit/1'), 'ado');
  assert.equal(kindOf('https://ado.corp.local/Collection/Proj/_wiki/wikis/x'), 'wiki');
  assert.equal(kindOf('https://teams.microsoft.com/l/channel/1'), 'teams');
  assert.equal(kindOf('https://github.com/a/b'), 'github');
  assert.equal(kindOf('https://example.com'), 'web');
  assert.equal(nameFromUrl('https://contoso.sharepoint.com/sites/eng/Shared%20Documents/On-call_rota.aspx'), 'On call rota');
});

test('adding puts a link at the end of its group, or makes the group', () => {
  const a = addLink(FILE, { name: 'Dashboards', url: 'https://x.example.com/d', tags: ['dash'] }, 'lighthouse');
  const g = parseLinks(a);
  assert.deepEqual(g[1].links.map(l => l.name), ['Lighthouse runbook', 'Capacity', 'Dashboards']);
  const b = addLink(FILE, { name: 'Wiki home', url: 'https://wiki.example.com/' }, 'Platform');
  assert.match(b, /\n\n## Platform\n- \[Wiki home\]\(https:\/\/wiki\.example\.com\/\)\n$/);
  const c = addLink(FILE, { name: 'Loose', url: 'https://a.example.com' }, '');
  assert.deepEqual(parseLinks(c)[0].links.map(l => l.name), ['Team calendar', 'Loose']);
  assert.equal(addLink('', { name: 'First', url: 'https://a.example.com' }, ''), '# Links\n\n- [First](https://a.example.com)\n');
  assert.equal(addLink('# Links\n', { name: 'G', url: 'https://a.example.com' }, 'HR'), '# Links\n\n## HR\n- [G](https://a.example.com)\n');
  // Hand-written text around the links stays.
  assert.match(addLink(FILE, { name: 'X', url: 'https://x.example.com' }, 'HR'), /Some words under HR\.\n- \[X\]/);
});

test('editing and removing change only that line, and refuse when it changed', () => {
  const l = parseLinks(FILE)[1].links[0];
  const e = updateLink(FILE, l.line, l.raw, { name: 'Runbook', url: l.url, tags: ['runbook', 'oncall'] }, 'Lighthouse');
  assert.equal(e.split('\n')[l.line], `- [Runbook](${l.url}) #runbook #oncall`);
  assert.equal(e.split('\n').length, FILE.split('\n').length);
  const moved = updateLink(FILE, l.line, l.raw, { name: l.name, url: l.url }, 'HR');
  assert.deepEqual(parseLinks(moved).find(g => g.name === 'HR').links.map(x => x.name), ['pto', 'Lighthouse runbook']);
  assert.equal(updateLink(FILE, l.line, 'something else', { name: 'x', url: l.url }, 'HR'), null);
  const r = removeLink(FILE, l.line, l.raw);
  assert.ok(!r.includes('Lighthouse runbook'));
  assert.equal(removeLink(FILE, l.line, 'nope'), null);
});

test('lines: escapes names, wraps odd addresses, cleans tags', () => {
  assert.equal(linkLine({ name: 'a [b]', url: 'https://x.example.com/a b', tags: '#One, two bad! ' }), '- [a \\[b\\]](<https://x.example.com/a b>) #one #two');
  assert.deepEqual(parseLine(linkLine({ name: 'a [b]', url: 'https://x.example.com/(a)' })).name, 'a [b]');
  assert.deepEqual(tagsFrom('a, #b  c'), ['a', 'b', 'c']);
});

test('filter and product links', () => {
  const g = parseLinks(FILE);
  assert.deepEqual(allLinks(filterLinks(g, 'capacity')).map(l => l.name), ['Capacity']);
  assert.deepEqual(allLinks(filterLinks(g, '#runbook')).map(l => l.name), ['Lighthouse runbook']);
  assert.deepEqual(allLinks(filterLinks(g, 'sharepoint calendar')).map(l => l.name), ['Team calendar']);
  const p = { name: 'Lighthouse', slug: 'lighthouse', alsoCalled: ['LH'] };
  assert.deepEqual(linksForProduct(g, p).map(l => l.name), ['Lighthouse runbook', 'Capacity']);
  const tagged = parseLinks('## Misc\n- [A](https://a.example.com) #lh\n- [B](https://b.example.com) #product/lighthouse\n- [C](https://c.example.com)');
  assert.deepEqual(linksForProduct(tagged, p).map(l => l.name), ['A', 'B']);
  assert.deepEqual(linksForProduct(g, null), []);
});

test('found in notes: web links outside code, not saved or ignored, most used first', () => {
  assert.deepEqual(urlsIn('---\nsource: https://front.example.com\n---\nSee [plan](https://a.example.com/plan) and https://b.example.com/x.\n`https://code.example.com`\n```\nhttps://fence.example.com\n```'),
    [{ url: 'https://a.example.com/plan', name: 'plan' }, { url: 'https://b.example.com/x', name: '' }]);
  const texts = new Map([
    ['a.md', 'https://b.example.com/x and [Calendar](https://contoso.sharepoint.com/sites/team/calendar.aspx/)'],
    ['b.md', { content: 'Again https://b.example.com/x, and [Plan](https://a.example.com/plan)' }],
    ['templates/t.md', 'https://t.example.com'],
    [LINKS, FILE],
    ['c.md', 'https://ignored.example.com']
  ]);
  const f = foundInNotes(texts, parseLinks(FILE), ['https://ignored.example.com/']);
  assert.deepEqual(f.map(x => [x.url, x.paths.length, x.name]), [['https://b.example.com/x', 2, 'x'], ['https://a.example.com/plan', 1, 'Plan']]);
});

test('ignored: an envelope of URLs, no repeats', () => {
  assert.ok(readableIgnored(null));
  const e = withIgnored(withIgnored(blankIgnored(), 'https://a.example.com', 1), 'https://a.example.com/', 2);
  assert.equal(e.items.length, 1);
  assert.ok(!readableIgnored({ schema: 'other', version: 1, items: [] }));
});
