/* Notebook: the Tandem section. Tandem's .work documents (plan.md, spec.md, review.md, brief.md, findings.md...)
   shown and edited in place through the opencode connector, never copied into the notes folder:

     docs.list   the folders and their Markdown files (with busy and review)
     file.read   one file
     file.write  one file, with the text it was read at; refused while Tandem works on that folder

   A Tandem page's path is "tandem:<folder>/<file>". Nothing else in Notebook writes there: no history, rename,
   trash or offers for these (they belong to Tandem's run). Only inside Workshop on this computer.

   The pure parts (paths, names, grouping) are exported for tests; createTandem talks to the connector. */

export const TANDEM = 'tandem:';
const FOLDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.md$/;

export const isTandem = (p) => typeof p === 'string' && p.startsWith(TANDEM);
export function tandemPath(folder, file) { return `${TANDEM}${folder}/${file}`; }
/** {folder, file} for a Tandem path or route ("tandem:41207-x/plan.md", "41207-x/plan.md"), or null. */
export function parseTandem(p) {
  const m = /^(?:tandem:)?([^/]+)\/([^/]+)$/.exec(String(p || ''));
  return m && FOLDER.test(m[1]) && FILE.test(m[2]) ? { folder: m[1], file: m[2] } : null;
}

const NAMES = { 'brief.md': 'Brief', 'spec.md': 'Spec', 'plan.md': 'Plan', 'bug.md': 'Bug analysis', 'tasks.md': 'Tasks', 'review.md': 'Review', 'pr.md': 'PR text', 'findings.md': 'Findings', 'answer.md': 'Answer', 'tsd.md': 'Design doc', 'triage.md': 'Triage', 'workitem.md': 'Work item', 'progress.md': 'Progress', 'repos.md': 'Repos', 'questions.md': 'Questions', 'answers.md': 'Answers', 'understanding.md': 'Understanding', 'stories.md': 'Stories', 'milestones.md': 'Milestones', 'refine.md': 'Refined story' };
/** "plan.md" -> "Plan"; others by file name. */
export function docName(file) {
  if (NAMES[file]) return NAMES[file];
  const s = String(file).replace(/\.md$/, '').replace(/[-_]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : file;
}
const KIND = { item: '', spike: 'Spike', tsd: 'Design', pr: 'PR review', docs: 'Docs', triage: 'Triage', shape: 'Shape', scope: 'Scope', refine: 'Refine', handoff: 'Handoff' };
/** A folder's label: "#41207 Fix login timeout", "Spike: Cache options". */
export function itemLabel(it) {
  const k = KIND[it.kind] || '';
  if (it.id && it.kind === 'item') return `#${it.id} ${it.title}`;
  return k ? `${k}: ${it.title}` : it.title;
}
/** Items split into the ones waiting on you (a gate file to read) and the rest, each list in the order given. */
export function groupItems(items) {
  const review = [], rest = [];
  for (const it of items || []) (it.review ? review : rest).push(it);
  return { review, rest };
}
/** The item and file entry for a Tandem path, from the last list. */
export function findDoc(items, path) {
  const d = parseTandem(path);
  if (!d) return null;
  const it = (items || []).find(x => x.folder === d.folder);
  return it ? { item: it, file: it.files.find(f => f.file === d.file) || null } : null;
}

const OC = 'opencode';
/**
 * The connector side. onChange() after the list changes; onModel() when .work changed (re-read the open page).
 * state: {available, loaded, items, error}. available is false outside Workshop on this computer or with the
 * connector off; the section is hidden then.
 */
export function createTandem(ws, { onChange = () => {}, onModel = () => {} } = {}) {
  const st = { available: false, loaded: false, items: [], error: null };
  // Connectors run only where Workshop's agent is: inside Workshop on this computer, or paired.
  const can = !!(ws && ws.connectors && ws.backend === 'agent');
  let timer = null;
  async function refresh() {
    if (!can) { st.loaded = true; onChange(st); return st; }
    try {
      const r = await ws.connectors.call(OC, 'docs.list');
      st.items = (r && r.items) || []; st.available = true; st.loaded = true; st.error = null;
    } catch (e) {
      // Not here (browser mode, hosted, connector off or older than docs.list): no section, no noise.
      st.available = false; st.loaded = true; st.items = []; st.error = e && e.message;
    }
    onChange(st);
    return st;
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 250); };
  if (can) {
    try {
      ws.connectors.on(OC, 'model', () => { soon(); onModel(); });
      ws.connectors.on(OC, 'live', soon);
      ws.connectors.on(OC, 'autopilot', soon);
      ws.connectors.onStatus(OC, soon);
    } catch { /* no events here */ }
  }
  return {
    state: st,
    refresh,
    async read(path) {
      const d = parseTandem(path);
      if (!d) throw new Error('Not a Tandem page.');
      const r = await ws.connectors.call(OC, 'file.read', { folder: d.folder, file: d.file });
      return r.text;
    },
    async save(path, text, expected) {
      const d = parseTandem(path);
      if (!d) throw new Error('Not a Tandem page.');
      const r = await ws.connectors.call(OC, 'file.write', { folder: d.folder, file: d.file, text, expected }, { confirm: true });
      soon();
      return r;
    },
    /** Why this page can't be edited now, or null. */
    busy(path) {
      const f = findDoc(st.items, path);
      return f && f.item.busy ? f.item.busy : null;
    }
  };
}
