/* Dispatch flows (plan: claude/runs-flows-v1-plan.md in the Workshop project). A flow is a named recipe that
   follows eng-agents' suggested flows (README, Daily use; docs/pipeline.md, Lanes): its steps, which steps stop for
   you, the file each step writes, and whether Tandem can run the middle hands-off. This file is the one place that
   defines them: the Start work picker, the run page's step track, the Inbox and the Work tab all read it.
   A run's flow is not stored: it follows from the .work folder (a work item's lane, or the folder's kind).
   No DOM: tested in Node. */
import { S } from './state.js';
import { h, md, plural, asking, isBusy, itemSession, autoIs, bucketOf, noteCommand, liveNote } from './view.js';

/** The presets. PICKER is the order Start work shows them (Builds flow cards, claude/loom-flow-cards-v1-plan.md): the
 *  cards are the main way work starts, and every flow ends on a finish (Ship and Resolve, a fork, Save, Create in ADO).
 *  `you`: the step stops for you (`'blockers'`: only when the review finds blockers it cannot turn into fix tasks).
 *  `quiet`: shown on the run page only, not as a dot (Set up is not a decision). `fork`: the step ends with path cards.
 *  `file`: what the step writes (read inline on the run page). `start`: the form Start work shows. `board`: the flow
 *  runs on the board (a card's stages), not in a .work folder. `picker: false`: kept for runs, never a card. */
const SET_UP = { key: 'start', name: 'Set up', quiet: true, file: 'repos.md', what: 'Fetches the work item, picks the repos and makes branches. The lane comes from the work item type.' };
const REVIEW = what => ({ key: 'review', name: 'Review', you: 'blockers', file: 'review.md', what: what + ' Stops for you only when it finds blockers it cannot turn into fix tasks.' });
const SHIP = { key: 'ship', also: ['pr'], name: 'Ship', you: true, file: 'pr.md', what: 'Tandem writes the PR text. You read the diff, push and create the PR. Once it merges, Resolve in ADO finishes it.',
  off: { what: 'Tandem writes the PR text. You read the diff, push and create the PR.' } };
