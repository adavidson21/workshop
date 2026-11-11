/* Dispatch flows (plan: claude/dispatch-flows-v1-plan.md in the Workshop project). A flow is a named recipe that
   follows eng-agents' suggested flows (README, Daily use; docs/pipeline.md, Lanes): its steps, which steps stop for
   you, the file each step writes, and whether Tandem can run the middle hands-off. This file is the one place that
   defines them: the Start work picker, the run page's step track, the Inbox and the Work tab all read it.
   A run's flow is not stored: it follows from the .work folder (a work item's lane, or the folder's kind).
   No DOM: tested in Node. */
import { S } from './state.js';
import { h, md, plural, asking, isBusy, itemSession, autoIs, bucketOf, noteCommand, liveNote } from './view.js';

/** The presets, in the order Start work shows them. `you`: the step stops for you. `file`: what the step writes
 *  (read inline on the run page). `start`: the form Start work shows. */
export const FLOWS = [
  {
    id: 'feature', name: 'Build a feature', tag: 'Feature', when: 'New behavior, or more than 3 files of change.', handsOff: true, start: 'item', lane: 'feature',
    steps: [
      { key: 'start', name: 'Set up', file: 'brief.md', what: 'Fetches the work item, picks the repos, makes branches and writes a short brief.' },
      { key: 'spec', name: 'Spec', you: true, file: 'spec.md', what: 'Asks you questions one at a time, then writes the spec. You approve it.' },
      { key: 'plan', name: 'Plan', you: true, file: 'plan.md', what: 'Files per repo, the pattern to follow and the test plan. You approve it.' },
      { key: 'tasks', name: 'Tasks', file: 'tasks.md', what: 'Small tasks, each with a command that proves it works.' },
      { key: 'build', name: 'Build', file: 'progress.md', what: 'One task per fresh session, test first, a commit each.' },
      { key: 'review', name: 'Review', file: 'review.md', what: 'Checks the work against the spec, then the code quality. Blockers become fix tasks.' },
      { key: 'pr', name: 'PR text', file: 'pr.md', what: 'A short title and description for each repo.' },
      { key: 'ship', name: 'Ship', you: true, file: 'pr.md', what: 'You read the diff, approve and push, then create the PR.' }
    ]
  },
  {
    id: 'bug', name: 'Fix a bug', tag: 'Bug', when: 'A defect you can reproduce.', handsOff: true, start: 'item', lane: 'bug',
    steps: [
      { key: 'start', name: 'Set up', file: 'brief.md', what: 'Fetches the work item, picks the repos, makes branches and writes a short brief.' },
      { key: 'bug', name: 'Root cause', you: true, file: 'bug.md', what: 'The symptom, the code path and the root cause, with at most 3 tasks. You approve it.' },
      { key: 'build', name: 'Fix', file: 'progress.md', what: 'A failing test first, then the fix. One task per fresh session.' },
      { key: 'review', name: 'Review', file: 'review.md', what: 'Checks the fix against the bug write-up, then the code quality.' },
      { key: 'pr', name: 'PR text', file: 'pr.md', what: 'A short title and description for each repo.' },
      { key: 'ship', name: 'Ship', you: true, file: 'pr.md', what: 'You read the diff, approve and push, then create the PR.' }
    ]
  },
  {
    id: 'quick', name: 'Quick change', tag: 'Quick change', when: 'No ADO item. Describe it, then it runs as a feature or a bug.', handsOff: true, start: 'describe',
    steps: null // the feature or bug steps, by the lane you pick
  },
  {
    id: 'spike', name: 'Investigate', tag: 'Spike', when: "You don't know enough to spec it yet. No code changes.", start: 'spike', kind: 'spike',
    steps: [
      { key: 'investigate', name: 'Investigate', file: 'findings.md', what: 'Reads the code and answers with options and a recommendation.' },
      { key: 'findings', name: 'Read the findings', you: true, file: 'findings.md', what: 'Read the answer. Start work from it when it is ready.' }
    ]
  },
  {
    id: 'epic', name: 'Plan an epic', tag: 'Epic', when: 'An idea with no work items yet: epic, features and stories.', start: 'epic', kind: 'scope',
    steps: [
      { key: 'scope', name: 'Scope', file: 'stories.md', what: 'Asks at most 3 questions, then writes the epic (epics.md) and stories with acceptance criteria (stories.md).' },
      { key: 'stories', name: 'Approve stories', you: true, file: 'stories.md', what: 'Read epics.md and stories.md. Approve them, or send them back with a note.' },
      { key: 'slice', name: 'Slice', file: 'milestones.md', what: 'Maps each story to real files and puts them in build order (milestones.md).' },
      { key: 'milestones', name: 'Approve milestones', you: true, file: 'milestones.md', what: 'Read milestones.md. Approve it, or send it back with a note.' },
      { key: 'backlog', name: 'Backlog', file: 'milestones.md', what: 'An ADO import file (backlog.csv), ADO items, or local items, one per story.' }
    ]
  },
  {
    id: 'docs', name: 'Write docs', tag: 'Docs', when: 'New or updated documentation, fact-checked against the code.', start: 'docs', kind: 'docs',
    steps: [
      { key: 'draft', name: 'Draft', you: true, file: 'sources.md', what: 'Asks where the doc lives, who reads it and what they need, shows you an outline, then writes it.' },
      { key: 'check', name: 'Fact-check', file: 'check.md', what: 'A new session checks every claim against the code.' },
      { key: 'fix', name: 'Fix', you: true, file: 'check.md', what: 'Read check.md and fix anything it flags.' }
    ]
  },
  {
    id: 'tsd', name: 'Technical spec', tag: 'TSD', when: 'A product or repos told through diagrams.', start: 'tsd', kind: 'tsd',
    steps: [
      { key: 'draft', name: 'Draft', you: true, file: 'tsd.md', what: 'Confirms the repos with you, lists what is there, asks you to pick the flows, then writes tsd.md.' },
      { key: 'check', name: 'Fact-check', file: 'check.md', what: 'A new session checks every box and arrow against the code.' },
      { key: 'revise', name: 'Revise', you: true, file: 'check.md', what: 'Fix what check.md flags: edit tsd.md, or run /tsd again.' },
      { key: 'publish', name: 'Publish', you: true, file: 'tsd.md', what: 'Approves it and copies it to the product docs folder. You commit it.' }
    ]
  }
];
export const FLOW_IDS = FLOWS.map(f => f.id);
export const flowById = id => FLOWS.find(f => f.id === id) || null;
/** The steps of a flow; Quick change has the feature or bug steps. */
export function stepsOf(flow, lane) {
  if (!flow) return [];
  if (flow.steps) return flow.steps;
  return flowById(lane === 'bug' ? 'bug' : 'feature').steps;
}
const KIND_FLOW = { spike: 'spike', scope: 'epic', docs: 'docs', tsd: 'tsd' };
/** The flow a .work folder follows: a work item by its lane, anything else by its kind. Null for PR reviews and
 *  folders no flow knows (Slate's triage, shape, refine and handoff folders, and anything else). */
