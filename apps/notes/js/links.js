/* Folio: Links, one directory of the web links you keep going back to (SharePoint, Sheets, ADO, Teams, the wiki).

   They live in one plain note, links.md at the top of the folder, so the file reads and edits fine anywhere:

     # Links

     ## Lighthouse
     - [Lighthouse runbook](https://...) #runbook
     - [Capacity sheet](https://...) #sheet #capacity

   A group is a `## heading`; links before the first one are Ungrouped. A link is a list item with a Markdown link
   (or a bare URL), then optional #tags and words. Everything else in the file is left as it is. The kind of link
   (SharePoint, Google Sheets, ADO, ...) is read from its address for the icon and never stored.

   Pure functions of the file's text, plus createIgnored: the URLs from "Found in notes" you said no to, in Folio's
   own collection `links-ignored` (notes.links-ignored v1, items {id: <url>, at}). */
import { safeHref } from './markdown.js';

export const LINKS = 'links.md';
export const LINKS_TITLE = 'Links';
export const UNGROUPED = 'Ungrouped';
export const STARTER = `# ${LINKS_TITLE}\n`;

const ITEM = /^(\s*)[-*+]\s+(.*)$/;
const MD_LINK = /^\[((?:[^\]\\]|\\.)*)\]\((<[^>\n]+>|[^\s)]+(?:\([^\s)]*\)[^\s)]*)*)\)(.*)$/;
const BARE = /^(https?:\/\/\S+)(.*)$/i;
const TAG = /(^|\s)#([a-z0-9][\w/-]*)/gi;

/* ---------- kinds ---------- */

export const KINDS = {
  sharepoint: { label: 'SharePoint', short: 'SP' },
  excel: { label: 'Excel', short: 'XL' },
  word: { label: 'Word', short: 'W' },
  sheet: { label: 'Google Sheets', short: 'GS' },
  gdoc: { label: 'Google Docs', short: 'GD' },
  drive: { label: 'Google Drive', short: 'GD' },
  ado: { label: 'Azure DevOps', short: 'ADO' },
  wiki: { label: 'Wiki', short: 'Wk' },
  teams: { label: 'Teams', short: 'T' },
  github: { label: 'GitHub', short: 'GH' },
  web: { label: 'Web page', short: '↗' }
};

/** What a link is, from its address: one of KINDS' keys. */
export function kindOf(url) {
  let u;
  try { u = new URL(url); } catch { return 'web'; }
  const host = u.hostname.toLowerCase(), path = decodeURIComponent(u.pathname).toLowerCase();
  if (/(^|\.)teams\.(microsoft|live)\.com$/.test(host)) return 'teams';
  if (host === 'docs.google.com') return path.startsWith('/spreadsheets') ? 'sheet' : path.startsWith('/document') ? 'gdoc' : 'drive';
  if (host === 'drive.google.com' || host === 'sheets.google.com') return host.startsWith('sheets') ? 'sheet' : 'drive';
  if (/\.sharepoint\.com$/.test(host) || /onedrive\.(live\.)?com$/.test(host) || /\.sharepoint\./.test(host)) {
    if (/\/:x:\//.test(path) || /\.(xlsx|xlsm|xls|csv)(\b|$)/.test(path)) return 'excel';
    if (/\/:w:\//.test(path) || /\.docx?(\b|$)/.test(path)) return 'word';
    return 'sharepoint';
  }
  if (/\/_wiki\//.test(path)) return 'wiki';
  if (host === 'dev.azure.com' || /\.visualstudio\.com$/.test(host) || /\/_(git|workitems|build|release|boards|sprints|backlogs|dashboards|apis|queries|settings)(\/|$)/.test(path)) return 'ado';
  if (host === 'github.com') return 'github';
  if (/(^|\.)wiki\./.test(host) || /(^|\/)wiki(\/|$)/.test(path) || /confluence|atlassian\.net\/wiki/.test(host + path)) return 'wiki';
  return 'web';
}

/** The address without its scheme, for showing beside a name: "contoso.sharepoint.com". */
export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** A name for a link that has none: the last useful part of its path, or its host. */
export function nameFromUrl(url) {
  let u;
  try { u = new URL(url); } catch { return String(url).slice(0, 80); }
  const parts = u.pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } })
    .filter(s => !/^(_layouts|sites|teams|forms|r|:[a-z]:|s|d|edit|view|u|0|1|_git|_workitems|_wiki|wikis|edit\.aspx|allitems\.aspx)$/i.test(s) && !/^[A-Za-z0-9_-]{25,}$/.test(s));
  const last = parts[parts.length - 1];
  const name = last ? last.replace(/\.(aspx|html?)$/i, '').replace(/[-_+]+/g, ' ').trim() : '';
  return (name || hostOf(url) || url).slice(0, 80);
}

