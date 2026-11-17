/* The knowledge base, the pure parts (docs/knowledge.md): the workspace repo map Workshop writes from Settings,
   reading a hand-written one to import it, Settings' own `repos` collection (what each repo is), and the checks for
   facts kept twice or missing. No DOM or SDK (shared/test/knowledge.test.mjs). */
import { ownersOf } from './products.js';

export const MARKER = '<!-- Written by Workshop -->';
export const MAP_FILE = 'AGENTS.md';
export const KEPT_FILE = 'AGENTS.md.hand-written.md';

/** True when the text is a repo map Workshop wrote (it starts with the marker). */
export const isGenerated = t => String(t || '').replace(/^﻿/, '').trimStart().startsWith(MARKER);

/* ---------- settings.repos: what each repo is, and the map settings (Settings' own collection) ---------- */
export const REPOS = 'repos';
export const REPOS_SCHEMA = 'settings.repos';
export const REPOS_VERSION = 1;
export const MAX_REPO_ROWS = 300;
export const reposBlank = () => ({ schema: REPOS_SCHEMA, version: REPOS_VERSION, rev: 0, items: [], deleted: {}, meta: {} });
export const reposReadable = env => !env || (env.schema === REPOS_SCHEMA && env.version === REPOS_VERSION && Array.isArray(env.items));

const oneLine = (v, max) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const folderKey = f => String(f || '').replaceAll('\\', '/').replace(/\/+$/, '').trim().toLowerCase();
/** The id for a repo folder: r_ and its folder as a slug (at most 40 characters after r_). */
export function repoId(folder) {
  const s = folderKey(folder).replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40).replace(/-+$/, '');
  return `r_${s || 'repo'}`;
}

/** [{id, folder, about}] from the envelope. */
export function reposList(env) {
  const items = env && Array.isArray(env.items) ? env.items : [];
  return items.filter(x => x && typeof x.folder === 'string' && x.folder.trim())
    .map(x => ({ id: x.id, folder: x.folder.trim(), about: oneLine(x.about, 200) }));
}

/** The map settings: {autoWrite (default true), writtenAt, extra (Markdown kept from an imported map)}. */
export function reposMeta(env) {
  const m = (env && env.meta) || {};
  return { autoWrite: m.autoWrite !== false, writtenAt: typeof m.writtenAt === 'number' ? m.writtenAt : null, extra: typeof m.extra === 'string' ? m.extra : '' };
}

/** Items with `abouts` ([{folder, about}]) set: an empty about removes the row. Returns new items. */
export function setAbouts(items, abouts) {
  const out = (items || []).filter(Boolean).map(x => ({ ...x }));
  for (const a of abouts || []) {
    const about = oneLine(a && a.about, 200);
    const k = folderKey(a && a.folder);
    if (!k) continue;
    const i = out.findIndex(x => folderKey(x.folder) === k);
    if (!about) { if (i >= 0) out.splice(i, 1); continue; }
    if (i >= 0) out[i] = { ...out[i], about };
    else out.push({ id: repoId(a.folder), folder: String(a.folder).trim(), about });
  }
  return out.slice(0, MAX_REPO_ROWS);
}

/* ---------- Markdown tables ---------- */
const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
const isSep = line => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cell = s => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').trim();
const unTick = s => String(s || '').replace(/^`+|`+$/g, '').trim();
// Template filler: an (example) row or text, a TODO(you).
const placeholder = s => /\(example\)|TODO\(you\)/i.test(String(s || ''));
const stripExample = s => String(s || '').replace(/\(example[^)]*\)/gi, '').replace(/TODO\(you\)/gi, '').trim();

/** The first table at or after line `from` in `lines`: rows of cells, header and separator left out. */
function tableAt(lines, from = 0) {
  let i = from;
  while (i < lines.length && !lines[i].trim().startsWith('|')) i++;
  const rows = [];
  let header = null;
  for (; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    if (isSep(lines[i])) continue;
    if (!header) { header = cells(lines[i]); continue; }
    rows.push(cells(lines[i]));
  }
  return { header: header || [], rows };
}