export function flowOf(it) {
  if (!it) return null;
  if (it.kind === 'item') return flowById(it.lane === 'bug' ? 'bug' : 'feature');
  return flowById(KIND_FLOW[it.kind]) || null;
}
/** A local work item (no tracker) started with Quick change shows that name. */
export function flowTag(it) {
  const f = flowOf(it);
  if (!f) return it && it.kind === 'pr' ? 'PR review' : 'Folder';
  if (it.kind === 'item' && /^L\d+$/i.test(String(it.id || ''))) return 'Quick ' + f.tag.toLowerCase();
  return f.tag;
}
/** Slate's own folders (triage, shape, refine, handoff): Slate shows them, so Work leaves them out. */
export const isSlateFolder = it => !!it && /^(triage|shape|refine|handoff)-/.test(it.folder || '');

// ------------------------------------------------------------------ where a run is
const SCOPE_AT = { 'Scoping': 0, 'Stories in review': 1, 'Stories approved': 2, 'Milestones in review': 3, 'Milestones approved': 4, 'Import file ready': 5, 'Work items created': 5 };
/** The index of the step the run is at. steps.length means every step is done. -1: unknown. */
export function stepIndex(it) {
  const f = flowOf(it);
  if (!f) return -1;
  const steps = stepsOf(f, it.lane);
  if (it.kind === 'item') {
    if (it.stage === 'ship') return steps.length - 1;
    const i = steps.findIndex(s => s.key === it.stage);
    return i;
  }
  const st = String(it.state || '');
  if (f.id === 'spike') return /^Findings written/i.test(st) ? 1 : 0;
  if (f.id === 'epic') return Object.prototype.hasOwnProperty.call(SCOPE_AT, st) ? SCOPE_AT[st] : 0;
  if (f.id === 'docs') return /^Fact-checked/i.test(st) ? 2 : /^Written/i.test(st) ? 1 : 0;
  if (f.id === 'tsd') {
    if (/^Published/i.test(st)) return 4;
    if (/^Draft, fact-checked/i.test(st)) return 3;
    if (/^Draft, fact-check found/i.test(st)) return 2;
    if (/^Draft, not fact-checked/i.test(st)) return 1;
    return 0;
  }
  return -1;
}
/** Every step done (an epic with its backlog made, a published TSD), or a spike or doc there is nothing more to run on. */
export function isFinished(it) {
  const f = flowOf(it);
  if (!f || it.kind === 'item') return false;
  const i = stepIndex(it);
  if (i >= stepsOf(f).length) return true;
  return (f.id === 'spike' && i === 1) || (f.id === 'docs' && i === 2);
}
/** The step in view: the one the run is at, or the last one once every step is done. */
export function currentStep(it) {
  const steps = stepsOf(flowOf(it), it.lane);
  const i = stepIndex(it);
  return i < 0 ? null : steps[Math.min(i, steps.length - 1)] || null;
}

