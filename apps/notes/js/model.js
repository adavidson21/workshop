/* Notes: paths, the index (titles, links, backlinks, tags), search, the folder tree and link rewriting on
   rename. Pure: no DOM and no SDK, so Node tests run it.

   Paths are relative to the app folder (<Workshop folder>/notes/), "/"-separated, and follow Workshop's name
   rules (docs/data-format.md, Names): lowercase letters, digits and "-", at most 3 folders deep. Links in notes
   are standard Markdown links relative to the note, so the files work in any Markdown tool. */
import { facts } from './markdown.js';

export const APP = 'notes';
export const ATTACHMENTS = 'attachments';
export const SEG = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_FOLDERS = 3;
const NOTE_RE = /\.md$/;
const IMAGE_RE = /\.(png|jpg|jpeg|gif|webp)$/;
/* history/ holds earlier versions of notes (history.js): kept out of the tree, search and the index. */
export const HISTORY_DIR = 'history';
export const isNote = (p) => NOTE_RE.test(p) && !p.startsWith(`${HISTORY_DIR}/`);
export const isImagePath = (p) => IMAGE_RE.test(p);

/* ---------- names and paths ---------- */

/** A title to a file name part: "Deploy runbook (v2)" -> "deploy-runbook-v2". */
export function slugify(text, fallback = 'untitled') {
  const s = String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return s || fallback;
}

/** A free path free in `taken` (a Set of paths): folder/base.ext, then folder/base-2.ext and so on. */
export function freePath(taken, folder, base, ext) {
  const pre = folder ? `${folder}/` : '';
  let name = base.slice(0, 40);
  for (let n = 2; taken.has(`${pre}${name}.${ext}`); n++) {
    const tail = `-${n}`;
    name = `${base.slice(0, 40 - tail.length).replace(/-+$/, '')}${tail}`;
  }
  return `${pre}${name}.${ext}`;
}

export const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
export const stem = (p) => baseName(p).replace(/\.[^.]+$/, '');

/** Is this a folder path Notes can use (0 to 3 valid segments)? */
export function validFolder(f) {
  if (!f) return true;
  const segs = f.split('/');
  return segs.length <= MAX_FOLDERS && segs.every(s => SEG.test(s));
}

/** A path relative to the app folder, resolved from a note: ("a/b.md", "../c.md") -> "c.md". Null if it leaves the app folder. */
export function resolvePath(fromPath, rel) {
  const parts = dirOf(fromPath) ? dirOf(fromPath).split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts.join('/');
}

/** The relative link from one note to a path in the app folder: ("a/b.md", "c/d.md") -> "../c/d.md". */
export function relativeLink(fromPath, toPath) {
  const from = dirOf(fromPath) ? dirOf(fromPath).split('/') : [];
  const to = toPath.split('/');
  let k = 0;
  while (k < from.length && k < to.length - 1 && from[k] === to[k]) k++;
  return [...from.slice(k).map(() => '..'), ...to.slice(k)].join('/');
}

/** Split an href into {path, anchor}. Web links, mail links and other schemes give null. */
export function localHref(href) {
  const h = String(href || '').trim();
  if (!h || /^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('//') || h.startsWith('/')) return null;
  const hash = h.indexOf('#');
  let p = hash < 0 ? h : h.slice(0, hash);
  const anchor = hash < 0 ? '' : h.slice(hash + 1);
  try { p = decodeURIComponent(p); } catch { /* keep as written */ }
  return { path: p, anchor };
}

/* ---------- the index ---------- */

/**
 * Build the index from notes [{path, content, mtime}].
 * {notes: Map(path -> {path, title, tags, links: [{target, line, image}], headings, mtime}),
 *  backlinks: Map(target -> [{from, line}]), tags: Map(tag -> [paths]), missing: Map(target -> [from])}
 */
