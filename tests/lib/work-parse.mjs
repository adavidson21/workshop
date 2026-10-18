// A JavaScript reading of the .work rules in docs/work-format.md, used by the contract test to prove the
// documented regexes and next-step rules give the documented results on docs/examples/work/.
// The regexes are passed in (read from the doc), so the doc stays the single source.
// This is a test reference, not the WS3 port: it covers what the doc states and nothing more.
import fs from 'node:fs';
import path from 'node:path';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Read the "```regex" block of work-format.md into {name: RegExp | (arg) => RegExp}. */
export function regexesFromDoc(markdown) {
  const block = markdown.match(/```regex\n([\s\S]*?)\n```/);
  if (!block) throw new Error('No ```regex block in work-format.md');
  const out = {};
  for (const line of block[1].split('\n')) {
    const m = line.match(/^(\w+)\s+\/(.*)\/([a-z]*)$/);
    if (!m) throw new Error(`Bad regex line: ${line}`);
    const [, name, src, flags] = m;
    out[name] = src.includes('{') && /\{(label|heading)\}/.test(src)
      ? arg => new RegExp(src.replace(/\{(label|heading)\}/, esc(arg)), flags)
      : new RegExp(src, flags);
  }
  return out;
}

const STEP_WORDS = { start: 'Set up the repos and branches', spec: 'Write the spec', plan: 'Write the plan', tasks: 'Split the plan into tasks',
  bug: 'Analyze the bug', review: 'Review the changes', pr: 'Write the PR text', resume: 'Resume this item', approve: 'Approve' };

