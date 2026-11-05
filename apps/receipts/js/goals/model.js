/* Rapport's Goals: OKRs for the team and each report, one plain Markdown file per owner per quarter. Pure: no
   DOM, no SDK, so Node tests run it. page.js reads and writes the files; view.js draws them.

   The format (README, "Goals"): the first `# ` heading is the doc title; each `## ` heading is an objective;
   top-level bullets in an objective are its key results ("Cut deploy time from 22 to 15 min: 18 min [on track]");
   indented bullets under a KR are its notes; `Supports: <team objective>` in a report objective places it under
   that team objective in the tree. Everything else is ordinary Markdown.

   Files: goals/team/<yyyy-qN>.md and goals/<person folder>/<yyyy-qN>.md, under Rapport (app id `receipts`). */

export const STATUSES = ['on track', 'at risk', 'off track', 'done'];
export const GOALS = 'goals';
export const TEAM = 'team';

const ALIASES = {
  'on track': 'on track', ontrack: 'on track', 'on-track': 'on track',
  'at risk': 'at risk', risk: 'at risk', 'at-risk': 'at risk', behind: 'at risk',
  'off track': 'off track', 'off-track': 'off track', offtrack: 'off track', blocked: 'off track',
  done: 'done', complete: 'done', completed: 'done'
};
// Worst first, for an objective's rollup status.
const WORST = ['off track', 'at risk', 'on track', 'done'];

/** Matching key for titles: lowercase, trimmed, one space, no trailing . : or ! */
export const norm = s => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.:!]+$/, '').trim();

/* ---------- quarters and paths ---------- */

const QKEY = /^(\d{4})-q([1-4])$/;

/** '2026-q4' for a date. */
export function quarterKey(date = new Date()) {
  return `${date.getFullYear()}-q${Math.floor(date.getMonth() / 3) + 1}`;
}
/** 'Q4 2026' for '2026-q4'. */
export function quarterLabel(key) {
  const m = QKEY.exec(String(key || ''));
  return m ? `Q${m[2]} ${m[1]}` : String(key || '');
}
/** shiftQuarter('2026-q4', 1) is '2027-q1'. */
export function shiftQuarter(key, n) {
  const m = QKEY.exec(String(key || ''));
  if (!m) return key;
  const i = Number(m[1]) * 4 + (Number(m[2]) - 1) + n;
  return `${Math.floor(i / 4)}-q${(i % 4) + 1}`;
}
export const isQuarter = key => QKEY.test(String(key || ''));

/** A person id as a folder segment: the same rule as 1:1 notes (p_mh3k9x2a is p-mh3k9x2a). */
export function ownerFolder(personId) {
  return String(personId == null ? '' : personId).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '').slice(0, 40) || 'person';
}
/** owner: 'team' or a folder segment. */
export const goalsPath = (owner, quarter) => `${GOALS}/${owner}/${quarter}.md`;