export function buildIndex(list) {
  const notes = new Map();
  for (const n of list) {
    const f = facts(n.content, stem(n.path));
    notes.set(n.path, { path: n.path, title: f.title || stem(n.path), tags: f.tags, headings: f.headings, raw: f, mtime: n.mtime, size: n.size });
  }
  const byTitle = titleMap(notes);
  const backlinks = new Map(), tags = new Map(), missing = new Map();
  const add = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
  for (const n of notes.values()) {
    const links = [];
    for (const l of n.raw.links) {
      const loc = localHref(l.href);
      if (!loc || !loc.path) continue;
      const target = resolvePath(n.path, loc.path);
      if (target === null) continue;
      links.push({ target, line: l.line, image: l.image });
    }
    for (const w of n.raw.wikilinks) {
      const t = resolveWiki(byTitle, notes, w.target);
      links.push({ target: t || wikiPath(w.target), line: w.line, image: false, wiki: w.target });
    }
    n.links = links;
    n.appLinks = n.raw.links.filter(l => !l.image && /^ws:/i.test(String(l.href).trim())).map(l => ({ href: l.href, line: l.line }));
    for (const l of links) {
      if (l.image || !isNote(l.target)) continue;
      if (l.target === n.path) continue;
      if (notes.has(l.target)) add(backlinks, l.target, { from: n.path, line: l.line });
      else add(missing, l.target, n.path);
    }
    for (const t of n.tags) add(tags, t, n.path);
    delete n.raw;
  }
  for (const [k, v] of backlinks) {
    const seen = new Set();
    backlinks.set(k, v.filter(b => { const key = `${b.from}:${b.line}`; if (seen.has(key)) return false; seen.add(key); return true; }));
  }
  for (const v of backlinks.values()) v.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.line - b.line));
  return { notes, backlinks, tags: new Map([...tags].sort((a, b) => (a[0] < b[0] ? -1 : 1))), missing, byTitle };
}

function titleMap(notes) {
  const m = new Map();
  for (const n of notes.values()) {
    for (const k of [n.title.toLowerCase(), stem(n.path)]) if (!m.has(k)) m.set(k, n.path);
  }
  return m;
}
/** [[target]] to a note path: by path, by title, then by file name. Null if none. */
export function resolveWiki(byTitle, notes, target) {
  const t = String(target).split('#')[0].trim();
  if (notes.has(t)) return t;
  if (notes.has(`${t}.md`)) return `${t}.md`;
  return byTitle.get(t.toLowerCase()) || byTitle.get(slugify(t)) || null;
}
/** Where a note for an unresolved [[target]] would be made. */
export const wikiPath = (target) => `${slugify(String(target).split('#')[0])}.md`;

/* ---------- search ---------- */