export function parseWorkRoot(root, R) {
  const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
  const clean = v => {
    if (v == null) return null;
    let s = v.trim();
    const b = s.match(R.backticked); if (b) s = b[1].trim();
    if (!s || R.placeholder.test(s)) return null;
    return s;
  };
  const field = (text, label) => { if (!text) return null; const m = text.match(R.field(label)); return m ? clean(m[1]) : null; };
  const section = (text, heading) => {
    if (!text) return null;
    const m = text.match(R.section(heading)); if (!m) return null;
    const s = m[1].replace(new RegExp(R.comment.source, 'g'), '').trim();
    if (!s || /^<[^>]*>$/.test(s)) return null;
    return s;
  };
  const gate = p => { const t = read(p); if (t == null) return null; const m = t.match(R.gate); return m ? m[1].toUpperCase() : 'UNKNOWN'; };
  const lines = t => (t || '').split(/\r?\n/);

  const items = [];
  for (const name of fs.readdirSync(root).sort()) {
    const folder = path.join(root, name);
    if (!fs.statSync(folder).isDirectory() || R.ignoredFolder.test(name)) continue;
    const notes = name.match(R.notesFolder);
    if (notes) {
      const kind = notes[1];
      const base = { folder: name, kind, title: notes[2].replace(/-/g, ' ') };
      if (kind === 'spike') {
        const f = read(path.join(folder, 'findings.md'));
        const t = f && f.match(R.spikeTitle); if (t && clean(t[1])) base.title = t[1];
        Object.assign(base, { state: f ? 'Findings written' : 'In progress', summary: section(f, 'Short answer'), recommendation: section(f, 'Recommendation'), nextText: section(f, 'Next step') });
      } else if (kind === 'tsd') {
        const t = read(path.join(folder, 'tsd.md'));
        const m = t && t.match(R.tsdTitle); if (m && clean(m[1])) base.title = m[1];
        const check = read(path.join(folder, 'check.md'));
        Object.assign(base, { gate: gate(path.join(folder, 'tsd.md')), wrong: check ? (check.match(new RegExp(R.tsdCheckBad.source, 'gi')) || []).length : 0 });
      }
      base.bucket = 'notes';
      items.push(base);
      continue;
    }
    const im = name.match(R.itemFolder);
    if (!im) { items.push({ folder: name, kind: 'other', title: name, bucket: 'notes' }); continue; }
    const [, id, slug] = im;
    const wi = read(path.join(folder, 'workitem.md'));
    const reposText = read(path.join(folder, 'repos.md'));
    const progress = read(path.join(folder, 'progress.md'));
    const pausedText = read(path.join(folder, 'paused.md'));

    let title = null;
    const tm = wi && wi.match(R.title); if (tm) title = clean(tm[1]);
    if (!title) { const pm = progress && progress.match(R.progressTitle); if (pm) title = clean(pm[1]); }
    if (!title) title = slug.replace(/-/g, ' ');

    const type = field(wi, 'Type');
    let lane = field(reposText, 'Lane'), laneGuessed = false;
    if (lane) lane = lane.toLowerCase(); else { laneGuessed = true; lane = /bug/i.test(type || '') ? 'bug' : 'feature'; }

    const adoVal = field(wi, 'ADO');
    const am = adoVal && adoVal.match(R.adoLine);
    const ado = am ? { connection: am[1], collection: am[2], project: am[3] ?? null } : null;

    const repos = [];
    for (const line of lines(reposText)) {
      const m = line.match(R.repoRow); if (!m) continue;
      const cells = m[1].split('|').map(c => c.trim().replace(/^`+|`+$/g, '').trim());
      if (cells.length < 3) continue;
      if (/^order$/i.test(cells[0]) || /^:?-+:?$/.test(cells[0])) continue;
      if (!clean(cells[1])) continue;
      repos.push({ folder: cells[1], branch: clean(cells[2]), shared: cells.length > 3 && /^y/i.test(cells[3]), why: cells.length > 4 ? clean(cells[4]) : null });
    }

    const list = [];
    let cur = null;
    for (const line of lines(read(path.join(folder, 'tasks.md')))) {
      const m = line.match(R.task);
      if (m) {
        if (R.placeholder.test(m[3])) { cur = null; continue; }
        cur = { n: +m[2], title: m[3], done: m[1] !== ' ', repo: null };
        list.push(cur);
        continue;
      }
      const r = cur && !cur.repo && line.match(R.taskRepo);
      if (r) cur.repo = clean(r[1]);
    }
    const tasks = { total: list.length, done: list.filter(t => t.done).length, list };

    const reviewText = read(path.join(folder, 'review.md'));
    let review = null;
    if (reviewText != null) { review = 'UNKNOWN'; const v = reviewText.match(R.verdict); if (v && clean(v[1])) review = clean(v[1]).toUpperCase(); }

    const entries = [];
    let e = null;
    for (const line of lines(progress)) {
      const h = line.match(R.progressEntry);
      if (h) { e = { date: h[1].trim(), command: h[2].trim().replace(/^`+|`+$/g, ''), agent: clean(h[3] ?? ''), did: null, verify: null, notes: null, next: null, first: null }; entries.push(e); continue; }
      if (/^##\s/.test(line)) { e = null; continue; }
      if (!e) continue;
      const f = line.match(R.progressField);
      if (f) e[f[1].toLowerCase()] = clean(f[2]);
      else if (!e.first) { const b = line.match(R.progressBullet); if (b) e.first = clean(b[1]); }
    }
    for (const x of entries) { if (!x.did) x.did = x.first; delete x.first; if (x.notes && /^none\.?$/i.test(x.notes)) x.notes = null; }
    const last = entries.length ? entries[entries.length - 1] : null;

    let blocked = null;
    if (last && /do-task/.test(last.command)) {
      const txt = `${last.did ?? ''} ${last.notes ?? ''} ${last.verify ?? ''}`;
      if (R.blockedFail.test(last.verify ?? '') || R.blockedWord.test(txt)) blocked = last.notes || last.did || 'Verify failed.';
    }

    let paused = null;
    const ps = pausedText && pausedText.match(R.pausedStatus);
    if (ps && ps[1].toUpperCase() === 'PAUSED') {
      paused = { since: field(pausedText, 'Paused'), reason: field(pausedText, 'Reason'), inProgress: field(pausedText, 'In progress'), wip: section(pausedText, 'Work in progress'), waiting: section(pausedText, 'Waiting on') };
      if (/^not given$/i.test(paused.reason || '')) paused.reason = null;
      if (/^none\.?$/i.test(paused.wip || '')) paused.wip = null;
      if (/^-?\s*nothing\.?$/i.test(paused.waiting || '')) paused.waiting = null;
    }

    const gates = { spec: gate(path.join(folder, 'spec.md')), plan: gate(path.join(folder, 'plan.md')), bug: gate(path.join(folder, 'bug.md')), review };
    const hasPr = fs.existsSync(path.join(folder, 'pr.md'));
    const item = { folder: name, kind: 'item', id, title, type, adoState: field(wi, 'State'), ado, lane, laneGuessed, repos, gates, tasks, blocked, paused, last };
    item.next = nextStep(item, folder, { hasRepos: reposText != null, hasPr });
    item.bucket = paused ? 'paused' : item.next.needsYou ? 'needs' : item.next.stage === 'ship' ? 'ship' : 'active';
    item.pr = hasPr ? prSections(read(path.join(folder, 'pr.md')), R, clean) : [];
    items.push(item);
  }
  return items;
}

function commandText(item, command) {
  const p = command.split(/\s+/);
  const name = p[0].replace(/^\//, '');
  if (name === 'do-task' && p.length >= 3) {
    const t = item.tasks.list.find(x => x.n === +p[2]);
    return `Task ${p[2]}${t ? `: ${t.title}` : ''}`;
  }
  return STEP_WORDS[name] ?? command;
}

function nextStep(item, folder, { hasRepos, hasPr }) {
  const { id, lane, gates: g } = item;
  const step = (stage, command, action, needsYou) => ({ stage, command, action, text: action ?? commandText(item, command), needsYou });
  if (!hasRepos) return step('start', `/start ${id} ${lane}`, null, false);
  if (lane === 'feature' && g.spec == null) return step('spec', `/spec ${id}`, null, false);
  if (g.spec === 'DRAFT') return step('spec', `/approve ${id}`, 'Review spec.md', true);
  if (lane === 'feature' && g.plan == null) return step('plan', `/plan ${id}`, null, false);
  if (g.plan === 'DRAFT') return step('plan', `/approve ${id}`, 'Review plan.md', true);
  if (lane === 'bug' && g.bug == null) return step('bug', `/bug ${id}`, null, false);
  if (g.bug === 'DRAFT') return step('bug', `/approve ${id}`, 'Review bug.md and tasks.md', true);
  const tasksPath = path.join(folder, 'tasks.md'), reviewPath = path.join(folder, 'review.md');
  if (item.tasks.total === 0 && !fs.existsSync(tasksPath)) return step(lane === 'bug' ? 'bug' : 'tasks', `/tasks ${id}`, null, false);
  const open = item.tasks.list.filter(t => !t.done).sort((a, b) => a.n - b.n);
  if (open.length) {
    const n = open[0].n;
    if (item.blocked) return step('build', `/do-task ${id} ${n}`, `Task ${n} is blocked. Read the last progress.md entry, then split the task or fix the plan`, true);
    return step('build', `/do-task ${id} ${n}`, null, false);
  }
  let stale = false;
  if (fs.existsSync(reviewPath) && fs.existsSync(tasksPath)) stale = fs.statSync(tasksPath).mtimeMs > fs.statSync(reviewPath).mtimeMs;
  if (g.review == null || stale) return step('review', `/review ${id}`, null, false);
  if (/CHANGES/.test(g.review)) return step('review', null, 'Pick which review.md findings become fix tasks, then /do-task them', true);
  if (!hasPr) return step('pr', `/pr ${id}`, null, false);
  return step('ship', null, 'Push the branches and open the PRs (text is in pr.md)', false);
}

function prSections(text, R, clean) {
  const body = text.replace(/\r\n/g, '\n').replace(new RegExp(R.comment.source, 'g'), '');
  const out = [];
  for (const part of body.split(R.prSplit).slice(1)) {
    const nl = part.indexOf('\n');
    const head = nl >= 0 ? part.slice(0, nl) : part;
    const rest = nl >= 0 ? part.slice(nl + 1) : '';
    const repo = clean(head);
    if (!repo) continue;
    const b = rest.match(R.prBranch);
    const t = rest.match(R.prTitle);
    const d = rest.match(R.prDescription);
    let description = null;
    if (d) { const s = d[1].replace(/^\s*-{3,}\s*$/gm, '').trim(); if (s && !/^<[^>]*>$/.test(s)) description = s; }
    out.push({ repo, branch: b ? clean(b[1]) : null, target: b ? clean(b[2]) : null, title: t ? clean(t[1].replace(/^\*+|\*+$/g, '').trim()) : null, description });
  }
  return out;
}