/** What is happening at the current step, in a few words. */
export function hereWords(it, step) {
  if (it.paused) return 'Paused';
  if (it.blocked) return 'Blocked';
  if (asking(it)) return 'Waiting on you';
  if (autoIs(it, 'running') || isBusy(itemSession(it))) return 'Working';
  if (it.kind === 'item') {
    if (it.stage === 'ship') return 'Your turn';
    const n = it.next || {};
    if (n.needsYou) return 'Your turn';
    if (step && step.key === 'build' && it.tasks && it.tasks.total) return it.tasks.done + ' of ' + it.tasks.total + ' done';
    return 'Up next';
  }
  if (isFinished(it)) return 'Done';
  return step && step.you ? 'Your turn' : 'Up next';
}

/** True when the run waits on you at a gate (not an agent prompt: those are their own Inbox rows). Work items use
 *  the pipeline's own answer (bucket needs, autopilot waiting); an epic waits at its two approvals; a TSD from its
 *  fact-check to publish. Spikes and docs never block anything, so they stay in Work. */
export function atGate(it) {
  if (!it || it.paused) return false;
  if (it.kind === 'item') return bucketOf(it) === 'needs' && !asking(it);
  const f = flowOf(it);
  if (!f || asking(it) || isBusy(itemSession(it))) return false;
  const i = stepIndex(it);
  if (f.id === 'epic') return i === 1 || i === 3;
  if (f.id === 'tsd') return i === 2 || i === 3;
  return false;
}