/** A list from a bullet's value: split on commas, " then " and " + "; backticks and template filler dropped. */
function listOf(v, { plus = true } = {}) {
  return stripExample(v).split(plus ? /,|\s+then\s+|\s+\+\s+/i : /,|\s+then\s+/i).map(x => unTick(x.trim()).replace(/\.$/, '').trim()).filter(Boolean);
}

/**
 * Reads a repo map written from eng-agents' company/repo-map.template.md (by hand or by Workshop).
 * Returns {repos: [{folder, about, stack, shared}], products: [{name, alsoCalled, repos, areas, together, changeOrder,
 * entryPoints, external, processes, docsFolder}], glossary: [{term, code, product, where}], extra} where `extra`
 * is every other `##` section as Markdown (kept so nothing is lost). Template filler is skipped.
 */
export function parseRepoMap(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const sections = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (m && !lines[i].startsWith('###')) { cur = { title: m[1].trim(), start: i, lines: [] }; sections.push(cur); continue; }
    if (cur) cur.lines.push(lines[i]);
  }
  const out = { repos: [], products: [], glossary: [], extra: '' };
  const extra = [];
  for (const s of sections) {
    const t = s.title.toLowerCase();
    const body = s.lines.filter(l => !/^<!--.*-->$/.test(l.trim()));
    if (t === 'repos') {
      for (const r of tableAt(body).rows) {
        const folder = unTick(r[0]);
        if (!folder || placeholder(folder) || r.some(c => /\(example\)/i.test(c))) continue;
        const about = /TODO\(you\)/i.test(r[1] || '') ? '' : oneLine(r[1], 200);
        out.repos.push({ folder, about, stack: stripExample(r[2] || ''), shared: /^y/i.test(r[3] || '') });
      }
    } else if (t === 'products') {
      let p = null;
      const flush = () => { if (p && p.name) out.products.push(p); p = null; };
      for (let i = 0; i < body.length; i++) {
        const l = body[i];
        const h = /^###\s+(.+?)\s*#*\s*$/.exec(l);
        if (h) {
          flush();
          const name = stripExample(h[1]).replace(/^Product name$/i, '').trim();
          p = name ? { name, alsoCalled: [], repos: [], areas: [], together: [], changeOrder: [], entryPoints: [], external: [], processes: [], docsFolder: '' } : null;
          continue;
        }
        if (!p) continue;
        const kv = /^\s*(?:[-*]\s+)?([A-Za-z ]+?):\s*(.*)$/.exec(l);
        if (l.trim().startsWith('|')) {
          const tb = tableAt(body, i);
          for (const r of tb.rows) { const f = unTick(r[0]); if (f && !placeholder(f) && !r.some(c => /\(example\)/i.test(c))) p.repos.push(f); }
          while (i + 1 < body.length && body[i + 1].trim().startsWith('|')) i++;
          continue;
        }
        if (!kv) continue;
        const key = kv[1].trim().toLowerCase(), val = kv[2];
        if (key === 'also called') p.alsoCalled = listOf(val.replace(/\(other names[^)]*\)/i, ''), { plus: false });
        else if (key === 'usually change together') p.together = stripExample(val) ? [stripExample(val).replace(/^\(|\)$/g, '').trim()].filter(Boolean) : [];
        else if (key === 'change order') p.changeOrder = listOf(val, { plus: false });
        else if (key === 'entry points') p.entryPoints = listOf(val, { plus: false });
        else if (key === 'external systems') p.external = stripExample(val).replace(/Systems outside these repos.*$/i, '').trim() ? listOf(val.replace(/Systems outside these repos.*$/i, ''), { plus: false }) : [];
        else if (key === 'business processes') p.processes = listOf(val.replace(/Used by `\/tsd`.*$/i, ''), { plus: false });
        else if (key === 'product docs') p.docsFolder = unTick(stripExample(val).replace(/Read these.*$/i, '').replace(/\.$/, '').trim());
        else if (key === 'area paths') p.areas = listOf(val, { plus: false });
      }
      flush();
      for (const p2 of out.products) p2.repos = [...new Set(p2.repos)];
    } else if (t === 'glossary') {
      for (const r of tableAt(body).rows) {
        const term = unTick(r[0]), code = unTick(r[1]);
        if (!term || !code || r.some(placeholder)) continue;
        out.glossary.push({ term, code, product: stripExample(r[2] || ''), where: unTick(stripExample(r[3] || '')) });
      }
    } else if (t === 'knowledge') {
      // Workshop's own pointer section: rebuilt on every write.
    } else {
      const md = [`## ${s.title}`, ...body].join('\n').replace(/\s+$/, '');
      if (stripExample(md.replace(/^##.*$/m, '')).replace(/[|\-\s:]/g, '')) extra.push(md);
    }
  }
  out.extra = extra.join('\n\n');
  return out;
}

/* ---------- writing the map ---------- */

/**
 * The repo map's text.
 * @param {object} o
 * @param {Array} o.products active products (shared/products.js list, archived left out by the caller)
 * @param {Array} o.glossary words (shared/glossary.js list)
 * @param {Array} o.repos settings.repos items [{folder, about}]
 * @param {Array} o.info the opencode connector's knowledge.repos [{folder, stack, purpose}] (may be empty)
 * @param {string} o.previous the map's current text, so a row's description that is not in Settings survives
 * @param {Array} o.people active directory people, for owners
 * @param {string} o.extra other sections kept from an imported map
 */
export function buildRepoMap({ products = [], glossary = [], repos = [], info = [], previous = '', people = [], extra = '' } = {}) {
  const prev = previous ? parseRepoMap(previous).repos : [];
  const about = new Map(), stacks = new Map();
  for (const r of prev) { if (r.about) about.set(folderKey(r.folder), r.about); if (r.stack) stacks.set(folderKey(r.folder), r.stack); }
  for (const i of info) if (i && i.purpose && !about.has(folderKey(i.folder))) about.set(folderKey(i.folder), oneLine(i.purpose, 200));
  for (const r of repos) if (r && r.about) about.set(folderKey(r.folder), r.about);
  for (const i of info) if (i && i.stack) stacks.set(folderKey(i.folder), i.stack);

  // Every folder: the workspace's, then any a product names that the workspace does not have.
  const folders = [];
  const seen = new Set();
  const add = f => { const k = folderKey(f); if (k && !seen.has(k)) { seen.add(k); folders.push(String(f).trim()); } };
  for (const i of info) add(i.folder);
  for (const p of products) for (const r of p.repos || []) add(r);
  for (const r of repos) add(r.folder);
  for (const r of prev) add(r.folder);
  const productsOf = f => products.filter(p => (p.repos || []).some(r => folderKey(r) === folderKey(f)));
  const desc = f => about.get(folderKey(f)) || 'TODO(you): what it is, in one line (Settings, Knowledge, Repo map)';

  const L = [];
  L.push(MARKER);
  L.push('# Workspace repo map', '');
  L.push('Agents: use this file to choose repos for a work item. First match the work item to a product (Products and Glossary), then use that product\'s repos and change order. Then run `Get-Knowledge.ps1 -Product "<product>"` for its rules, owners, glossary and the team handbook (Knowledge, below).', '');
  L.push('Workshop writes this file from Settings, Knowledge. Change products, the glossary and what each repo is there; edits made here are replaced.', '');
  L.push('## Repos', '', 'One row per repo folder in this workspace.', '', '| Folder | What it is (one line) | Stack | Shared? |', '|---|---|---|---|');
  for (const f of folders.slice().sort((a, b) => a.localeCompare(b))) L.push(`| ${cell(f)} | ${cell(desc(f))} | ${cell(stacks.get(folderKey(f)) || '')} | ${productsOf(f).length > 1 ? 'Yes' : 'No'} |`);
  L.push('', '## Products', '');
  if (!products.length) L.push('No products yet. Add them in Workshop: Settings, Knowledge, Products.', '');
  for (const p of products.slice().sort((a, b) => a.name.localeCompare(b.name))) {
    L.push(`### ${p.name}`, '');
    if ((p.alsoCalled || []).length) L.push(`Also called: ${p.alsoCalled.join(', ')}`, '');
    L.push(`Note: \`products/${p.slug}.md\``, '');
    if ((p.areas || []).length) L.push(`Area paths: ${p.areas.map(a => `\`${a}\``).join(', ')}`, '');
    if ((p.repos || []).length) {
      L.push('| Repo | What it is |', '|---|---|');
      for (const r of p.repos) L.push(`| ${cell(r)} | ${cell(desc(r))} |`);
      L.push('');
    }
    const bullets = [
      ['Usually change together', (p.together || []).join('; ')],
      ['Change order', (p.changeOrder || []).join(', then ')],
      ['Entry points', (p.entryPoints || []).map(x => `\`${x}\``).join(', ')],
      ['External systems', (p.external || []).join(', ')],
      ['Business processes', (p.processes || []).join(', ')],
      ['Product docs', p.docsFolder ? `\`${p.docsFolder}\`` : ''],
      ['Owners', ownersOf(p, people).map(o => o.name).join(', ')]
    ].filter(([, v]) => v);
    for (const [k, v] of bullets) L.push(`- ${k}: ${v}`);
    if (bullets.length) L.push('');
  }
  L.push('## Glossary', '', 'Words from work items mapped to what they are called in code.', '');
  if (glossary.length) {
    const nameOf = new Map(products.map(p => [p.id, p.name]));
    L.push('| Work item term | Name in code | Product | Where it shows up |', '|---|---|---|---|');
    for (const w of glossary) L.push(`| ${cell(w.term)} | \`${cell(w.code)}\` | ${cell(nameOf.get(w.productId) || '')} | ${w.where ? `\`${cell(w.where)}\`` : ''} |`);
  } else L.push('No words yet. Add them in Workshop: Settings, Knowledge, Glossary.');
  L.push('');
  if (String(extra || '').trim()) L.push(String(extra).trim(), '');
  L.push('## Knowledge', '');
  L.push('- Product rules, gotchas, decisions and links: the product note, `products/<slug>.md` in Workshop\'s Folio.');
  L.push('- Team process (sprints, work item states, pull requests, releases, definition of done): Folio\'s `team/handbook.md`.');
  L.push('- Owners and who to ask: Workshop\'s People (never typed into notes).');
  L.push('- All of it for one product, in one call: `Get-Knowledge.ps1 -Product "<product>"`; the handbook alone: `Get-Knowledge.ps1 -Handbook`.');
  L.push('');
  return L.join('\n');
}

/* ---------- import ---------- */

/**
 * What importing a parsed map would add, leaving everything already in Settings alone.
 * Returns {newProducts: [inputs for products.upsert], updates: [{id, name, input, added: [field names]}],
 * renamed: {imported name: stored name}, words: the imported glossary rows, abouts: [{folder, about}], extra, count}.
 */
export function importPlan(parsed, { products = [], repos = [] } = {}) {
  const lists = ['alsoCalled', 'repos', 'areas', 'together', 'changeOrder', 'entryPoints', 'external', 'processes'];
  const find = name => {
    const k = String(name || '').trim().toLowerCase();
    return products.find(p => p.name.toLowerCase() === k || (p.alsoCalled || []).some(a => a.toLowerCase() === k)) || null;
  };
  const newProducts = [], updates = [], renamed = {};
  for (const p of (parsed && parsed.products) || []) {
    const old = find(p.name) || (p.alsoCalled || []).map(find).find(Boolean) || null;
    if (old && old.name !== p.name) renamed[p.name] = old.name;
    if (!old) {
      const input = { name: p.name };
      for (const k of lists) if ((p[k] || []).length) input[k] = p[k];
      if (p.docsFolder) input.docsFolder = p.docsFolder;
      newProducts.push(input);
      continue;
    }
    const input = { name: old.name }, added = [];
    for (const k of lists) {
      const have = old[k] || [];
      const extra = (p[k] || []).filter(x => !have.some(h => h.toLowerCase() === String(x).toLowerCase()));
      // Lists that only make sense whole (order) are filled only when empty.
      if (k === 'changeOrder' && have.length) { input[k] = have; continue; }
      input[k] = [...have, ...extra];
      if (extra.length) added.push(k);
    }
    input.docsFolder = old.docsFolder || p.docsFolder || '';
    if (!old.docsFolder && p.docsFolder) added.push('docsFolder');
    if (added.length) updates.push({ id: old.id, name: old.name, input, added });
  }
  const known = new Set(repos.filter(r => r.about).map(r => folderKey(r.folder)));
  const abouts = ((parsed && parsed.repos) || []).filter(r => r.about && !known.has(folderKey(r.folder))).map(r => ({ folder: r.folder, about: r.about }));
  const words = (parsed && parsed.glossary) || [];
  return { newProducts, updates, renamed, words, abouts, extra: (parsed && parsed.extra) || '', count: newProducts.length + updates.length + abouts.length };
}

/* ---------- checks ---------- */

/** A note line as compared across files: no bullet, no "(date, source)" or "(check: ...)" ending, lower case. */
export function lineKey(line) {
  return String(line || '').replace(/^\s*[-*]\s+(\[[ xX]\]\s+)?/, '')
    .replace(/\s*\((?:check:[^)]*|\d{4}-\d{2}-\d{2}(?:,[^)]*)?)\)\s*$/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The bullet lines of a `## <name>` section in Markdown, or []. */
export function sectionLines(md, name) {
  const lines = String(md || '').split(/\r?\n/);
  const at = lines.findIndex(l => new RegExp(`^##\\s+${name}\\s*$`, 'i').test(l.trim()));
  if (at < 0) return [];
  const out = [];
  for (let i = at + 1; i < lines.length && !/^#{1,2}\s/.test(lines[i]); i++) if (/^\s*[-*]\s+\S/.test(lines[i])) out.push(lines[i].trim());
  return out;
}

/**
 * What is kept twice or missing. Each finding: {id, text, fix: {page} | {note}}.
 * @param {object} o
 * @param {Array} o.products active products
 * @param {Array} o.glossary words
 * @param {Array|null} o.info knowledge.repos (null: the workspace could not be read; repo checks skipped)
 * @param {Map<string,string>} o.notes product note text by slug (missing notes left out)
 * @param {Array} o.people active directory people
 * @param {{exists: boolean, generated: boolean}|null} o.map the repo map's state
 */
export function checks({ products = [], glossary = [], info = null, notes = new Map(), people = [], map = null } = {}) {
  const out = [];
  if (info && products.length) {
    const inSome = new Set(products.flatMap(p => (p.repos || []).map(folderKey)));
    for (const r of info) if (!inSome.has(folderKey(r.folder))) out.push({ id: `orphan:${r.folder}`, text: `${r.folder} is in the workspace but in no product.`, fix: { page: 'products' } });
    const have = new Set(info.map(r => folderKey(r.folder)));
    for (const p of products) for (const r of p.repos || []) if (!have.has(folderKey(r))) out.push({ id: `missing:${p.id}:${r}`, text: `${p.name} lists ${r}, which is not in the workspace.`, fix: { page: 'products' } });
  }
  const seen = new Map();
  for (const w of glossary) {
    const k = `${w.productId || ''}\u0000${w.term.toLowerCase()}`;
    if (seen.has(k)) out.push({ id: `word:${k}`, text: `"${w.term}" is in the glossary twice.`, fix: { page: 'glossary' } });
    seen.set(k, true);
  }
  for (const p of products) {
    const md = notes.get(p.slug);
    if (!md) continue;
    // Owner lines Folio used to copy in ("Name: owns ..."), for people the directory already has.
    const named = sectionLines(md, 'People').filter(l => /:\s*owns\s/i.test(l) && people.some(x => x && x.name && lineKey(l).startsWith(x.name.toLowerCase())));
    if (named.length) out.push({ id: `people:${p.slug}`, text: `${p.name}'s note lists owners that People already has (Owns). Take them out of the note so they are kept in one place.`, fix: { note: `products/${p.slug}.md` } });
    if (info) {
      const noteKeys = new Set(String(md).split(/\r?\n/).filter(l => /^\s*[-*]\s+\S/.test(l)).map(lineKey).filter(k => k.length > 8));
      for (const r of info.filter(i => (p.repos || []).some(x => folderKey(x) === folderKey(i.folder)))) {
        const twice = (r.remembered || []).find(l => noteKeys.has(lineKey(l)));
        if (twice) out.push({ id: `twice:${p.slug}:${r.folder}`, text: `"${lineKey(twice).slice(0, 80)}" is in ${p.name}'s note and in ${r.folder}'s repo guide. Keep it in one place.`, fix: { note: `products/${p.slug}.md` } });
      }
    }
  }
  if (map && map.exists && !map.generated && products.length) out.push({ id: 'map:hand', text: 'The repo map is still written by hand, so agents do not see your products and glossary from Settings.', fix: { page: 'repo-map' } });
  return out;
}
