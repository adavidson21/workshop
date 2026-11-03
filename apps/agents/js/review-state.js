/* Code review screen: the logic with no DOM and no Monaco, so it is tested in Node
   (test/review.test.mjs). review.js uses it; review-view.js draws from it.

   Types are the opencode connector's (connectors/opencode/README.md, Code review). A draft is what the
   reviewer has written but not sent: { comments: ReviewComment-like[], summary }. Drafts are kept in
   localStorage per work item, repo and revision, so a refresh loses nothing. */

export const TYPES = [
  { id: 'must_fix', label: 'Must fix' },
  { id: 'suggestion', label: 'Suggestion' },
  { id: 'question', label: 'Question' },
];
export const typeLabel = id => (TYPES.find(t => t.id === id) || TYPES[0]).label;
const TYPE_IDS = new Set(TYPES.map(t => t.id));

export const STATUS_LETTER = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' };

/* ---------- the URL hash: #file=src/x.ts&L=12-18 (and &side=old for the old side) ---------- */

export function parseHash(hash) {
  const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const file = q.get('file');
  if (!file) return null;
  const out = { file, side: q.get('side') === 'old' ? 'old' : 'new', start: null, end: null };
  const m = /^(\d+)(?:-(\d+))?$/.exec(q.get('L') || '');
  if (m) {
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a >= 1 && b >= 1) { out.start = Math.min(a, b); out.end = Math.max(a, b); }
  }
  return out;
}

export function formatHash(sel) {
  if (!sel || !sel.file) return '';
  const q = new URLSearchParams();
  q.set('file', sel.file);
  if (sel.start) q.set('L', sel.end && sel.end !== sel.start ? `${sel.start}-${sel.end}` : String(sel.start));
  if (sel.side === 'old') q.set('side', 'old');
  // Keep slashes readable: src/x.ts, not src%2Fx.ts.
  return '#' + q.toString().replace(/%2F/gi, '/');
}

/* ---------- selection ---------- */

// A click, shift-click or drag on a line number. Selection stays on one side of one file; anything
// else starts a new selection.
export function select(prev, { file, side, line, extend }) {
  if (extend && prev && prev.file === file && prev.side === side && prev.anchor) {
    return { file, side, anchor: prev.anchor, start: Math.min(prev.anchor, line), end: Math.max(prev.anchor, line) };
  }
  return { file, side, anchor: line, start: line, end: line };
}

export const rangeText = (start, end) => (start === end ? `L${start}` : `L${start}-${end}`);
export const rangeLabel = c => rangeText(c.startLine, c.endLine) + (c.side === 'old' ? ' (old)' : '');

/* ---------- drafts ---------- */

export const draftKey = (id, repo, revision) => `dispatch.review.${id}.${repo}.r${revision}`;
export const emptyDraft = () => ({ comments: [], summary: '' });

function cleanComment(c) {
  if (!c || typeof c !== 'object') return null;
  if (typeof c.id !== 'string' || typeof c.path !== 'string' || (c.side !== 'old' && c.side !== 'new')) return null;
  if (!Number.isInteger(c.startLine) || !Number.isInteger(c.endLine) || c.startLine < 1 || c.endLine < c.startLine) return null;
  return {
    id: c.id,
    path: c.path,
    side: c.side,
    startLine: c.startLine,
    endLine: c.endLine,
    type: TYPE_IDS.has(c.type) ? c.type : 'must_fix',
    body: typeof c.body === 'string' ? c.body : '',
    ...(typeof c.suggestedCode === 'string' ? { suggestedCode: c.suggestedCode } : {}),
  };
}

export function loadDraft(store, key) {
  let raw = null;
  try { raw = JSON.parse(store.getItem(key) || 'null'); } catch (e) { raw = null; }
  if (!raw || typeof raw !== 'object') return emptyDraft();
  return {
    comments: Array.isArray(raw.comments) ? raw.comments.map(cleanComment).filter(Boolean) : [],
    summary: typeof raw.summary === 'string' ? raw.summary : '',
  };
}

// Returns false when the browser would not save it (private mode, blocked site data, full storage).
export function saveDraft(store, key, draft) {
  try {
    if (!draft.comments.length && !draft.summary.trim()) store.removeItem(key);
    else store.setItem(key, JSON.stringify({ comments: draft.comments, summary: draft.summary, saved: new Date().toISOString() }));
    return true;
  } catch (e) {
    return false;
  }
}

// c1, c2, ...: short ids the agent quotes back in its response file. Never reused within a draft.
export function nextCommentId(comments) {
  let n = 0;
  for (const c of comments) {
    const m = /^c(\d+)$/.exec(c.id);
    if (m) n = Math.max(n, +m[1]);
  }
  return `c${n + 1}`;
}

export function upsertComment(draft, comment) {
  const i = draft.comments.findIndex(c => c.id === comment.id);
  const comments = draft.comments.slice();
  if (i >= 0) comments[i] = comment;
  else comments.push(comment);
  comments.sort((a, b) => a.path.localeCompare(b.path) || (a.side === b.side ? 0 : a.side === 'old' ? -1 : 1) || a.startLine - b.startLine || a.id.localeCompare(b.id));
  return { ...draft, comments };
}

export const removeComment = (draft, id) => ({ ...draft, comments: draft.comments.filter(c => c.id !== id) });

export const canRequestChanges = draft => draft.comments.length > 0 || draft.summary.trim().length > 0;

/* ---------- quoting and the payload ---------- */

