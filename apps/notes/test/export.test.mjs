// Notes: Copy for wiki (apps/notes/js/export.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataUrl, inlineImages, wikiHtml } from '../js/export.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const URL_PNG = dataUrl('image/png', PNG);

test('dataUrl encodes bytes as base64', () => {
  assert.equal(URL_PNG, 'data:image/png;base64,iVBORw0KGgo=');
});

test('inlineImages embeds folder images once each, leaves code, remote images and missing ones', async () => {
  const md = '# Run\n\n![a](../attachments/a.png) ![a again](<../attachments/a.png> "t")\n![web](https://x.test/i.png) ![gone](../attachments/gone.png)\n\n```\n![a](../attachments/a.png)\n```\n`![a](../attachments/a.png)`\n';
  const asked = [];
  const r = await inlineImages(md, 'runbooks/run.md', async (p) => { asked.push(p); return p.endsWith('a.png') ? URL_PNG : null; });
  assert.deepEqual(asked, ['attachments/a.png', 'attachments/gone.png'], 'each image is read once');
  assert.equal(r.markdown, `# Run\n\n![a](${URL_PNG}) ![a again](${URL_PNG} "t")\n![web](https://x.test/i.png) ![gone](../attachments/gone.png)\n\n\`\`\`\n![a](../attachments/a.png)\n\`\`\`\n\`![a](../attachments/a.png)\`\n`);
  assert.deepEqual(r.embedded, ['attachments/a.png']);
  assert.deepEqual(r.missing, ['attachments/gone.png']);
});

test('wikiHtml: images inside, web links kept, note links and tags as plain text, no Workshop attributes', async () => {
  const md = `# Title\n\nSee [guide](guide.md), [[Other]], [web](https://example.com) #ops\n\n![a](${URL_PNG}) ![w](https://x.test/i.png) ![local](a.png)\n\n<script>alert(1)</script>`;
  const html = wikiHtml(md);
  assert.match(html, /^<h1>Title<\/h1><p>See guide, Other, <a href="https:\/\/example.com\/" target="_blank" rel="noopener noreferrer">web<\/a> #ops<\/p>/);
  assert.ok(html.includes(`<img src="${URL_PNG}" alt="a">`));
  assert.ok(html.includes('<img src="https://x.test/i.png" alt="w">'));
  assert.match(html, /image not found: local/);
  assert.ok(!/data-line|data-note|id="h-|<script/.test(html), html);
  assert.ok(!wikiHtml('![x](data:text/html;base64,PHNjcmlwdD4=)').includes('<img'), 'only image data: URLs');
});