export const FLOWS = [
  {
    id: 'request', name: 'Handle a request', tag: 'Request', when: 'Someone asked for something. Triage it, then pick the path.', start: 'request', board: true,
    steps: [
      { key: 'triage', name: 'Triage', you: true, fork: true, what: 'Reads the request and the code and says what is missing. Then you pick: interview, skip to the brief, or decline. Waiting on the requester pauses it.' },
      { key: 'interview', name: 'Interview', you: true, what: 'A round of questions at a time, until the request is understood.' },
      { key: 'brief', name: 'Brief', you: true, fork: true, what: 'Read the brief, then pick: build it, fix it, investigate, hand it to a person, or decline.' }
    ]
  },
  {
    id: 'feature', name: 'Build a feature', tag: 'Feature', when: 'New behavior. An ADO item, or describe it. Small changes get one short plan.', off: { when: 'New behavior. Describe it. Small changes get one short plan.' }, handsOff: true, start: 'item', lane: 'feature',
    steps: [
      SET_UP,
      // One gate (eng-agents Core 4.0.0): /spec writes the spec, the plan and the tasks; one /approve covers them.
      { key: 'spec', also: ['plan', 'tasks'], name: 'Spec and plan', you: true, file: 'spec.md', what: 'Asks at most 3 questions, then writes the spec, the plan (files, pattern to follow, test plan) and small tasks in one go. You approve them once.' },
      { key: 'build', name: 'Build', file: 'progress.md', what: 'One task per fresh session, test first, a commit each.' },
      REVIEW('Checks the work against the spec, then the code quality. Blockers become fix tasks.'),
      SHIP
    ]
  },
  {
    id: 'bug', name: 'Fix a bug', tag: 'Bug', when: 'A defect: an ADO item, describe it, or paste an error log.', off: { when: 'A defect: describe it, or paste an error log.' }, handsOff: true, start: 'item', lane: 'bug',
    steps: [
      SET_UP,
      { key: 'bug', name: 'Root cause', you: true, file: 'bug.md', what: 'A repro with evidence, the code path and the root cause, with at most 3 tasks and other places with the same flaw. You approve it.' },
      { key: 'build', name: 'Fix', file: 'progress.md', what: 'A failing test first, then the fix. One task per fresh session.' },
      REVIEW('Checks the fix against the bug write-up, then the code quality.'),
      SHIP
    ]
  },
  {
    id: 'spike', name: 'Investigate', tag: 'Spike', when: "A question you can't spec yet. No code changes.", start: 'spike', kind: 'spike',
    steps: [
      { key: 'investigate', name: 'Investigate', file: 'findings.md', what: 'Reads the code and answers your question with up to 3 options and one recommendation, within the timebox if you set one.' },
      { key: 'findings', name: 'Findings', you: true, fork: true, file: 'findings.md', what: 'Read the answer, then pick: build it, fix it, write it up, save it as a note, or close it.' }
    ]
  },
  {
    id: 'epic', name: 'Plan an epic', tag: 'Epic', when: 'An idea with no work items yet: epic, features and stories.', start: 'epic', kind: 'scope',
    steps: [
      { key: 'scope', name: 'Scope', file: 'stories.md', what: 'Asks at most 3 questions, then writes the epic (epics.md) and light stories (stories.md): what and why, 1 to 3 outcome-only scenarios each. Engineering decides how.' },
      { key: 'stories', name: 'Stories', you: true, file: 'stories.md', what: 'Read epics.md and stories.md. Approve them, or send them back with a note.' },
      { key: 'slice', name: 'Slice', file: 'milestones.md', what: 'Puts features and stories in build order (milestones.md). Each feature gets a short description and a release note; code pointers stay local as notes for the builder.' },
      { key: 'milestones', name: 'Milestones', you: true, file: 'milestones.md', what: 'Read milestones.md. Approve it, or send it back with a note.' },
      { key: 'backlog', name: 'Create in ADO', you: true, file: 'milestones.md', what: 'Your click creates the ADO items (a dry run and your yes first), one per story, with parent links. Each story then gets a card in Decide.',
        off: { name: 'Create the stories', what: 'Your click makes one local item per story. Each story then gets a card in Decide.' } }
    ]
  },
  {
    id: 'handoff', name: 'Hand to a person', tag: 'Hand-off', when: 'Someone else should build it. Define it, assign it, follow it.', start: 'handoff', board: true,
    steps: [
      { key: 'define', name: 'Define', you: true, what: 'Tandem drafts one story (description and acceptance criteria). You approve it; it is published to ADO.', off: { what: 'Tandem drafts one story (description and acceptance criteria). You approve it.' } },
      { key: 'assign', name: 'Assign', you: true, what: 'Pick who and assign it in ADO, in one step. A brief for them and a Tasks follow-up are options.', off: { what: 'Pick who. A brief for them and a Tasks follow-up are options.' } },
      { key: 'with', name: 'With them', what: 'Tracked on the board until it merges. If nothing moves in 3 working days, the Inbox nudges you.' },
      { key: 'resolve', name: 'Resolve', you: true, what: 'Merged: Resolve in ADO finishes it.', off: { what: 'Merged: resolve it to finish.' } }
    ]
  },
  {
    id: 'docs', name: 'Write docs', tag: 'Docs', when: 'New or updated docs, or a technical spec with diagrams, fact-checked against the code.', start: 'docs', kind: 'docs',
    steps: [
      { key: 'draft', name: 'Draft', file: 'sources.md', what: 'Picks where the doc lives, who reads it and what they need (it tells you, so you can change them), then writes it.' },
      { key: 'read', name: 'Read draft', you: true, file: 'sources.md', what: 'Read the doc. When it says the right things, send it to the fact-check.' },
      { key: 'check', name: 'Fact-check', file: 'check.md', what: 'A new session checks every claim against the code.' },
      { key: 'final', name: 'Final read', you: true, file: 'check.md', what: 'Fix anything check.md flags.' },
      { key: 'save', name: 'Save', you: true, fork: true, file: 'sources.md', what: 'Pick where it goes: the repo (approved in place; you commit it and open the PR) or Notes.' }
    ]
  },
  // Fix a bug from an error log (Core 4.3.0 /spike --log): a diagnosis, no code changes. Picked on Fix a bug's form.
  {
    id: 'diagnose', name: 'Diagnose an error log', tag: 'Error log', when: 'A log or stack trace: probable root cause, why, and a fix, configuration first.', start: 'item', kind: 'spike', picker: false,
    steps: [
      { key: 'investigate', name: 'Diagnose', file: 'findings.md', what: 'Reads the log, finds where it happens in the code, checks the configuration first, then the code. No changes.' },
      { key: 'findings', name: 'Diagnosis', you: true, fork: true, file: 'findings.md', what: 'The probable root cause, why, and a solution, configuration first. Then pick: apply the change and close, fix it in code, investigate more, save it as a note, or close.' }
    ]
  },
  // Technical spec: a Write docs type since flow cards v1 (picked on the Write docs form). Kept for tsd- folders.
  {
    id: 'tsd', name: 'Technical spec', tag: 'TSD', when: 'A product or repos told through diagrams.', start: 'docs', kind: 'tsd', picker: false,
    steps: [
      { key: 'draft', name: 'Draft', file: 'tsd.md', what: 'Lists what is there, picks the flows to diagram (it tells you, so you can swap them), then writes tsd.md.' },
      { key: 'read', name: 'Read draft', you: true, file: 'tsd.md', what: 'Read tsd.md. When it tells the right story, send it to the fact-check.' },
      { key: 'check', name: 'Fact-check', file: 'check.md', what: 'A new session checks every box and arrow against the code.' },
      { key: 'final', name: 'Final read', you: true, file: 'check.md', what: 'Fix what check.md flags: edit tsd.md, or run /tsd again.' },
      { key: 'save', name: 'Save', you: true, file: 'tsd.md', what: 'Publish approves it and copies it to the product docs folder. You commit it.' }
    ]
  },
  // Small change: a Build a feature option since flow cards v1 (the quick lane). Kept for quick-lane runs.
  {
    id: 'small', name: 'Small change', tag: 'Small', when: 'One repo, 1 or 2 tasks, no schema or API change.', handsOff: true, start: 'item', lane: 'quick', picker: false,
    steps: [
      { ...SET_UP, what: 'Fetches the work item, picks the repo and makes the branch.' },
      { key: 'quick', name: 'Quick plan', you: true, file: 'quick.md', what: 'Acceptance criteria, files and a pattern to follow in one file, plus at most 2 tasks. You approve once. Bigger work steps up to the feature lane on its own.' },
      { key: 'build', name: 'Build', file: 'progress.md', what: 'One task per fresh session, test first, a commit each.' },
      REVIEW('Checks the work against quick.md, then the code quality. Blockers become fix tasks.'),
      SHIP
    ]
  }
];
/** Azure DevOps on or off (shared/ado.js): a flow or step with `off` words shows them while ADO is off, and its
 *  own words again once it is on. Builds calls this whenever ADO turns on or off. */
