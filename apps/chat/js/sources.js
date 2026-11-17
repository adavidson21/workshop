/* Chat: the Sources list at the end of an answer (Workshop docs/knowledge.md, Citations). Tandem's hub and chat agents
   end answers with "Sources:" and the files they used, one per line, as code spans. Chat shows that list as chips:
   a Folio note opens in Folio (with That's wrong, which opens it to fix the line), a Settings file opens its page,
   anything else is shown as a path. Agent text is untrusted: everything is escaped, nothing is a link but these
   buttons. Pure, no DOM (test/sources.test.mjs). */
import { esc } from './md.js';

const HEAD = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?sources(?:\*\*|__)?\s*:?\s*(?:\*\*|__)?\s*(.*)$/i;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const MAX = 12;

/** One source's path from a list item: the first code span, else the text up to " (", " - " or ": ". */
function pathOf(item) {
  const tick = /`([^`]+)`/.exec(item);
  const raw = tick ? tick[1] : String(item).replace(/\s+(?:\(|-\s|:\s).*$/, '');
  return raw.trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/').slice(0, 300);
}

/** What a path is: {path, kind: 'note' | 'setting' | 'file', note?, page?}. */
export function classify(p) {
  const path = String(p || '').trim();
  const lc = path.toLowerCase();
  const note = /(?:^|\/)((?:products\/[a-z0-9][a-z0-9-]{0,39}|team\/handbook|tandem\/changes)\.md)$/.exec(lc);
  if (note) return { path, kind: 'note', note: note[1] };
  const set = /(?:^|\/)settings\/(products\.json|glossary\.json|repos\.json|people\.json|teams\.json|writing\.json|voice\.md)$/.exec(lc);
  if (set) {
    const page = { 'products.json': 'products', 'glossary.json': 'glossary', 'repos.json': 'repo-map', 'people.json': 'people', 'teams.json': 'team', 'writing.json': 'writing', 'voice.md': 'writing' }[set[1]];
    return { path, kind: 'setting', page };
  }
  if (lc === 'agents.md') return { path, kind: 'setting', page: 'repo-map' };
  return { path, kind: 'file' };
}

/**
 * Splits an answer into its body and its trailing Sources list. Only a list at the end counts (a heading or line
 * "Sources:" followed by list items, or "Sources: `a`, `b`" on one line). {body, sources: [classify()]}.
 */
export function splitSources(text) {
  const src = String(text == null ? '' : text);
  const lines = src.split(/\r?\n/);
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  let at = -1;
  for (let i = end - 1; i >= 0; i--) {
    const l = lines[i];
    if (HEAD.test(l) && !BULLET.test(l)) { at = i; break; }
    if (!BULLET.test(l) && l.trim()) break; // something else after the list: not a trailing Sources list
  }
  if (at < 0) return { body: src, sources: [] };
  const inline = HEAD.exec(lines[at])[1];
  const items = [];
  if (inline) items.push(...(inline.match(/`[^`]+`/g) || inline.split(/,\s*/)).filter(Boolean));
  for (let i = at + 1; i < end; i++) { const m = BULLET.exec(lines[i]); if (m) items.push(m[1]); }
  const seen = new Set();
  const sources = [];
  for (const it of items) {
    const p = pathOf(it);
    if (!p || seen.has(p.toLowerCase())) continue;
    seen.add(p.toLowerCase());
    sources.push(classify(p));
    if (sources.length >= MAX) break;
  }
  if (!sources.length) return { body: src, sources: [] };
  return { body: lines.slice(0, at).join('\n').replace(/\s+$/, ''), sources };
}

/** The chips for a Sources list, or ''. */
export function sourcesHtml(sources) {
  if (!sources || !sources.length) return '';
  const chip = s => {
    if (s.kind === 'note') return `<span class="src note"><span class="src-p" title="${esc(s.path)}">${esc(s.note)}</span><button type="button" class="lnk" data-src-note="${esc(s.note)}">Open</button><button type="button" class="lnk" data-src-wrong="${esc(s.note)}" title="Open the note in Folio to fix the line">That's wrong</button></span>`;
    if (s.kind === 'setting') return `<span class="src setting"><span class="src-p">${esc(s.path)}</span><button type="button" class="lnk" data-src-page="${esc(s.page)}">Open</button></span>`;
    return `<span class="src file"><span class="src-p">${esc(s.path)}</span></span>`;
  };
  return `<div class="srcs" role="group" aria-label="Sources"><span class="srcs-h">Sources</span>${sources.map(chip).join('')}</div>`;
}