/** Whose turn it is, in plain words: "Your turn: read the spec", "Tandem: writing the plan". Escaped HTML. */
export function turnHtml(it) {
  const step = currentStep(it);
  const s = itemSession(it);
  if (it.paused) return '<span class="turnw t-hold">Paused' + (it.paused.reason ? ':</span> ' + md(it.paused.reason) : '.</span>');
  if (asking(it)) return '<span class="turnw t-you">Your turn:</span> answer Tandem';
  if (autoIs(it, 'running')) return '<span class="turnw t-tandem">Tandem:</span> ' + h((s && s.activity) || 'running the rest on autopilot');
  if (isBusy(s)) return '<span class="turnw t-tandem">Tandem:</span> ' + h(s.activity || (step ? step.name.toLowerCase() : 'working'));
  if (it.blocked) return '<span class="turnw t-stop">Stopped:</span> ' + md(it.blocked);
  if (s && s.error) return '<span class="turnw t-stop">Stopped:</span> ' + h(s.error);
  if (it.kind === 'item') {
    const n = it.next || {};
    const what = n.action ? md(n.action) : n.command ? h(stepWords(it, n.command)) : '';
    if (it.stage === 'ship') return '<span class="turnw t-you">Your turn:</span> ' + (what || 'review, push and create the PR');
    if (n.needsYou || autoIs(it, 'waiting')) return '<span class="turnw t-you">Your turn:</span> ' + (what || 'approve');
    return what ? '<span class="turnw t-next">Up next:</span> ' + what : '';
  }
  if (isFinished(it)) {
    if (it.kind === 'spike') return '<span class="turnw t-done">Findings are ready.</span>' + (it.recommendation ? ' ' + md(it.recommendation) : '');
    return '<span class="turnw t-done">Done.</span>' + (it.nextText ? ' ' + md(liveNote(it.nextText)) : '');
  }
  const nx = it.nextText ? md(liveNote(it.nextText)) : '';
  return step && step.you ? '<span class="turnw t-you">Your turn:</span> ' + (nx || h(step.name.toLowerCase())) : nx ? '<span class="turnw t-next">Up next:</span> ' + nx : '';
}
function stepWords(it, cmd) {
  const p = String(cmd).split(/\s+/), name = p[0].replace(/^\//, '');
  if (name === 'do-task') {
    const n = +p[2], t = ((it.tasks && it.tasks.list) || []).filter(x => x.n === n)[0];
    return 'Task ' + n + (t ? ': ' + t.title : '');
  }
  return ((S.D && S.D.stepWords) || {})[name] || cmd;
}

// ------------------------------------------------------------------ the file to read at a gate, and sending it back
/** The file to read before approving: spec.md, plan.md, bug.md, stories.md, milestones.md, or a TSD's check.md. */
export function gateFile(it) {
  if (!it || it.paused) return null;
  const files = it.files || [];
  let f = null;
  if (it.kind === 'item') {
    const n = it.next || {};
    if (!n.needsYou) return null;
    f = { spec: 'spec.md', plan: 'plan.md', bug: 'bug.md', review: 'review.md' }[n.stage] || null;
  } else {
    const step = currentStep(it);
    if (!step || !atGate(it)) return null;
    f = step.key === 'publish' ? 'tsd.md' : step.file;
  }
  return f && files.includes(f) ? f : null;
}
/** The command that redoes a gate's draft after you added a note under Open questions (docs/pipeline.md, Gates: "add
 *  notes under Open questions, and re-run the same command"). Null where there is nothing to send back. */
export function sendBackCommand(it) {
  if (!it || it.paused) return null;
  if (it.kind === 'item') {
    const n = it.next || {};
    if (!n.needsYou || !it.id) return null;
    return { spec: `/spec ${it.id}`, plan: `/plan ${it.id}`, bug: `/bug ${it.id}` }[n.stage] || null;
  }
  const f = flowOf(it), i = stepIndex(it);
  if (f && f.id === 'epic' && i === 1) return `/scope ${it.folder}`;
  if (f && f.id === 'epic' && i === 3) return `/slice ${it.folder}`;
  return null;
}
/** The gate file with your note added under its "Open questions" heading (made at the end when missing). */
export function addOpenQuestion(text, note) {
  const n = String(note || '').trim().replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean).join(' ');
  if (!n) return String(text || '');
  const line = `- From you: ${n}`;
  const src = String(text || '').replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const at = lines.findIndex(l => /^#{1,6}\s+Open questions\b/i.test(l));
  if (at < 0) return src.replace(/\n*$/, '') + '\n\n## Open questions\n\n' + line + '\n';
  // The section runs to the next heading. Its "None" placeholder goes: there is a question now.
  let end = at + 1;
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end++;
  const body = lines.slice(at + 1, end).filter(l => !/^\s*[-*]?\s*(none|nothing)( yet)?\.?\s*$/i.test(l));
  while (body.length && !body[body.length - 1].trim()) body.pop();
  while (body.length && !body[0].trim()) body.shift();
  const rest = lines.slice(end);
  return lines.slice(0, at + 1).concat([''], body, [line], rest.length ? [''].concat(rest) : []).join('\n').replace(/\n*$/, '\n');
}

/** A doc's fact-check command, from what the /docs session said when it finished ("run `/check-docs <path>`"). */
export function docsCheckCommand(it) {
  if (!it || it.kind !== 'docs') return null;
  const live = S.L && S.L.items && S.L.items[it.folder];
  const texts = [];
  const s = itemSession(it);
  if (s && s.text) texts.push(s.text);
  if (live && S.L.sessions) for (const x of live.sessions || []) { const ss = S.L.sessions[x.id]; if (ss && ss.text) texts.push(ss.text); }
  for (const t of texts) {
    const m = /\/check-docs\s+([^\s`'"<>|;&]+)/.exec(t);
    if (m) return '/check-docs ' + m[1];
  }
  return null;
}
/** The command a non-work-item folder runs next: its next text's command, or a doc's fact-check. */
export function folderCommand(it) {
  if (!it || it.kind === 'item') return null;
  if (it.kind === 'docs' && stepIndex(it) === 1) return docsCheckCommand(it);
  return noteCommand(it);
}

// ------------------------------------------------------------------ drawing
/** The dots of a flow, for a Start work card: one per step, a ring on the ones that stop for you. */
export function dotsHtml(steps) {
  return `<span class="fdots" aria-hidden="true">${steps.map(s => `<i class="${s.you ? 'you' : ''}" title="${h(s.name)}"></i>`).join('')}</span>`;
}
/** The steps as a sentence, for screen readers and the card's text. */
export function stepsLine(steps) {
  return steps.map(s => s.name + (s.you ? ' (you)' : '')).join(', ');
}
export function youCount(steps) { return steps.filter(s => s.you).length; }

/** The run page's step track: every step is a button; done steps checked, the current one filled, later ones faint.
 *  A ring marks the steps that stop for you. `sel`: the step in view. */
export function flowTrackHtml(it, sel) {
  const f = flowOf(it);
  const steps = stepsOf(f, it.lane);
  const idx = stepIndex(it);
  const cur = currentStep(it);
  const here = cur ? hereWords(it, cur) : '';
  const label = idx < 0 ? 'Step unknown' : idx >= steps.length ? 'Every step done' : `Step ${idx + 1} of ${steps.length}: ${steps[idx].name}, ${here}`;
  let out = `<ol class="flow" aria-label="${h(label)}">`;
  steps.forEach((s, j) => {
    const done = idx >= 0 && (j < idx || idx >= steps.length);
    const now = j === idx;
    const cls = ['fstep', done ? 'done' : now ? 'here' : 'later', s.you ? 'you' : '', sel === s.key ? 'sel' : ''].filter(Boolean).join(' ');
    const sub = now ? here : done ? 'Done' : s.you ? 'Stops for you' : '';
    out += `<li class="${cls}"><button type="button" data-step="${h(s.key)}" aria-pressed="${sel === s.key}" title="${h(s.what)}">` +
      `<span class="dot">${done ? CHECK : ''}</span><span class="nm">${h(s.name)}</span><span class="sub">${h(sub)}</span></button></li>`;
  });
  return out + '</ol>';
}
const CHECK = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg>';

/** A one-line "Step 3 of 8: Plan" for rows. */
export function stepLine(it) {
  const f = flowOf(it);
  if (!f) return '';
  const steps = stepsOf(f, it.lane);
  const i = stepIndex(it);
  if (i < 0) return '';
  if (i >= steps.length) return 'Every step done';
  let s = `Step ${i + 1} of ${steps.length}: ${steps[i].name}`;
  if (steps[i].key === 'build' && it.tasks && it.tasks.total) s += ` ${it.tasks.done}/${it.tasks.total}`;
  return s;
}
/** A small progress bar of the flow for rows and Inbox cards: one segment per step. */
export function miniTrack(it) {
  const steps = stepsOf(flowOf(it), it.lane);
  const i = stepIndex(it);
  if (!steps.length || i < 0) return '';
  return `<span class="mtrack" aria-hidden="true">${steps.map((s, j) => `<i class="${j < i || i >= steps.length ? 'done' : j === i ? 'here' : ''}${s.you ? ' you' : ''}"></i>`).join('')}</span>`;
}

/** The Start work card for one flow. */
export function flowCardHtml(f) {
  const steps = stepsOf(f, 'feature');
  const you = youCount(steps);
  const extra = f.id === 'quick' ? 'Feature or bug steps' : `${plural(steps.length, 'step')}, ${plural(you, 'stop')} for you`;
  return `<button type="button" class="fcard" data-flow="${h(f.id)}" aria-label="${h(f.name + '. ' + f.when + ' Steps: ' + stepsLine(steps))}">` +
    `<span class="fc-t">${h(f.name)}</span><span class="fc-w">${h(f.when)}</span>` +
    `<span class="fc-s">${dotsHtml(steps)}<span class="fc-n">${h(extra)}</span></span>` +
    (f.handsOff ? '<span class="fc-h">Hands-off after you approve</span>' : '') + '</button>';
}