const splitLines = text => String(text).replace(/\r\n?/g, '\n').split('\n');

// The exact lines start..end (1-based) of a file's text, or null when the range is outside the file.
export function quoteLines(text, start, end) {
  if (typeof text !== 'string') return null;
  const lines = splitLines(text);
  if (text.endsWith('\n')) lines.pop();
  if (start < 1 || end > lines.length || end < start) return null;
  return lines.slice(start - 1, end).join('\n');
}

export const firstLine = s => (String(s || '').trim().split('\n')[0] || '').slice(0, 140);

/* The ReviewFeedback to submit. textFor(path, side) returns that file's text at baseSha (old) or
   headSha (new), so quotedCode is always the lines at the commit being reviewed, even if the draft was
   written against an earlier load. Returns { feedback } or { problem, commentId? }.
   Approve sends no line comments: the agent only acts on request changes. */
export function buildFeedback(session, draft, verdict, textFor) {
  const summary = draft.summary.trim();
  const base = { workItemId: session.workItemId, repo: session.repo, revision: session.revision, headSha: session.headSha, verdict };
  if (verdict === 'approve') return { feedback: { ...base, ...(summary ? { summary } : {}), comments: [] } };
  if (!canRequestChanges(draft)) return { problem: 'Add a comment or a summary first.' };
  const comments = [];
  for (const c of draft.comments) {
    if (!c.body.trim()) return { problem: `The comment on ${c.path} ${rangeLabel(c)} is empty. Write it or delete it.`, commentId: c.id };
    const quotedCode = quoteLines(textFor(c.path, c.side), c.startLine, c.endLine);
    if (quotedCode == null) return { problem: `${c.path} ${rangeLabel(c)} is no longer in the file. Move or delete that comment.`, commentId: c.id };
    comments.push({
      id: c.id, path: c.path, side: c.side, startLine: c.startLine, endLine: c.endLine,
      quotedCode, type: c.type, body: c.body.trim(),
      ...(c.suggestedCode !== undefined ? { suggestedCode: c.suggestedCode } : {}),
    });
  }
  return { feedback: { ...base, ...(summary ? { summary } : {}), comments } };
}

/* ---------- the file tree ---------- */

// Rows for the Files pane: folders first at each level, then files, each with its depth.
// Single-child folder chains are joined ("src/server/lib").
export function fileTree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (const d of parts.slice(0, -1)) {
      if (!node.dirs.has(d)) node.dirs.set(d, { dirs: new Map(), files: [] });
      node = node.dirs.get(d);
    }
    node.files.push({ name: parts[parts.length - 1], file: f });
  }
  const rows = [];
  (function walk(node, depth, prefix) {
    for (const [name, child] of [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      let label = name, n = child, path = prefix + name;
      while (n.files.length === 0 && n.dirs.size === 1) {
        const [[k, v]] = n.dirs.entries();
        label += '/' + k; path += '/' + k; n = v;
      }
      rows.push({ type: 'dir', name: label, depth, path });
      walk(n, depth + 1, path + '/');
    }
    for (const { name, file } of node.files.sort((a, b) => a.name.localeCompare(b.name))) rows.push({ type: 'file', name, depth, path: file.path, file });
  })(root, 0, '');
  return rows;
}

export function commentCounts(comments) {
  const out = {};
  for (const c of comments) out[c.path] = (out[c.path] || 0) + 1;
  return out;
}

/* ---------- round 2 and later ---------- */

// The previous round's comments with the agent's answers, for the Review panel.
export function previousRows(session) {
  const fb = session && session.previousFeedback;
  if (!fb) return [];
  const answers = new Map((session.previousResponses || []).map(r => [r.commentId, r]));
  return fb.comments.map(c => ({ comment: c, response: answers.get(c.id) || null }));
}

export const RESPONSE_LABEL = { fixed: 'Fixed', declined: 'Declined', answered: 'Answered' };

// The files to list: the whole review, or only what changed since the last one.
export function visibleFiles(session, sinceLast) {
  if (sinceLast && session.sinceLastReview) return session.sinceLastReview;
  return session.files;
}

// What Monaco needs to show a file: the two sides to fetch. In "changes since last review" the left
// side is the last reviewed head, and comments go on the new side only.
export function sidesFor(file, sinceLast) {
  if (sinceLast) return { left: { side: 'prev', path: file.path }, right: { side: 'new', path: file.path }, commentSides: ['new'] };
  return {
    left: { side: 'old', path: file.oldPath || file.path },
    right: { side: 'new', path: file.path },
    commentSides: ['old', 'new'],
  };
}

/* ---------- language from the file name, for syntax colors ---------- */

const LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  json: 'json', md: 'markdown', css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  py: 'python', cs: 'csharp', java: 'java', kt: 'kotlin', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', sql: 'sql',
  sh: 'shell', bash: 'shell', ps1: 'powershell', psm1: 'powershell', yml: 'yaml', yaml: 'yaml', c: 'c', h: 'cpp', cpp: 'cpp',
  hpp: 'cpp', swift: 'swift', dart: 'dart', lua: 'lua', r: 'r', scala: 'scala', vb: 'vb', fs: 'fsharp', graphql: 'graphql',
  dockerfile: 'dockerfile', ini: 'ini', toml: 'ini', bat: 'bat', cmd: 'bat', razor: 'razor', cshtml: 'razor',
};
export function languageFor(path) {
  const name = path.split('/').pop().toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return LANG[ext] || 'plaintext';
}