/* ---------- reading ---------- */

/** One line as a link, or null: {name, url, tags, note}. */
export function parseLine(raw) {
  const m = ITEM.exec(raw);
  if (!m || /^\[[ xX]\]\s/.test(m[2])) return null;
  let body = m[2].trim(), name = '', url = '', rest = '';
  const md = MD_LINK.exec(body);
  if (md) { name = md[1].replace(/\\(.)/g, '$1').trim(); url = md[2].replace(/^<|>$/g, ''); rest = md[3]; }
  else { const b = BARE.exec(body); if (!b) return null; url = b[1].replace(/[),.;:!?'"]+$/, ''); rest = body.slice(url.length); }
  const href = safeHref(url);
  if (!href) return null;
  const tags = [];
  const note = rest.replace(TAG, (_, sp, t) => { tags.push(t.toLowerCase()); return sp; }).replace(/^\s*[-:–]\s*/, '').replace(/\s+/g, ' ').trim();
  return { name: name || nameFromUrl(url), url, tags: [...new Set(tags)], note };
}

/** The file as groups of links, in file order: [{name, links: [{name, url, tags, note, line, raw, group, kind}]}].
    Ungrouped comes first, and only when it has links. Links in code blocks don't count. */
export function parseLinks(text) {
  const groups = [{ name: UNGROUPED, links: [] }];
  let cur = groups[0], fence = null;
  String(text || '').split('\n').forEach((raw, line) => {
    const f = /^\s*(```|~~~)/.exec(raw);
    if (f) { fence = fence === null ? f[1] : fence === f[1] ? null : fence; return; }
    if (fence) return;
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (h) { if (h[1].length === 2) groups.push(cur = { name: h[2], links: [] }); return; }
    const l = parseLine(raw);
    if (l) cur.links.push({ ...l, line, raw, group: cur.name, kind: kindOf(l.url) });
  });
  return groups.filter((g, k) => k > 0 || g.links.length);
}

/** Every link, flat. */
export const allLinks = (groups) => groups.flatMap(g => g.links);

/** The group names in the file (Ungrouped left out), for the Add dialog's list. */
export const groupNames = (groups) => groups.map(g => g.name).filter(n => n !== UNGROUPED);

/** Links whose name, group, tags, note or address have every word of q. */
export function filterLinks(groups, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).map(w => w.replace(/^#/, ''));
  if (!words.length) return groups;
  return groups.map(g => ({ ...g, links: g.links.filter(l => {
    const hay = `${l.name} ${g.name} ${l.tags.join(' ')} ${l.note} ${hostOf(l.url)} ${KINDS[l.kind].label}`.toLowerCase();
    return words.every(w => hay.includes(w));
  }) })).filter(g => g.links.length);
}

/** Links for a product (shared/products.js item): their group or a tag is its name, slug, another name, or
    product/<slug>. */
export function linksForProduct(groups, product) {
  if (!product) return [];
  const names = new Set([product.name, product.slug, `product/${product.slug}`, ...(product.alsoCalled || [])].map(s => String(s).toLowerCase().trim()).filter(Boolean));
  const slugged = new Set([...names].map(s => s.replace(/[^a-z0-9/]+/g, '-').replace(/^-|-$/g, '')));
  const hit = (s) => names.has(s.toLowerCase().trim()) || slugged.has(s.toLowerCase().trim());
  return allLinks(groups).filter(l => hit(l.group) || l.tags.some(hit));
}

/* ---------- writing ---------- */

/** One link as its line in the file. */
export function linkLine({ name, url, tags = [], note = '' }) {
  const label = String(name || '').trim().replace(/([[\]\\])/g, '\\$1') || nameFromUrl(url);
  const href = /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url;
  const t = tagsFrom(tags).map(x => ` #${x}`).join('');
  return `- [${label}](${href})${t}${note ? ` ${String(note).replace(/\s+/g, ' ').trim()}` : ''}`;
}

/** "runbook, #sheet  capacity" -> ['runbook', 'sheet', 'capacity'] (valid tag words only). */
export function tagsFrom(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[\s,]+/);
  return [...new Set(list.map(t => String(t).trim().replace(/^#+/, '').toLowerCase()).filter(t => /^[a-z0-9][\w/-]*$/.test(t)))];
}

const isHeading = (s) => /^#{1,2}\s/.test(s);
const groupKey = (s) => String(s || '').trim().toLowerCase();

/** The text with a link added at the end of its group (the group made at the end of the file when it isn't there).
    An empty group, or Ungrouped, puts it above the first group. */
export function addLink(text, link, group = '') {
  const lines = String(text || '').trim() ? String(text).replace(/\n+$/, '').split('\n') : STARTER.trim().split('\n');
  const line = linkLine(link);
  const g = groupKey(group) === groupKey(UNGROUPED) ? '' : String(group || '').trim();
  const headAt = g ? lines.findIndex(s => /^##\s/.test(s) && groupKey(s.replace(/^##\s+/, '').replace(/\s*#*\s*$/, '')) === groupKey(g)) : -1;
  if (g && headAt < 0) return `${lines.join('\n')}\n\n## ${g.replace(/\n/g, ' ')}\n${line}\n`;
  // The section runs from its heading (or the title; the top of the file without one) to the next # or ## heading.
  const start = g ? headAt : lines.findIndex(s => /^#\s/.test(s));
  let end = lines.length;
  for (let k = start + 1; k < lines.length; k++) if (isHeading(lines[k])) { end = k; break; }
  let at = end;
  while (at - 1 > start && !lines[at - 1].trim()) at--;
  const before = lines.slice(0, at), after = lines.slice(at);
  if (!g && before.length && /^#\s/.test(before[before.length - 1])) before.push('');
  if (after.length && after[0].trim()) after.unshift('');
  return `${[...before, line, ...after].join('\n')}\n`;
}

/** The text with the link on `line` changed (or moved to another group). Null when that line isn't `raw` anymore. */
export function updateLink(text, line, raw, link, group) {
  const lines = String(text || '').split('\n');
  if (lines[line] !== raw) return null;
  const was = parseLinks(text).flatMap(g => g.links).find(l => l.line === line);
  if (was && groupKey(was.group) === groupKey(group || UNGROUPED)) {
    lines[line] = (ITEM.exec(raw)?.[1] || '') + linkLine(link);
    return lines.join('\n');
  }
  return addLink(removeLink(text, line, raw), link, group);
}

/** The text without the link on `line`. Null when that line isn't `raw` anymore. */
export function removeLink(text, line, raw) {
  const lines = String(text || '').split('\n');
  if (lines[line] !== raw) return null;
  lines.splice(line, 1);
  return lines.join('\n');
}

/* ---------- found in notes ---------- */

const URL_IN = /\[((?:[^\]\\]|\\.)*)\]\((<https?:\/\/[^>\n]+>|https?:\/\/[^\s)]+(?:\([^\s)]*\)[^\s)]*)*)\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>()[\]"'`]+)/gi;

/** Web links in a note's text: [{url, name}], outside frontmatter, code blocks and inline code. */
export function urlsIn(text) {
  const out = [];
  let fence = null, front = false;
  String(text || '').split('\n').forEach((raw, k) => {
    if (k === 0 && raw.trim() === '---') { front = true; return; }
    if (front) { if (raw.trim() === '---') front = false; return; }
    const f = /^\s*(```|~~~)/.exec(raw);
    if (f) { fence = fence === null ? f[1] : fence === f[1] ? null : fence; return; }
    if (fence) return;
    const line = raw.replace(/`[^`]*`/g, ' ');
    for (const m of line.matchAll(URL_IN)) {
      const url = (m[2] ? m[2].replace(/^<|>$/g, '') : m[3] || m[4] || '').replace(/[),.;:!?'"]+$/, '');
      if (!safeHref(url)) continue;
      out.push({ url, name: m[1] ? m[1].replace(/\\(.)/g, '$1').trim() : '' });
    }
  });
  return out;
}

/** The same address, for comparing: no trailing slash or #. */
export const sameUrl = (u) => String(u || '').trim().replace(/#$/, '').replace(/\/+$/, '').toLowerCase();

/** Web links in other notes that aren't in links.md and weren't ignored, most used first:
    [{url, name, paths: [note paths]}]. texts: Map path -> content. Templates, history and Links itself are left out. */
export function foundInNotes(texts, groups, ignored = [], limit = 40) {
  const have = new Set(allLinks(groups).map(l => sameUrl(l.url)));
  const no = new Set([...ignored].map(sameUrl));
  const by = new Map();
  for (const [path, content] of texts) {
    if (path === LINKS || /^(templates|history|attachments)\//.test(path)) continue;
    for (const { url, name } of urlsIn(typeof content === 'string' ? content : content && content.content)) {
      const key = sameUrl(url);
      if (have.has(key) || no.has(key)) continue;
      let f = by.get(key);
      if (!f) by.set(key, f = { url, name: '', paths: [] });
      if (!f.name && name && name !== url) f.name = name;
      if (!f.paths.includes(path)) f.paths.push(path);
    }
  }
  return [...by.values()].sort((a, b) => b.paths.length - a.paths.length || (a.url < b.url ? -1 : 1)).slice(0, limit)
    .map(f => ({ ...f, name: f.name || nameFromUrl(f.url), kind: kindOf(f.url) }));
}

/* ---------- ignored (Found in notes) ---------- */

export const IGNORED = 'links-ignored';
export const IGNORED_SCHEMA = 'notes.links-ignored';
export const IGNORED_VERSION = 1;
export const blankIgnored = () => ({ schema: IGNORED_SCHEMA, version: IGNORED_VERSION, rev: 0, items: [], deleted: {} });
export const readableIgnored = (env) => !env || (env.schema === IGNORED_SCHEMA && env.version === IGNORED_VERSION && Array.isArray(env.items));

/** A copy with `url` in the ignored list (the cap keeps the newest 500). */
export function withIgnored(env, url, now = Date.now()) {
  const next = structuredClone(env || blankIgnored());
  if (!next.items.some(i => sameUrl(i.id) === sameUrl(url))) next.items.push({ id: String(url).slice(0, 2000), at: now });
  if (next.items.length > 500) next.items = next.items.sort((a, b) => b.at - a.at).slice(0, 500);
  return next;
}

export function createIgnored(ws, { onChange = () => {} } = {}) {
  let env = null;
  async function read() {
    try { env = await ws.data.get(IGNORED); } catch { env = null; }
    onChange();
  }
  read();
  try { ws.data.subscribe(IGNORED, read); } catch { /* no subscriptions here */ }
  return {
    get list() { return env && readableIgnored(env) ? env.items.map(i => i.id) : []; },
    async add(url) {
      if (!readableIgnored(env)) return;
      const before = env || blankIgnored();
      let after = withIgnored(before, url);
      ws.data.stamp(before, after);
      try { await ws.data.put(IGNORED, after); }
      catch (e) {
        if (e.code !== 'conflict' || !e.current) throw e;
        after = ws.data.merge(after, e.current);
        await ws.data.put(IGNORED, after);
      }
      env = after;
      onChange();
    }
  };
}