const ADO_KEYS = ['name', 'what', 'when'];
const adoWords = new WeakMap();
export function setFlowsAdo(on) {
  const all = new Set([SHIP]);
  for (const f of FLOWS) { all.add(f); for (const st of f.steps || []) all.add(st); }
  for (const x of all) {
    if (!x.off) continue;
    if (!adoWords.has(x)) adoWords.set(x, Object.fromEntries(ADO_KEYS.filter(k => k in x).map(k => [k, x[k]])));
    Object.assign(x, on ? adoWords.get(x) : x.off);
  }
  YOUR_TURN.backlog = on ? 'create the items in ADO.' : 'create the stories.';
}

/** The flow cards, in order. */
export const PICKER = FLOWS.filter(f => f.picker !== false);
export const FLOW_IDS = FLOWS.map(f => f.id);
export const flowById = id => FLOWS.find(f => f.id === id) || null;
/** The steps of a flow; Quick change has the feature, small or bug steps, by its lane. */
export function stepsOf(flow, lane) {
  if (!flow) return [];
  if (flow.steps) return flow.steps;
  return flowById(LANE_FLOW[lane] || 'feature').steps;
}
const KIND_FLOW = { spike: 'spike', scope: 'epic', docs: 'docs', tsd: 'tsd' };
const LANE_FLOW = { feature: 'feature', bug: 'bug', quick: 'small' };
/** The flow a .work folder follows: a work item by its lane, anything else by its kind. Null for PR reviews and
 *  folders no flow knows (Builds' triage, shape, refine and handoff folders, and anything else). */