/** Parse a query: free words, tag:x and path:folder. */
export function parseQuery(q) {
  const out = { words: [], tags: [], paths: [] };
  for (const tok of String(q || '').match(/"[^"]*"|\S+/g) || []) {
    const t = tok.replace(/^"|"$/g, '');
    const m = /^(tag|path):(.*)$/i.exec(t);
    if (m && m[2]) (m[1].toLowerCase() === 'tag' ? out.tags : out.paths).push(m[2].replace(/^#/, '').toLowerCase());
    else if (/^#[\w/-]+$/.test(t)) out.tags.push(t.slice(1).toLowerCase());
    else if (t) out.words.push(t.toLowerCase());
  }
  return out;
}

/**
 * Search notes. contents: Map(path -> text). Returns [{path, title, line, text, score}] best first; one row per
 * note (the first matching line), at most `limit`.
 */
export function search(index, contents, query, limit = 50) {
  const q = parseQuery(query);
  if (!q.words.length && !q.tags.length && !q.paths.length) return [];
  const out = [];
  for (const n of index.notes.values()) {
    if (q.tags.length && !q.tags.every(t => n.tags.some(nt => nt === t || nt.startsWith(t + '/')))) continue;
    if (q.paths.length && !q.paths.every(p => n.path === p || n.path.startsWith(p.replace(/\/$/, '') + '/'))) continue;
    const text = contents.get(n.path) || '';
    const lower = text.toLowerCase();
    const title = n.title.toLowerCase();
    let score = 0, line = 0, lineText = '';
    let ok = true;
    for (const w of q.words) {
      const inTitle = title.includes(w), inPath = n.path.includes(w), at = lower.indexOf(w);
      if (!inTitle && !inPath && at < 0) { ok = false; break; }
      score += (inTitle ? 10 : 0) + (inPath ? 3 : 0) + (at >= 0 ? 1 : 0);
    }
    if (!ok) continue;
    if (q.words.length) {
      const lines = text.split('\n');
      const k = lines.findIndex(l => q.words.some(w => l.toLowerCase().includes(w)));
      if (k >= 0) { line = k; lineText = lines[k].trim().slice(0, 200); }
    }
    out.push({ path: n.path, title: n.title, line, text: lineText, score });
  }
  return out.sort((a, b) => b.score - a.score || (a.title < b.title ? -1 : 1)).slice(0, limit);
}

/* ---------- the tree ---------- */

/**
 * Folder tree from file paths and folders that exist only in this window (empty folders made in the UI).
 * Folders with no notes and no pending notes are hidden; attachments/ is not shown.
 * {folders: [{name, path, folders, notes}], notes: [path]} sorted, folders first.
 */
export function tree(paths, extraFolders = []) {
  const root = { name: '', path: '', folders: new Map(), notes: [] };
  const dirFor = (folder) => {
    let d = root;
    if (!folder) return d;
    let acc = '';
    for (const seg of folder.split('/')) {
      acc = acc ? `${acc}/${seg}` : seg;
      if (!d.folders.has(seg)) d.folders.set(seg, { name: seg, path: acc, folders: new Map(), notes: [] });
      d = d.folders.get(seg);
    }
    return d;
  };
  for (const p of paths) if (isNote(p) && !p.startsWith(`${ATTACHMENTS}/`)) dirFor(dirOf(p)).notes.push(p);
  for (const f of extraFolders) if (validFolder(f) && f !== ATTACHMENTS && !f.startsWith(`${ATTACHMENTS}/`)) dirFor(f);
  const finish = (d) => ({
    name: d.name, path: d.path,
    folders: [...d.folders.values()].sort((a, b) => (a.name < b.name ? -1 : 1)).map(finish),
    notes: d.notes.sort()
  });
  return finish(root);
}

/* ---------- renaming and moving ---------- */

const LINK_RE = /(!?\[(?:[^\]\\\n]|\\.)*\]\(\s*)(<[^>\n]*>|[^)\s]*)((?:\s+"[^"\n]*")?\s*\))/g;
const WIKI_RE = /\[\[([^\]|\n#]+)(#[^\]|\n]*)?(\|[^\]\n]+)?\]\]/g;

/** Run fn over the text outside code (fenced blocks and code spans); code is left exactly as it was. */
export function outsideCode(text, fn) {
  const out = [];
  let fence = null, buf = [];
  const flush = () => {
    if (!buf.length) return;
    out.push(buf.join('\n').split(/(`+[^`\n]*?`+)/).map((s, j) => (j % 2 ? s : fn(s))).join(''));
    buf = [];
  };
  for (const l of String(text).split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (fence) {
      out.push(l);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(l)) fence = null;
      continue;
    }
    if (m) { flush(); fence = m[1]; out.push(l); continue; }
    buf.push(l);
  }
  flush();
  return out.join('\n');
}

/**
 * Rewrite the links in one note for a set of moves (old path -> new path), the note itself possibly among them.
 * Every standard relative link is resolved from where the note was and written again from where it will be,
 * to where its target will be: so links to moved notes follow them, and a moved note's own links still reach
 * what they reached before. [[wikilinks]] that named a moved note by file name or path follow too; those that
 * use its title still work and are left alone. Code is never changed. Returns {content, count}.
 * index: {notes, byTitle} from buildIndex, before the moves.
 */
export function relink(content, fromOld, moves, index) {
  const fromNew = moves.get(fromOld) || fromOld;
  let count = 0;
  const next = outsideCode(content, (s) => s
    .replace(LINK_RE, (m, pre, href, post) => {
      const loc = localHref(href.replace(/^<|>$/g, ''));
      if (!loc || !loc.path) return m;
      const target = resolvePath(fromOld, loc.path);
      if (target === null) return m;
      const to = moves.get(target) || target;
      const rel = relativeLink(fromNew, to) + (loc.anchor ? `#${loc.anchor}` : '');
      if (rel === href.replace(/^<|>$/g, '')) return m;
      if (to === target && fromNew === fromOld) return m; // nothing it depends on moved: keep it as written
      count++;
      return `${pre}${href.startsWith('<') ? `<${rel}>` : rel}${post}`;
    })
    .replace(WIKI_RE, (m, target, anchor = '', alias = '') => {
      const t = target.trim(), lt = t.toLowerCase();
      for (const [from, to] of moves) {
        const byName = lt === stem(from) || lt === from || lt === from.replace(/\.md$/, '');
        if (!byName) continue;
        if (index && index.byTitle && index.byTitle.get(lt) && index.byTitle.get(lt) !== from) continue; // names another note
        const replacement = t.includes('/') ? to.replace(/\.md$/, '') : stem(to);
        if (replacement === t) return m;
        count++;
        return `[[${replacement}${anchor}${alias}]]`;
      }
      return m;
    }));
  return { content: next, count };
}

/** The new path of `p` when folder `from` is renamed to `to`, or null if p is not inside it. */
export function movedPath(p, from, to) {
  if (p === from) return to;
  if (!p.startsWith(from + '/')) return null;
  return to + p.slice(from.length);
}

/* ---------- small helpers ---------- */

/** Starting text for a new note. */
export const newNoteText = (title) => `# ${String(title || 'Untitled').replace(/\n/g, ' ')}\n\n`;

/** "3 min ago" style age. */
export function age(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toISOString().slice(0, 10);
}