const FILE = /^goals\/([a-z0-9][a-z0-9-]{0,39})\/(\d{4}-q[1-4])\.md$/;
/** [{path}] to [{owner, quarter, path}], ignoring anything else in the folder. */
export function parseFiles(files) {
  const out = [];
  for (const f of files || []) {
    const m = FILE.exec(f && f.path);
    if (m) out.push({ owner: m[1], quarter: m[2], path: f.path, mtime: f.mtime });
  }
  return out;
}
/** Quarters to offer: every quarter with a file, plus this one and the next. Newest first. */
export function quartersFrom(files, now = new Date()) {
  const cur = quarterKey(now);
  const set = new Set([cur, shiftQuarter(cur, 1), ...parseFiles(files).map(f => f.quarter)]);
  return [...set].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/* ---------- progress ---------- */

const NUM = '(-?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)';
const toNum = s => Number(String(s).replace(/,/g, ''));

/**
 * A key result's bullet text to {text, value, unit, kind, label, status, pct}.
 * kind: 'done', 'percent', 'number' or 'none'. pct: 0 to 1, or null when there is no bar to draw.
 */
export function parseProgress(raw) {
  let text = String(raw == null ? '' : raw).trim();
  let status = '';
  const sm = /\s*\[\s*([a-z][a-z -]*?)\s*\]\s*$/i.exec(text);
  if (sm && ALIASES[sm[1].toLowerCase().replace(/\s+/g, ' ')]) {
    status = ALIASES[sm[1].toLowerCase().replace(/\s+/g, ' ')];
    text = text.slice(0, sm.index).trim();
  }
  const out = { text, value: null, unit: '', kind: 'none', label: '', status, pct: null };
  const at = text.lastIndexOf(': ');
  if (at >= 0) {
    const part = text.slice(at + 2).trim();
    const head = text.slice(0, at).trim();
    let m;
    if (/^done$/i.test(part)) Object.assign(out, { text: head, kind: 'done', label: 'done', pct: 1 });
    else if ((m = /^(\d+(?:\.\d+)?)\s*%$/.exec(part)) && Number(m[1]) <= 1000) {
      Object.assign(out, { text: head, kind: 'percent', value: Number(m[1]), label: `${m[1]}%`, pct: Math.min(Number(m[1]), 100) / 100 });
    } else if ((m = new RegExp(`^${NUM}(?:\\s+([A-Za-z]{1,12}))?$`).exec(part))) {
      Object.assign(out, { text: head, kind: 'number', value: toNum(m[1]), unit: m[2] || '', label: part });
      out.pct = numberPct(head, out.value);
    }
  }
  if (out.kind === 'none' && status === 'done') { out.pct = 1; out.label = 'done'; }
  return out;
}

// For a number: find where it started and where it is going in the KR text.
function numberPct(text, n) {
  const unit = '(?:\\s*[A-Za-z%]{0,12})';
  let start = null, target = null;
  let m = new RegExp(`\\bfrom\\s+${NUM}${unit}\\s+to\\s+${NUM}`, 'i').exec(text);
  if (m) { start = toNum(m[1]); target = toNum(m[2]); }
  else if ((m = new RegExp(`\\b(to|above|over|at least)\\s+${NUM}`, 'i').exec(text))) { start = 0; target = toNum(m[2]); }
  else return null; // "under", "below", "at most" with no start: direction unknown, show the value only
  if (target === start || !Number.isFinite(target) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.min(1, (n - start) / (target - start)));
}

/* ---------- parsing a doc ---------- */

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const H1 = /^#\s+(.*?)\s*#*\s*$/;
const H2 = /^##\s+(.*?)\s*#*\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const BULLET = /^ ?[-*+]\s+(.*)$/;
const SUPPORTS = /^\s*supports\s*:\s*(.*)$/i;
const TASK = /^\[( |x|X)\]\s+(.*)$/;
const INDENTED = /^(?: {2,}|\t)\S/;

/** A KR's bullet text (after the marker) to {text, progress}, reading task boxes. */
function readKr(raw) {
  const t = TASK.exec(raw);
  const body = t ? t[2] : raw;
  const progress = parseProgress(body);
  if (t && t[1] !== ' ' && progress.kind === 'none' && progress.pct == null) Object.assign(progress, { kind: 'done', label: 'done', pct: 1 });
  return { text: progress.text, progress, task: t ? (t[1] === ' ' ? 'open' : 'done') : '' };
}

const dedent = lines => {
  const pad = Math.min(...lines.filter(l => l.trim()).map(l => /^\s*/.exec(l)[0].length));
  return lines.map(l => l.slice(Number.isFinite(pad) ? pad : 0)).join('\n').trim();
};

/**
 * Markdown to {title, titleLine, preamble, objectives, eol}. Never throws.
 * objectives: [{title, line, end, supports, supportsLine, krs: [{line, raw, text, progress, notes}], body}]
 */
export function parseDoc(text) {
  const src = String(text == null ? '' : text).replace(/\u0000/g, '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  // Which lines are inside fenced code.
  const fenced = [];
  let mark = null;
  lines.forEach((l, i) => {
    const m = FENCE.exec(l);
    if (mark) { fenced[i] = true; if (m && l.trim().startsWith(mark)) mark = null; }
    else if (m) { fenced[i] = true; mark = m[1][0].repeat(3); }
    else fenced[i] = false;
  });
  const doc = { title: '', titleLine: -1, preamble: '', objectives: [], eol };
  const starts = [];
  lines.forEach((l, i) => { if (!fenced[i] && H2.test(l)) starts.push(i); });
  const first = starts.length ? starts[0] : lines.length;
  for (let i = 0; i < first; i++) {
    if (fenced[i]) continue;
    const m = H1.exec(lines[i]);
    if (m) { doc.title = m[1]; doc.titleLine = i; break; }
  }
  doc.preamble = lines.slice(0, first).filter((l, i) => i !== doc.titleLine).join('\n').trim();
  starts.forEach((line, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const o = { title: H2.exec(lines[line])[1], line, end, supports: '', supportsLine: -1, krs: [], body: '' };
    const used = new Set([line]);
    for (let i = line + 1; i < end; i++) {
      if (fenced[i]) continue;
      const sm = SUPPORTS.exec(lines[i]);
      if (sm && !BULLET.test(lines[i])) { o.supports = sm[1].trim(); o.supportsLine = i; used.add(i); break; }
    }
    for (let i = line + 1; i < end; i++) {
      if (fenced[i] || used.has(i)) continue;
      const bm = BULLET.exec(lines[i]);
      if (!bm) continue;
      const kr = readKr(bm[1]);
      used.add(i);
      const notes = [];
      let j = i + 1;
      while (j < end && !fenced[j]) {
        const l = lines[j];
        if (INDENTED.test(l)) { notes.push(l); used.add(j); j++; continue; }
        if (!l.trim()) {
          let n = j + 1;
          while (n < end && !lines[n].trim()) n++;
          if (n < end && !fenced[n] && INDENTED.test(lines[n]) && !HEADING.test(lines[n].trim())) { for (let b = j; b < n; b++) used.add(b); notes.push(''); j = n; continue; }
        }
        break;
      }
      o.krs.push({ line: i, raw: bm[1], text: kr.text, progress: kr.progress, task: kr.task, notes: notes.length ? dedent(notes) : '' });
      i = j - 1;
    }
    o.body = lines.slice(line + 1, end).filter((l, n) => !used.has(line + 1 + n)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    doc.objectives.push(o);
  });
  return doc;
}

/* ---------- edits (each changes only the lines it names) ---------- */

// Lines and the separator after each, so a write keeps every other byte, mixed line endings included.
function parts(text) {
  const bits = String(text == null ? '' : text).split(/(\r?\n)/);
  const lines = [], seps = [];
  for (let i = 0; i < bits.length; i += 2) { lines.push(bits[i]); seps.push(bits[i + 1] || ''); }
  return { lines, seps, join: () => lines.map((l, i) => l + seps[i]).join('') };
}
const KR_LINE = /^(\s*[-*+]\s+(?:\[[ xX]\]\s+)?)(.*)$/;
const bad = msg => Object.assign(new Error(msg), { code: 'bad_request' });

/** true when `progress` is something parseProgress reads ('40%', '18 min', '3', 'done'), or ''. */
export function validProgress(progress) {
  const p = String(progress == null ? '' : progress).trim();
  return !p || parseProgress(`x: ${p}`).kind !== 'none';
}

/**
 * The KR on line `line` with new progress and status. Keeps the marker, indentation and KR text. Returns
 * the new text, or null when that line is not a KR or its text is not `expectText` (it changed in the file).
 */
export function setKr(text, line, { progress = '', status = '', expectText } = {}) {
  const p = String(progress == null ? '' : progress).trim();
  if (!validProgress(p)) throw bad(`"${p}" is not a progress. Use 40%, a number like 18 min, or done.`);
  if (status && !STATUSES.includes(status)) throw bad(`"${status}" is not a status.`);
  const doc = parts(text);
  const m = KR_LINE.exec(doc.lines[line] ?? '');
  if (!m || /^\s{2,}/.test(m[1])) return null;
  let prefix = m[1];
  const cur = parseProgress(m[2]);
  if (expectText !== undefined && cur.text !== expectText) return null;
  // A task box follows the KR: done ticks it, anything else clears it.
  if (/\[[ xX]\]/.test(prefix)) prefix = prefix.replace(/\[[ xX]\]/, p === 'done' || status === 'done' ? '[x]' : '[ ]');
  doc.lines[line] = `${prefix}${cur.text}${p ? `: ${p}` : ''}${status ? ` [${status}]` : ''}`;
  return doc.join();
}

/** Sets (title), replaces, or removes (null) the Supports line of the objective whose heading is on `objectiveLine`. */
export function setSupports(text, objectiveLine, title) {
  const d = parseDoc(text);
  const o = d.objectives.find(x => x.line === objectiveLine);
  if (!o) return null;
  const doc = parts(text);
  const val = title == null ? null : String(title).replace(/[\r\n]+/g, ' ').trim();
  if (o.supportsLine >= 0) {
    if (val) { doc.lines[o.supportsLine] = doc.lines[o.supportsLine].replace(/^(\s*supports\s*:\s*).*$/i, `$1${val}`); return doc.join(); }
    const s = o.supportsLine;
    doc.lines.splice(s, 1); doc.seps.splice(s, 1);
    if (s > 0 && s < doc.lines.length && !doc.lines[s - 1].trim() && !doc.lines[s].trim()) { doc.lines.splice(s, 1); doc.seps.splice(s, 1); }
    if (s >= doc.lines.length && doc.seps.length) doc.seps[doc.seps.length - 1] = '';
    return doc.join();
  }
  if (!val) return String(text);
  const h = o.line;
  const insert = (after, add) => {
    if (!doc.seps[after]) { doc.seps[after] = d.eol; add = add.map((l, i) => [l, i === add.length - 1 ? '' : d.eol]); }
    else add = add.map(l => [l, d.eol]);
    doc.lines.splice(after + 1, 0, ...add.map(a => a[0]));
    doc.seps.splice(after + 1, 0, ...add.map(a => a[1]));
  };
  if (h + 1 >= doc.lines.length) insert(h, ['', `Supports: ${val}`]);
  else if (!doc.lines[h + 1].trim()) insert(h + 1, [`Supports: ${val}`, '']);
  else insert(h, ['', `Supports: ${val}`, '']);
  return doc.join();
}

/** Objectives renamed between two parsed docs: paired by position when the count is the same. */
export function renamedObjectives(before, after) {
  const a = (before && before.objectives) || [], b = (after && after.objectives) || [];
  if (a.length !== b.length) return [];
  return a.map((o, i) => ({ from: o.title, to: b[i].title })).filter(r => norm(r.from) && norm(r.from) !== norm(r.to));
}

/** Rewrites every Supports line that names `from` to name `to`. Returns {text, count}. */
export function renameSupports(text, from, to) {
  const d = parseDoc(text);
  const doc = parts(text);
  let count = 0;
  for (const o of d.objectives) {
    if (o.supportsLine >= 0 && norm(o.supports) && norm(o.supports) === norm(from)) {
      doc.lines[o.supportsLine] = doc.lines[o.supportsLine].replace(/^(\s*supports\s*:\s*).*$/i, `$1${String(to).trim()}`);
      count++;
    }
  }
  return { text: count ? doc.join() : String(text), count };
}

/* ---------- the tree ---------- */

/** An objective's rollup: the mean of its measured KRs, and the worst status among them. */
export function rollup(objective) {
  const krs = (objective && objective.krs) || [];
  const measured = krs.filter(k => k.progress.pct != null);
  const statuses = krs.map(k => k.progress.status).filter(Boolean);
  return {
    pct: measured.length ? measured.reduce((s, k) => s + k.progress.pct, 0) / measured.length : null,
    measured: measured.length,
    total: krs.length,
    status: WORST.find(s => statuses.includes(s)) || ''
  };
}

/**
 * team: {path, doc} or null. reports: [{person: {id, name, archived}, path, doc}] (doc null when there is no
 * file). unknown: [{folder, path, doc}] files whose folder matches no report.
 * A report objective sits under the first team objective whose title matches its Supports line; otherwise it
 * is Not aligned. A team objective's number is its own KRs only.
 */
export function buildTree({ team = null, reports = [], unknown = [] } = {}) {
  const tree = {
    team: ((team && team.doc && team.doc.objectives) || []).map(objective => ({ objective, progress: rollup(objective), supporters: [] })),
    unaligned: [], missing: [], unknown: []
  };
  const place = (person, objective, path) => {
    const row = { person, objective, progress: rollup(objective), path };
    const key = norm(objective.supports);
    const t = key ? tree.team.find(x => norm(x.objective.title) === key) : null;
    (t ? t.supporters : tree.unaligned).push(row);
  };
  for (const r of reports) {
    if (!r.doc) { if (!r.person.archived) tree.missing.push(r.person); continue; }
    for (const o of r.doc.objectives) place(r.person, o, r.path);
  }
  for (const u of unknown) {
    tree.unknown.push({ folder: u.folder, path: u.path });
    const person = { id: '', name: `Unknown person (${u.folder})`, archived: false, unknown: true };
    for (const o of (u.doc && u.doc.objectives) || []) tree.unaligned.push({ person, objective: o, progress: rollup(o), path: u.path });
  }
  return tree;
}

/* ---------- templates ---------- */

const KRS = ['- First key result, with how you\'ll measure it: 0%', '- Second key result: 0%', '- Third key result: 0%'];
const KRS_SHORT = ['- First key result: 0%', '- Second key result: 0%', '- Third key result: 0%'];

export function teamTemplate(quarter) {
  return [`# Team goals, ${quarterLabel(quarter)}`, '', '## First objective', '', 'Why it matters, in a sentence or two.', '', ...KRS, '',
    '## Second objective', '', ...KRS_SHORT, ''].join('\n');
}

/** A report's first doc. Each objective supports the team objective in the same place, when there is one. */
export function reportTemplate(quarter, teamTitles = []) {
  const sup = i => (teamTitles[i] ? [`Supports: ${teamTitles[i]}`, ''] : []);
  return [`# ${quarterLabel(quarter)}`, '', '## First objective', '', ...sup(0), ...KRS, '', '## Second objective', '', ...sup(1), ...KRS_SHORT, ''].join('\n');
}

/** Copy from last quarter: the same objectives and KRs, progress back to 0%, no statuses, title moved to `to`. */
export function carryOver(text, from = '', to = '') {
  let out = String(text == null ? '' : text);
  const d = parseDoc(out);
  for (const o of d.objectives) {
    for (const k of o.krs) {
      const next = setKr(out, k.line, { progress: k.task || k.progress.kind === 'none' ? '' : '0%', status: '' });
      if (next != null) out = next;
    }
  }
  if (from && to && d.titleLine >= 0) {
    const p = parts(out);
    p.lines[d.titleLine] = p.lines[d.titleLine].split(quarterLabel(from)).join(quarterLabel(to));
    out = p.join();
  }
  return out;
}