export function flowOf(it) {
  if (!it) return null;
  if (it.kind === 'item') return flowById(LANE_FLOW[it.lane] || 'feature');
  if (it.kind === 'spike' && it.fromLog) return flowById('diagnose');
  return flowById(KIND_FLOW[it.kind]) || null;
}
/** A local work item (no tracker) started with Quick change shows that name. */
export function flowTag(it) {
  const f = flowOf(it);
  if (!f) return it && it.kind === 'pr' ? 'PR review' : 'Folder';
  if (it.kind === 'item' && /^L\d+$/i.test(String(it.id || ''))) return 'Quick ' + f.tag.toLowerCase();
  return f.tag;
}
/** Builds' own folders (triage, shape, refine, handoff): Builds shows them, so Work leaves them out. */
export const isSlateFolder = it => !!it && /^(triage|shape|refine|handoff)-/.test(it.folder || '');

// ------------------------------------------------------------------ where a run is
// 'Import file ready' still waits at Create in ADO: the CSV is made, but nothing is in ADO until you import or click.
const SCOPE_AT = { 'Scoping': 0, 'Stories in review': 1, 'Stories approved': 2, 'Milestones in review': 3, 'Milestones approved': 4, 'Import file ready': 4, 'Work items created': 5 };
/** True while the folder's session runs /check-docs: the run is at Fact-check, not at Read draft. */
function checking(it) {
  const s = itemSession(it);
  return !!(s && isBusy(s) && /^\/check-docs\b/.test(String(s.command || '')));
}
/** The index of the step the run is at. steps.length means every step is done. -1: unknown. */
export function stepIndex(it) {
  const f = flowOf(it);
  if (!f) return -1;
  const steps = stepsOf(f, it.lane);
  if (it.kind === 'item') {
    if (it.stage === 'ship') return steps.length - 1;
    const i = steps.findIndex(s => s.key === it.stage || (s.also || []).includes(it.stage));
    return i;
  }
  const st = String(it.state || '');
  if (f.kind === 'spike') return /^Closed/i.test(st) ? 2 : /^Findings written/i.test(st) ? 1 : 0;
  if (f.id === 'epic') return Object.prototype.hasOwnProperty.call(SCOPE_AT, st) ? SCOPE_AT[st] : 0;
  // Draft, Read draft (you), Fact-check, Final read (you), Save (you): flow cards v1.
  if (f.id === 'docs') {
    if (/^Saved/i.test(st)) return 5;
    if (/^Fact-checked/i.test(st)) return 3;
    if (/^Written/i.test(st)) return checking(it) ? 2 : 1;
    return 0;
  }
  if (f.id === 'tsd') {
    if (/^Published/i.test(st)) return 5;
    if (/^Draft, fact-check/i.test(st)) return 3;
    if (/^Draft, not fact-checked/i.test(st)) return checking(it) ? 2 : 1;
    return 0;
  }
  return -1;
}
/** Every step done: an epic with its items in ADO, a doc saved, a published TSD, a spike you closed or took on. */
export function isFinished(it) {
  const f = flowOf(it);
  if (!f || it.kind === 'item') return false;
  return stepIndex(it) >= stepsOf(f).length;
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
  if (autoIs(it, 'queued')) return 'Queued';
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
 *  the pipeline's own answer (bucket needs, autopilot waiting). Everything else waits at each step that stops for
 *  you (flow cards v1): an epic's approvals and Create in ADO, a doc's or TSD's two reads, a spike's findings. */
export function atGate(it) {
  if (!it || it.paused) return false;
  if (it.kind === 'item') return bucketOf(it) === 'needs' && !asking(it);
  const f = flowOf(it);
  if (!f || asking(it) || isBusy(itemSession(it))) return false;
  const i = stepIndex(it);
  const steps = stepsOf(f);
  return i >= 0 && i < steps.length && steps[i].you === true;
}

/** Whose turn it is, in plain words: "Your turn: read the spec", "Tandem: writing the plan". Escaped HTML. */
export function turnHtml(it) {
  const step = currentStep(it);
  const s = itemSession(it);
  if (it.paused) return '<span class="turnw t-hold">Paused' + (it.paused.reason ? ':</span> ' + md(it.paused.reason) : '.</span>');
  if (asking(it)) return '<span class="turnw t-you">Your turn:</span> answer Tandem';
  if (autoIs(it, 'queued')) return '<span class="turnw t-tandem">Tandem:</span> queued, starts when a running build finishes';
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
    if (it.kind === 'spike') return '<span class="turnw t-done">Closed.</span>' + (it.nextText ? ' ' + md(liveNote(it.nextText)) : '');
    return '<span class="turnw t-done">Done.</span>' + (it.nextText ? ' ' + md(liveNote(it.nextText)) : '');
  }
  const f = flowOf(it);
  const said = step && step.you && f && (YOUR_TURN[f.id + '.' + step.key] || YOUR_TURN[step.key]);
  if (said) return '<span class="turnw t-you">Your turn:</span> ' + h(said) + (f.id === 'diagnose' && it.fixType ? ' <b>' + h(it.fixType) + ' fix.</b>' : '') + (step.key === 'findings' && (f.id === 'diagnose' ? it.summary : it.recommendation) ? ' ' + md(f.id === 'diagnose' ? it.summary : it.recommendation) : '');
  const nx = it.nextText ? md(liveNote(it.nextText)) : '';
  return step && step.you ? '<span class="turnw t-you">Your turn:</span> ' + (nx || h(step.name.toLowerCase())) : nx ? '<span class="turnw t-next">Up next:</span> ' + nx : '';
}
// What you do at a folder flow's stop, in plain words (flow cards v1).
const YOUR_TURN = {
  findings: 'read the findings, then pick what is next.',
  'diagnose.findings': 'read the diagnosis, then pick what is next.',
  read: 'read the draft, then send it to the fact-check.',
  final: 'fix what check.md flags, then pick where it goes.',
  'tsd.final': 'fix what check.md flags, then publish it.',
  backlog: 'create the items in ADO.'
};
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
    f = { spec: 'spec.md', plan: 'plan.md', bug: 'bug.md', quick: 'quick.md', review: 'review.md' }[n.stage] || null;
    // One feature gate: the spec is still a draft, so read it first (the plan and tasks are approved with it).
    if (n.stage === 'plan' && (it.gates || {}).spec === 'DRAFT') f = 'spec.md';
  } else {
    const step = currentStep(it);
    if (!step || !atGate(it)) return null;
    f = step.file;
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
    if (n.stage === 'plan' && (it.gates || {}).spec === 'DRAFT') return `/spec ${it.id}`; // one gate: /spec redoes all three
    return { spec: `/spec ${it.id}`, plan: `/spec ${it.id} plan`, bug: `/bug ${it.id}`, quick: `/quick ${it.id}` }[n.stage] || null;
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
/** The steps shown as dots, marks and "Step 2 of 4": Set up is left out (it is not a decision). */
export const shownSteps = steps => (steps || []).filter(s => !s.quiet);
const stopWords = s => s.you === 'blockers' ? ' (you, only on blockers)' : s.you ? ' (you)' : '';
const stopCls = s => s.you === 'blockers' ? 'maybe' : s.you ? 'you' : '';
/** The dots of a flow, for a Start work card: one per step, a ring on the ones that stop for you (a dashed ring:
 *  only sometimes). */
export function dotsHtml(steps) {
  return `<span class="fdots" aria-hidden="true">${shownSteps(steps).map(s => `<i class="${stopCls(s)}" title="${h(s.name + stopWords(s))}"></i>`).join('')}</span>`;
}
/** The steps as a sentence, for screen readers and the card's text. */
export function stepsLine(steps) {
  return shownSteps(steps).map(s => s.name + stopWords(s)).join(', ');
}
/** How many steps always stop for you. */
export function youCount(steps) { return shownSteps(steps).filter(s => s.you === true).length; }
/** Where the run is among the shown steps: {i, n, step}. A run at Set up shows as before its first shown step. */
function shownAt(it) {
  const steps = stepsOf(flowOf(it), it.lane);
  const shown = shownSteps(steps);
  const i = stepIndex(it);
  if (i < 0) return null;
  if (i >= steps.length) return { i: shown.length, n: shown.length, step: null };
  const at = shown.indexOf(steps[i]);
  return at >= 0 ? { i: at, n: shown.length, step: steps[i] } : { i: 0, n: shown.length, step: steps[i], before: true };
}

/** Path cards at a fork (flow cards v1): 2 to 5 choices, each a title and a line on what happens. `cards`:
 *  [{label, desc, attrs, primary, disabled, title}], where attrs is the button's data attributes as HTML (trusted:
 *  built here, values escaped by the caller). */
export function forkHtml(cards, label = 'Pick the next path') {
  const list = (cards || []).filter(Boolean);
  if (!list.length) return '';
  return `<div class="forks" role="group" aria-label="${h(label)}">${list.map(c =>
    `<button type="button" class="fork${c.primary ? ' rec' : ''}"${c.attrs ? ' ' + c.attrs : ''}${c.title ? ` title="${h(c.title)}"` : ''}${c.disabled ? ' disabled' : ''}>` +
    `<span class="fk-t">${h(c.label)}${c.primary ? '<span class="fk-rec">Suggested</span>' : ''}</span><span class="fk-d">${h(c.desc || '')}</span></button>`).join('')}</div>`;
}

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
    const cls = ['fstep', done ? 'done' : now ? 'here' : 'later', stopCls(s), sel === s.key ? 'sel' : ''].filter(Boolean).join(' ');
    const sub = now ? here : done ? 'Done' : s.you === 'blockers' ? 'Only on blockers' : s.you ? 'Stops for you' : '';
    out += `<li class="${cls}"><button type="button" data-step="${h(s.key)}" aria-pressed="${sel === s.key}" title="${h(s.what)}">` +
      `<span class="dot">${done ? CHECK : ''}</span><span class="nm">${h(s.name)}</span><span class="sub">${h(sub)}</span></button></li>`;
  });
  return out + '</ol>';
}
const CHECK = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg>';

