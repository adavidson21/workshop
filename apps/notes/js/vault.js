/* Notes: bring in a folder of Markdown, such as an Obsidian vault.

   Workshop's name rules (lowercase letters, digits and "-", at most 3 folders deep) would hide most vault files,
   so the import renames them first and shows every rename before anything is written:
     - each folder and file name is made into a slug ("Project Notes/Q4 Plan.md" -> "project-notes/q4-plan.md")
       under one folder named after the vault; folders past the depth limit are joined into the deepest one.
     - [[wikilinks]] and ![[embeds]] become standard Markdown links to the new paths, and relative Markdown links
       are pointed at the new paths, so links keep working here and in any Markdown tool. Code is left alone.
     - a note with no title of its own (no "# heading", no frontmatter title) gets its old file name as its
       frontmatter title, so it keeps the name you knew it by.
   Only .md files and PNG, JPEG, GIF and WebP images come in. Nothing is overwritten: a taken path gets -2, -3.

   Pure: no DOM and no SDK. main.js reads the picked files and writes the plan. */
import { facts, frontmatter, headingId } from './markdown.js';
import { MAX_FOLDERS, SEG, freePath, relativeLink, resolvePath, slugify } from './model.js';

const NOTE = /\.md$/i;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
export const MAX_BYTES = 10 * 1024 * 1024;

const seg = (s, fallback) => (SEG.test(s) ? s : slugify(s, fallback));
const extOf = (p) => (/\.([a-z0-9]+)$/i.exec(p) || [, ''])[1].toLowerCase().replace('jpeg', 'jpg');

/**
 * The plan for a picked folder. files: [{path, size}] with paths as picked ("My Vault/Notes/A.md", the first
 * segment is the vault folder). taken: Set of paths Notes already has.
 * Returns {root, items: [{from, to, kind: 'note'|'image'}], skipped: [{from, reason}]}.
 */
export function planImport(files, taken = new Set()) {
  const used = new Set(taken);
  const vault = (files[0] && files[0].path.split('/')[0]) || 'imported';
  const want = seg(vault, 'imported');
  let root = want;
  for (let n = 2; [...used].some(p => p.startsWith(`${root}/`)); n++) root = `${want.slice(0, 36).replace(/-+$/, '')}-${n}`;
  const items = [], skipped = [];
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = f.path.split('/').slice(1);
    if (!parts.length || parts.some(p => p.startsWith('.'))) { skipped.push({ from: f.path, reason: 'hidden' }); continue; }
    const kind = NOTE.test(f.path) ? 'note' : IMAGE.test(f.path) ? 'image' : null;
    if (!kind) { skipped.push({ from: f.path, reason: 'not a note or image' }); continue; }
    if (f.size > MAX_BYTES) { skipped.push({ from: f.path, reason: 'over 10 MB' }); continue; }
    const name = parts.pop();
    let dirs = [root, ...parts.map(p => seg(p, 'folder'))];
    if (dirs.length > MAX_FOLDERS) dirs = [...dirs.slice(0, MAX_FOLDERS - 1), slugify(dirs.slice(MAX_FOLDERS - 1).join('-'), 'folder')];
    const base = seg(name.replace(/\.[^.]+$/, ''), kind === 'note' ? 'untitled' : 'image');
    const to = freePath(used, dirs.join('/'), base, kind === 'note' ? 'md' : extOf(name));
    used.add(to);
    items.push({ from: f.path, to, kind });
  }
  return { root, items, skipped };
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
/* Apply fn to the text outside fenced code and inline code. */
function outsideCode(text, fn) {
  let fence = null;
  return text.split('\n').map(l => {
    const f = FENCE.exec(l);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return l; }
    if (fence) return l;
    return l.split(/(`+[^`]*`+)/).map((part, k) => (k % 2 ? part : fn(part))).join('');
  }).join('\n');
}

/**
 * A note's text with its links pointed at the new paths. from/to: the note's old and new paths. byOld: Map old
 * path (without the vault folder) -> new path. byName: Map lowercased file name without extension -> new path,
 * for [[wikilinks]] (Obsidian finds those by name). title: the old file name, used when the note has none.
 */
export function rewriteNote(text, { from, to, byOld, byName, title }) {
  const oldDir = from.split('/').slice(1, -1).join('/');
  const find = (target) => {
    const t = target.trim().replace(/\\/g, '/');
    const asPath = t.replace(/^\.\//, '');
    return byOld.get(asPath) || byOld.get(`${asPath}.md`) || byOld.get(oldDir ? `${oldDir}/${asPath}` : asPath) || byOld.get(oldDir ? `${oldDir}/${asPath}.md` : `${asPath}.md`)
      || byName.get(asPath.split('/').pop().replace(/\.md$/i, '').toLowerCase()) || null;
  };
  const link = (newPath, anchor) => relativeLink(to, newPath) + (anchor ? `#${headingId(anchor)}` : '');
  let out = outsideCode(String(text), (s) => s
    // ![[embed]] and [[wikilink|label]]
    .replace(/(!?)\[\[([^\]|\n#]+)(#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g, (m, bang, target, anchor, label) => {
      const hit = find(target);
      if (!hit) return m;
      const shown = (label || (target + (anchor || ''))).trim().replace(/[[\]]/g, '');
      return `${bang}[${shown}](${link(hit, anchor ? anchor.slice(1) : '')})`;
    })
    // [label](relative/path.md#anchor)
    .replace(/(!?\[(?:[^\]\\]|\\.)*\]\()\s*(<[^>\n]*>|[^)\s]+)(\s+"[^"\n]*")?\s*\)/g, (m, head, href, ttl) => {
      const raw = href.replace(/^<|>$/g, '');
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#') || raw.startsWith('/')) return m;
      const hashAt = raw.indexOf('#');
      let p = hashAt < 0 ? raw : raw.slice(0, hashAt);
      try { p = decodeURIComponent(p); } catch { /* as written */ }
      const old = resolvePath(`x/${oldDir ? oldDir + '/' : ''}n.md`, p);
      const hit = old !== null && (byOld.get(old.replace(/^x\//, '')) || null);
      if (!hit) return m;
      return `${head}${link(hit, hashAt < 0 ? '' : raw.slice(hashAt + 1))}${ttl || ''})`;
    }));
  if (title && !facts(out).title) {
    const fm = frontmatter(out);
    const line = `title: ${JSON.stringify(title)}`;
    out = fm.offset ? out.replace(/^(---[ \t]*\r?\n)/, `$1${line}\n`) : `---\n${line}\n---\n\n${out}`;
  }
  return out;
}

/** Maps for rewriteNote from a plan: {byOld, byName}. */
export function linkMaps(plan) {
  const byOld = new Map(), byName = new Map();
  for (const it of plan.items) {
    const old = it.from.split('/').slice(1).join('/');
    byOld.set(old, it.to);
    const name = old.split('/').pop().replace(it.kind === 'note' ? /\.md$/i : /$/, '').toLowerCase();
    if (!byName.has(name)) byName.set(name, it.to);
  }
  return { byOld, byName };
}