/** A one-line "Step 2 of 4: Build" for rows. Set up is not counted. */
export function stepLine(it) {
  const at = shownAt(it);
  if (!at) return '';
  if (!at.step) return 'Every step done';
  if (at.before) return `Setting up, then ${at.n} steps`;
  let s = `Step ${at.i + 1} of ${at.n}: ${at.step.name}`;
  if (at.step.key === 'build' && it.tasks && it.tasks.total) s += ` ${it.tasks.done}/${it.tasks.total}`;
  return s;
}
/** A small progress bar of the flow for rows and Inbox cards: one mark per shown step. */
export function miniTrack(it) {
  const at = shownAt(it);
  const shown = shownSteps(stepsOf(flowOf(it), it.lane));
  if (!at || !shown.length) return '';
  const done = !at.step;
  const label = done ? 'Done' : at.before ? 'Setting up' : `Step ${at.i + 1} of ${at.n}: ${at.step.name}`;
  // One small mark per step, its name on hover; the current step's name is written out next to them (Builds UX v1).
  const marks = shown.map((s, j) => {
    const cls = done || j < at.i ? 'done' : j === at.i && !at.before ? 'here' : '';
    return `<i class="${cls}${s.you === true ? ' you' : s.you ? ' maybe' : ''}" title="${h(s.name + stopWords(s))}">${cls === 'done' ? CHECK : ''}</i>`;
  }).join('');
  return `<span class="mtrack" role="img" aria-label="${h(label)}">${marks}</span><span class="mstep">${h(done ? 'Done' : at.before ? 'Set up' : at.step.name)}</span>`;
}

/** The Start work card for one flow. */
export function flowCardHtml(f) {
  const steps = stepsOf(f, f.lane || 'feature');
  const you = youCount(steps);
  const extra = `${plural(shownSteps(steps).length, 'step')}, ${plural(you, 'stop')} for you`;
  return `<button type="button" class="fcard" data-flow="${h(f.id)}" aria-label="${h(f.name + '. ' + f.when + ' Steps: ' + stepsLine(steps))}">` +
    `<span class="fc-t">${h(f.name)}</span><span class="fc-w">${h(f.when)}</span>` +
    `<span class="fc-s">${dotsHtml(steps)}<span class="fc-n">${h(extra)}</span></span>` +
    (f.handsOff ? '<span class="fc-h">Hands-off after you approve</span>' : f.board ? '<span class="fc-h">A card on the floor, worked in its panel</span>' : '') + '</button>';
}

// Off until Builds knows (browser mode never has ADO).
setFlowsAdo(false);
