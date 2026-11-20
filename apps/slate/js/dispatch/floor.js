/* Loom floor (Loom 6.4.0; plan: claude/loom-floor-v1-plan.md in the Workshop project). The same cards as the lanes
   (lanes.js lanesData), drawn as a workshop floor: stations in a line, with each card stacked over the station it is
   at, so a busy station is visibly taller. Two lines:
   - Code line (Build: feature, bug, quick change): Plan desk, Build bay, Test bench, UI check, Review, Fix shop,
     Loading dock. Quick changes Tandem is building hands-off ride the express lane above it.
   - Research line (Ask, Diagnose, Docs, Epic): Plan desk, Investigate, Write, Review, Out tray. It ends in a brief
     or a breakdown, never a PR, and its runs never take a build slot. Always shown, even when empty (6.6.1; it was
     the "paper line" and folded when empty before).
   Stopped cards leave the line for the "Pulled off the line" bin. Everything else (requests, hand-offs, teammates'
   PRs, other sessions) is a chip under the lines. A card's station follows from its lane, stage, autopilot step and
   what its session says it is doing; nothing is stored. Clicking a card opens the same panel as the lanes
   (data-lane-open), so every button is the one the lanes already use. No DOM: main.js paints what this returns.

   Loom 6.5.0 (eng-agents Core 4.10.0, opencode connector 1.23.0): stories from an approved breakdown wear the brand
   color and ride the hand-off belt until they start; each epic building hands-off has a tracker card (its stories
   and where each one is). Products being onboarded show as new lines at the top, their five steps lit (Add, Scan,
   Fill the gaps, Trial run, Live).

   Loom 6.6.0 (eng-agents Core 4.12.0, connector 1.24.0): a build's station comes from Tandem's step.md when it has
   one (no more guessing from the session's text); cards carry their project's color; List is rows with a station
   track (Lanes keeps the four lanes); Onboard a product starts onboarding from Loom.

   Loom 6.7.0: the four lanes are gone; Floor and List are the two views. What only the Ready lane had moved here:
   Publish all ready (beside the Loading dock, and atop Needs you in List) and the runs done today (Shipped today
   under the code line, a Done today group in List). */
import { S } from './state.js';
import { h, plural, itemSession, isBusy, itemAuto, ago } from './view.js';
import { hasProjects, projectById, projectOf, projectName, sw } from './projects.js';
import { flowOf, stepIndex, stepsOf } from './flows.js';
import { KINDS, keyOf } from './lanes.js';
import { publishAllHtml, publishOf } from './factory.js';
import { afterOf } from './summary.js';

export const CODE = [
  { id: 'plan', name: 'Plan desk', you: true, desc: 'Plans to approve' },
  { id: 'build', name: 'Build bay', desc: 'Building' },
  { id: 'test', name: 'Test bench', desc: 'Running tests' },
  { id: 'ui', name: 'UI check', desc: 'Screenshots' },
  { id: 'review', name: 'Review', desc: 'Checking the work' },
  { id: 'fix', name: 'Fix shop', desc: 'Fixing what review found' },
  { id: 'dock', name: 'Loading dock', you: true, desc: 'Ready to publish' },
  { id: 'transit', name: 'In transit', desc: 'CI and reviewers' }
];
export const PAPER = [
  { id: 'plan', name: 'Plan desk', you: true, desc: 'Starting up' },
  { id: 'research', name: 'Investigate', desc: 'Reading the code' },
  { id: 'write', name: 'Write', desc: 'Drafting' },
  { id: 'review', name: 'Review', desc: 'Checking' },
  { id: 'out', name: 'Out tray', you: true, desc: 'Read it, or split it' }
];
/** How many cards a station shows before "+N more". */
export const STACK_MAX = 6;
/** The express lane's stations: a hands-off quick change rides it from Build to Fix. */
const EXPRESS = new Set(['build', 'test', 'ui', 'review', 'fix']);

/** A story from an approved breakdown (Core 4.10.0): the item's `story` from workitem.md. */
export const isStoryCard = c => !!(c && c.it && c.it.story);
/** A story that has not started yet: it rides the hand-off belt to the code line. */
export const onBelt = c => isStoryCard(c) && c.it.stage === 'start' && !(itemAuto(c.it) && itemAuto(c.it).status === 'running');

/** Which line a card is on: code (builds), paper (asks, diagnoses, docs, epics) or other (everything else). */
export function lineOf(c) {
  if (!c) return 'other';
  if (c.kind === 'build') return 'code';
  if (['ask', 'diagnose', 'docs', 'epic'].includes(c.kind)) return 'paper';
  return 'other';
}

const TEST_RE = /\btests?\b|\bspecs?\b|pytest|jest|vitest|dotnet test|npm (run )?test|Invoke-Pester/i;
const UI_RE = /\bUI\b|screenshot|playwright|check-ui|Test-Ui/i;
/** True when the card left the line: stopped, blocked, or its autopilot stopped. */
export function isStuck(it) {
  if (!it) return false;
  if (it.blocked) return true;
  const s = itemSession(it);
  if (s && s.error && !isBusy(s)) return true;
  const a = itemAuto(it);
  return !!a && a.status === 'stopped';
}
/** What the card's session says it is doing right now ('' when nothing). */
function activityOf(it) {
  const s = it && itemSession(it);
  return String((s && s.activity) || '');
}
const STEP_FITS = { build: ['build', 'test', 'ui', 'fix'], review: ['review', 'test', 'ui', 'fix'] };
/** Comments you sent back from the code review that Tandem is working on (connector 1.28.0), or 0. */
export function sentBackOf(it) {
  const r = it && S.D && S.D.reviews && S.D.reviews[it.folder];
  return r ? Object.values(r).filter(x => x && x.status === 'revising').reduce((n, x) => n + (x.sentBack || 0), 0) || (Object.values(r).some(x => x && x.status === 'revising') ? 1 : 0) : 0;
}
/** The station Tandem's step.md names (Core 4.12.0), or '' when there is none or it does not fit the item's stage. */
export function toldStep(it) {
  const st = it && it.step && it.step.name;
  return st && (STEP_FITS[it.stage] || []).includes(st) ? st : '';
}
/** The paper station for a flow step's key. */
const PAPER_STEP = { investigate: 'research', scope: 'research', slice: 'write', draft: 'write', stories: 'review', milestones: 'review', read: 'review', check: 'review', final: 'review', findings: 'out', backlog: 'out', save: 'out' };

/** A published build (connector 1.28.0): 'transit' until its PR merges, 'delivered' after, else ''. */
export function shippedState(it) {
  const p = publishOf(it);
  const rec = p && p.published;
  if (!rec) return '';
  return rec.merged ? 'delivered' : 'transit';
}
/** The one chip a card in transit shows: what its PR is waiting on, worst first. */
export function transitBadge(it) {
  const p = publishOf(it);
  const repos = (p && p.published && p.published.repos) || [];
  const ws = repos.map(r => r.watch || {});
  const fix = st => ws.some(w => w.fix && w.fix.state === st);
  if (fix('ready')) return { cls: 'warn', text: 'Fix ready to push' };
  if (fix('working')) return { cls: 'bad', text: ws.some(w => w.fix && w.fix.state === 'working' && w.fix.kind === 'conflict') ? 'Conflict: merging' : 'CI failed: fixing' };
  if (fix('needs-you') || fix('gave-up') || fix('not-fixed')) return { cls: 'bad', text: 'CI needs you' };
  if (ws.some(w => w.conflict)) return { cls: 'bad', text: 'Conflict' };
  if (fix('not-ours')) return { cls: 'warn', text: 'CI problem, not this change' };
  if (ws.some(w => w.ci === 'failed')) return { cls: 'bad', text: 'CI failed' };
  if (ws.some(w => w.review === 'changes')) return { cls: 'warn', text: 'Changes requested' };
  if (ws.some(w => w.found === false)) return { cls: 'ok', text: 'Create the PR' };
  if (ws.some(w => w.ci === 'running')) return { cls: 'ok', text: 'CI running' };
  if (ws.length && ws.every(w => w.review === 'approved')) return { cls: 'ok', text: 'Approved' };
  if (ws.some(w => w.checkedAt)) return { cls: 'ok', text: 'Waiting on reviewers' };
  return { cls: 'ok', text: 'Published' };
}

/** The station a card is at: 'stuck', or a station id on its line. */
export function stationOf(c) {
  const line = lineOf(c);
  const it = c && c.it;
  if (isStuck(it)) return 'stuck';
  if (line === 'code') {
    if (c.lane === 'clarify' || c.lane === 'plan') return 'plan';
    if (c.lane === 'ready') return it && shippedState(it) === 'transit' ? 'transit' : 'dock';
    if (!it) return 'build';
    // Core 4.12.0: Tandem says where the build is (step.md), when it fits the stage the item is at.
    const told = toldStep(it);
    // A Send back (connector 1.28.0): its fix tasks are built in the Fix shop, whatever step.md says.
    if (it.stage === 'build' && sentBackOf(it) && (!told || told === 'build')) return 'fix';
    if (told) return told;
    const act = activityOf(it);
    if (it.stage === 'review') {
      const a = itemAuto(it);
      if (a && a.fixRounds > 0) return 'fix';
      return UI_RE.test(act) ? 'ui' : 'review';
    }
    return TEST_RE.test(act) ? 'test' : 'build';
  }
  if (line === 'paper') {
    if (c.lane === 'clarify') return 'plan';
    if (c.lane === 'ready') return 'out';
    if (!it) return 'research';
    const f = flowOf(it);
    const step = f ? (stepsOf(f, it.lane)[stepIndex(it)] || {}).key : '';
    return PAPER_STEP[step] || 'research';
  }
  return 'other';
}
/** A quick change Tandem builds hands-off: it rides the express lane between Build and Fix. */
export function onExpress(c, station) {
  const it = c && c.it;
  return !!it && it.kind === 'item' && it.lane === 'quick' && EXPRESS.has(station) && !!itemAuto(it);
}

/** The floor: both lines' stations with their cards, the express lane, the stuck bin, other chips and the build slots. */
export function floorData(data) {
  const code = CODE.map(s => ({ ...s, cards: [] }));
  const paper = PAPER.map(s => ({ ...s, cards: [] }));
  const express = [];
  const stuck = [];
  const other = [];
  const belt = [];
  const delivered = [];
  const where = {};
  for (const c of data.cards) {
    const line = lineOf(c);
    // Merged (connector 1.28.0): off the line; today's are listed as Delivered today.
    if (line === 'code' && c.it && shippedState(c.it) === 'delivered') {
      const at = Date.parse(publishOf(c.it).published.merged);
      if (at && new Date(at).toISOString().slice(0, 10) === (S.today || new Date().toISOString().slice(0, 10))) delivered.push({ folder: c.folder, title: c.title, id: c.id || null });
      if (c.folder) where[c.folder] = 'done';
      continue;
    }
    const st = stationOf(c);
    const card = { ...c, station: st, line, quick: !!(c.it && c.it.lane === 'quick'), story: isStoryCard(c) };
    if (st === 'transit') {
      // Your turn in transit: a fix to push, or teammates asking for changes. Otherwise it waits on CI and people.
      const w = afterOf(publishOf(c.it));
      card.mine = w.fixReady || w.changes || !!w.needsYou;
      card.action = w.fixReady ? 'Push fix' : w.changes ? 'Read the comments' : w.needsYou ? 'See why' : '';
    }
    if (c.folder) where[c.folder] = st === 'stuck' ? 'stuck' : onBelt(c) ? 'belt' : st;
    if (st === 'stuck') { stuck.push(card); continue; }
    if (line === 'other') { other.push(card); continue; }
    if (line === 'code' && onBelt(c)) { belt.push(card); continue; }
    if (line === 'code' && onExpress(c, st)) { express.push(card); continue; }
    const list = line === 'code' ? code : paper;
    (list.find(s => s.id === st) || list[0]).cards.push(card);
  }
  const order = (a, b) => (b.mine - a.mine) || (b.at - a.at);
  for (const s of code.concat(paper)) s.cards.sort(order);
  const auto = (S.L && S.L.autopilot) || {};
  const slots = { running: Object.values(auto).filter(a => a && a.status === 'running').length, queued: Object.values(auto).filter(a => a && a.status === 'queued').length };
  const name = st => (CODE.find(x => x.id === st) || PAPER.find(x => x.id === st) || { name: st === 'belt' ? 'On the belt' : st === 'stuck' ? 'Pulled off' : 'Done' }).name;
  // Epics building hands-off (connector 1.23.0 `epics`), each story with where it is on the floor.
  const epics = ((S.D && S.D.epics) || []).filter(e => e && e.total).map(e => ({ ...e,
    stories: (e.stories || []).map(x => { const at = where[x.folder] || (x.stage === 'ship' ? 'dock' : 'done'); return { ...x, at, atName: name(at) }; }) }));
  const onboarding = ((S.D && S.D.onboarding) || []).filter(Boolean);
  return { code, paper, express: express.sort(order), stuck: stuck.sort(order), other: other.sort(order), belt: belt.sort((a, b) => String(a.it.story.story).localeCompare(String(b.it.story.story))), epics, onboarding, slots, delivered, mine: data.counts.mine || 0 };
}

// ------------------------------------------------------------------ drawing
const TYPE = c => (c.it && c.it.story) ? 'Story ' + (c.it.story.story || '') : (c.it && c.it.trial) ? 'Trial' : (c.it && c.it.coverage) ? 'Tests' : c.quick ? 'Quick' : c.kind === 'build' ? (c.it && c.it.lane === 'bug' ? 'Bug' : 'Feature') : KINDS[c.kind] ? KINDS[c.kind].name : 'Run';
/** The card's project color (Loom 6.6.0), once you have projects: the same swatch as the project filter. */
function projSw(c) {
  if (!c.it || !hasProjects()) return '';
  const p = projectById(projectOf(c.it));
  return p && !p.builtIn ? `<span class="fl-proj" title="${h(projectName(p))}">${sw(p.color)}</span>` : '';
}
/** The card's regression suite result (Loom 6.8.0, eng-agents Core 4.14.0): failing, flaky, or the tests it added. */
export function testsBadge(it) {
  const t = it && it.tests;
  if (!t || t.verdict === 'skipped') return null;
  if (t.verdict === 'fail') return { cls: 'bad', text: t.failed === 1 ? '1 test failing' : `${t.failed} tests failing` };
  if (t.flaky) return { cls: 'warn', text: `${t.flaky} flaky` };
  if (t.newTests) return { cls: 'ok', text: `+${t.newTests} test${t.newTests === 1 ? '' : 's'}` };
  return { cls: 'ok', text: 'Tests pass' };
}
/** How a card moves on the floor (Loom 6.12.0): 'run' (Tandem is working: it bobs on the moving belt), 'gate' (it waits
    on you: it bumps against a striped gate), 'stuck' (pulled off: tilted, still) or 'idle' (queued or waiting on CI and
    people: still). The belt under a line only runs while one of its cards is 'run'. */
export function motionOf(c) {
  if (!c) return 'idle';
  if (c.station === 'stuck' || isStuck(c.it)) return 'stuck';
  if (c.mine) return 'gate';
  if (c.it) {
    const a = itemAuto(c.it);
    if (a && a.status === 'running') return 'run';
    if (isBusy(itemSession(c.it))) return 'run';
    if (c.station === 'transit') return /running|fixing|merging/i.test(transitBadge(c.it).text) ? 'run' : 'idle';
    return 'idle';
  }
  if (c.session) return isBusy(S.L && S.L.sessions && S.L.sessions[c.session]) ? 'run' : 'idle';
  return 'idle';
}
const GEAR = '<svg class="fl-gear" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M10.6 2h2.8l.5 2.6 1.6.7 2.2-1.5 2 2-1.5 2.2.7 1.6 2.6.5v2.8l-2.6.5-.7 1.6 1.5 2.2-2 2-2.2-1.5-1.6.7-.5 2.6h-2.8l-.5-2.6-1.6-.7-2.2 1.5-2-2 1.5-2.2-.7-1.6L2 13.4v-2.8l2.6-.5.7-1.6-1.5-2.2 2-2 2.2 1.5 1.6-.7zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/></svg>';
const MOTION_WORD = { run: 'Working', gate: 'Waiting at the gate for you', stuck: 'Pulled off the line', idle: 'Waiting' };
function chipHtml(c, sel) {
  const key = keyOf(c);
  const on = sel && sel === key;
  const tb = c.station === 'transit' ? transitBadge(c.it) : testsBadge(c.it);
  const sb = sentBackOf(c.it);
  const label = `${TYPE(c)}: ${c.title}. ${c.status}${tb ? '. ' + tb.text : ''}${sb ? `. Your comments: ${sb}` : ''}${c.mine ? '. Your turn: ' + c.action : ''}`;
  const m = motionOf(c);
  return `<button type="button" class="fl-card k-${h(c.kind)}${c.it && c.it.story ? ' story' : ''}${c.mine ? ' mine' : ''}${on ? ' on' : ''} m-${m}" data-lane-open="${h(key)}" aria-pressed="${!!on}" aria-label="${h(label)}" title="${h(c.title + ' · ' + c.status)}">` +
    `<span class="fl-ctop">${projSw(c)}<span class="fl-id">${m === 'run' ? GEAR : ''}${c.id ? '#' + h(c.id) : h(TYPE(c))}</span>${c.id ? `<span class="fl-type">${h(TYPE(c))}</span>` : ''}</span>` +
    `<span class="fl-title">${h(c.title)}</span>${tb ? `<span class="fl-tst ${tb.cls}" aria-hidden="true">${h(tb.text)}</span>` : ''}${sb ? `<span class="fl-tst sb" aria-hidden="true">Your comments: ${h(String(sb))}</span>` : ''}${c.mine && c.action ? `<span class="fl-act">${h(c.action)}</span>` : ''}${m === 'run' ? '<span class="fl-prog" aria-hidden="true"></span>' : ''}${m === 'gate' ? '<span class="fl-gatebar" aria-hidden="true"></span>' : ''}</button>`;
}
function stackHtml(line, s, sel) {
  const key = line + ':' + s.id;
  const open = !!(S.ui.floorOpen && S.ui.floorOpen[key]);
  const shown = open ? s.cards : s.cards.slice(0, STACK_MAX);
  const more = s.cards.length - shown.length;
  const toggle = s.cards.length > STACK_MAX ? `<button type="button" class="fl-more" data-floor-more="${h(key)}" aria-expanded="${open}">${open ? 'Show fewer' : '+' + more + ' more'}</button>` : '';
  return `<div class="fl-stack">${toggle}${shown.slice().reverse().map(c => chipHtml(c, sel)).join('')}</div>`;
}
function plateHtml(s, extra) {
  const busy = s.id === 'build' && extra && extra.queued > 0;
  const ms = s.cards.map(motionOf);
  const cls = (s.you ? ' you' : busy ? ' busy' : '') + (ms.includes('run') ? ' whirr' : '') + (ms.includes('gate') ? ' gated' : '');
  const sub = extra && s.id === 'build' && (extra.running || extra.queued) ? `${extra.running} building${extra.queued ? `, ${extra.queued} queued` : ''}` : s.desc;
  return `<div class="fl-plate${cls}">${ms.includes('gate') ? '<span class="fl-arm" aria-hidden="true"></span>' : ''}<span class="fl-name">${ms.includes('run') ? GEAR : ''}${h(s.name)}</span><span class="fl-sub">${h(sub)}</span><span class="fl-n" aria-label="${h(plural(s.cards.length, 'item'))}">${s.cards.length}</span></div>`;
}
function stationHtml(line, s, sel, extra) {
  return `<section class="fl-station st-${h(s.id)}" aria-label="${h(s.name + ': ' + plural(s.cards.length, 'item'))}">${stackHtml(line, s, sel)}${plateHtml(s, extra)}</section>`;
}
function expressHtml(fd, sel) {
  if (!fd.express.length) return '';
  const cols = CODE.map(s => `<div class="fl-xcol">${EXPRESS.has(s.id) ? fd.express.filter(c => c.station === s.id).map(c => chipHtml(c, sel)).join('') : ''}</div>`).join('');
  return `<div class="fl-express" aria-label="Express lane: quick changes Tandem builds hands-off"><span class="fl-xlabel">Express</span><div class="fl-xbelt${fd.express.some(c => motionOf(c) === 'run') ? ' moving' : ''}">${cols}</div></div>`;
}
/** The builds at the Loading dock (Publish all ready counts the ones with nothing to answer). */
const readyItems = fd => (fd.code.find(s => s.id === 'dock') || { cards: [] }).cards.map(c => c.it).filter(Boolean);
/** The runs finished today, under the code line (the Ready lane's "done today" before 6.7.0). Each opens its run. */
function shippedHtml(done, delivered = []) {
  if ((!done || !done.length) && !delivered.length) return '';
  const row = d => `<li><button type="button" class="lnk plain" data-open-run="${h(d.folder)}">${d.id ? '#' + h(d.id) + ' ' : ''}${h(d.title)}</button></li>`;
  const open = !!S.ui.laneDone;
  const openD = !!S.ui.laneDelivered;
  const a = done && done.length ? `<button type="button" class="lnk plain ln-done" data-lane-done="1" aria-expanded="${open}">Shipped today: ${done.length}</button>${open ? `<ul class="ln-donelist" role="list">${done.map(row).join('')}</ul>` : ''}` : '';
  // Connector 1.28.0: PRs that merged today. Off the line; each still opens its run.
  const b = delivered.length ? `<button type="button" class="lnk plain ln-done" data-lane-delivered="1" aria-expanded="${openD}">Delivered today: ${delivered.length}</button>${openD ? `<ul class="ln-donelist" role="list">${delivered.map(row).join('')}</ul>` : ''}` : '';
  return `<div class="fl-shipped">${a}${b}</div>`;
}
function lineHtml(id, title, sub, stations, sel, extra, before, ready) {
  const n = stations.reduce((t, s) => t + s.cards.length, 0);
  const moving = stations.some(s => s.cards.some(c => motionOf(c) === 'run'));
  const pubAll = ready ? publishAllHtml(ready) : '';
  return `<section class="fl-line fl-${id}" aria-label="${h(title)}"><header class="fl-lh"><h2>${h(title)}</h2><span class="fl-ls">${h(sub)}</span><span class="fl-ln">${h(plural(n, 'item'))}</span>${pubAll}</header>` +
    (before || '') + `<div class="fl-stations" style="--n:${stations.length}">${stations.map(s => stationHtml(id, s, sel, extra)).join('')}</div><div class="fl-belt${moving ? ' moving' : ''}" aria-hidden="true"><i class="fl-roll"></i><i class="fl-roll"></i></div></section>`;
}
const STEP_WORD = { done: 'done', now: 'now', next: 'next' };
/** New lines: products being onboarded, their five steps lit (Core 4.10.0 /onboard-product). */
function newLinesHtml(fd, sel) {
  if (!fd.onboarding.length || (S.view && S.view.hideSetup)) return '';
  const row = o => {
    const steps = o.steps.map(x => `<li class="fl-step ${h(x.st)}" aria-label="${h(x.name + ': ' + STEP_WORD[x.st])}"><span class="fl-dot" aria-hidden="true"></span>${h(x.name)}</li>`).join('');
    const gaps = o.gaps ? `<button type="button" class="lnk plain" data-lane-filter="teach">${h(plural(o.gaps, 'gap'))} to answer</button>` : '';
    const trial = o.trial ? (o.trial.folder ? `<button type="button" class="lnk plain${sel === o.trial.folder ? ' on' : ''}" data-lane-open="${h(o.trial.folder)}">Trial run ${h(o.trial.id)}</button>` : `<span class="dim">Trial run ${h(o.trial.id)}</span>`) : '';
    const done = o.live ? `<span class="fl-live">Live</span><button type="button" class="lnk plain" data-onboard-dismiss="${h(o.product)}">Hide</button>` : '';
    return `<li class="fl-nl"><span class="fl-nlname">${h(o.product)}</span><ol class="fl-steps" role="list">${steps}</ol><span class="fl-nlx">${gaps}${trial}${done}</span></li>`;
  };
  return `<section class="fl-new" aria-label="New lines: products being onboarded"><div class="ghide-row"><h2>New lines</h2><button type="button" class="lnk plain" data-setup-hide="1" title="Hide setup and onboarding. Settings, Show tips again brings them back.">Hide</button></div><ul class="fl-nls" role="list">${fd.onboarding.map(row).join('')}</ul></section>`;
}
/** The hand-off belt (stories waiting to start) and a tracker card per epic building hands-off. */
function handoffHtml(fd, sel) {
  if (!fd.belt.length && !fd.epics.length) return '';
  const belt = fd.belt.length ? `<div class="fl-handbelt" aria-label="Hand-off belt: stories from approved breakdowns, waiting to start"><span class="fl-hlabel">Hand-off belt</span><div class="fl-row">${fd.belt.map(c => chipHtml(c, sel)).join('')}</div></div>` : '';
  const epic = e => {
    const segs = e.stories.map(x => `<i class="fl-seg at-${h(x.at)}" title="${h((x.story ? x.story + ' ' : '') + x.title + ': ' + x.atName)}"></i>`).join('');
    const rows = e.stories.map(x => `<li><button type="button" class="fl-srow${sel === x.folder ? ' on' : ''}" data-lane-open="${h(x.folder)}"><span class="fl-sid">${h(x.story || x.id)}</span><span class="fl-stitle">${h(x.title)}</span><span class="fl-sat at-${h(x.at)}">${h(x.atName)}</span></button></li>`).join('');
    return `<article class="fl-epic" aria-label="${h('Epic ' + e.title)}"><header><span class="fl-ekind">Epic</span><h3>${h(e.title)}</h3><span class="fl-eready">${h(e.ready + ' of ' + e.total)} ready</span></header>` +
      `<div class="fl-segs" aria-hidden="true">${segs}</div><ul class="fl-srows" role="list">${rows}</ul></article>`;
  };
  return `<section class="fl-handoff" aria-label="Epics handing off to builds">${belt}${fd.epics.length ? `<div class="fl-epics">${fd.epics.map(epic).join('')}</div>` : ''}</section>`;
}

/** Where a card is on the floor, for the popup's stamp: its station's name and how it moves. */
function whereOf(fd, key) {
  for (const [line, list] of [['code', fd.code], ['paper', fd.paper]]) for (const st of list) {
    const c = st.cards.find(x => keyOf(x) === key);
    if (c) return { name: (line === 'code' ? 'Code line, ' : 'Research line, ') + st.name, m: motionOf(c), kind: c.kind, story: !!c.story };
  }
  const pools = [['express', 'Express lane'], ['belt', 'Hand-off belt'], ['stuck', 'Pulled off the line'], ['other', 'On the floor']];
  for (const [k, name] of pools) { const c = fd[k].find(x => keyOf(x) === key); if (c) return { name, m: motionOf(c), kind: c.kind, story: !!c.story }; }
  return null;
}
/** The open card's details as a popup that grows out of the card (Loom 6.12.0; was a side panel). floor-motion.js
    places it beside the card after each paint; a click outside it, its X or Escape closes it. */
function popHtml(fd, sel, panel) {
  if (!panel) return '';
  const w = whereOf(fd, sel);
  const stamp = w ? `<p class="fl-stamp m-${w.m}"><span class="fl-sdot" aria-hidden="true"></span>${h(w.name)}<span class="fl-sword">${h(MOTION_WORD[w.m])}</span></p>` : '';
  return `<div class="fl-pop k-${h((w && w.kind) || 'other')}${w && w.story ? ' story' : ''}" role="dialog" aria-label="Details" data-pop-for="${h(sel)}"><span class="fl-tail" aria-hidden="true"></span><div class="fl-pin">${stamp}${panel}</div></div>`;
}
/** The floor: the two lines (and the hand-off belt between them) are the stage, the page's focal point; everything else
    sits under it, and the open card pops out of its box. */
export function floorHtml(data, sel, panel) {
  const fd = floorData(data);
  const code = lineHtml('code', 'Code line', 'Feature, bug and quick change. Ends in a PR.', fd.code, sel, fd.slots, expressHtml(fd, sel), readyItems(fd));
  const paper = lineHtml('paper', 'Research line', 'Investigate, error log, docs and epics. Ends in a brief or a breakdown.', fd.paper, sel, null, '');
  const stuck = fd.stuck.length ? `<section class="fl-stuck" aria-label="Pulled off the line"><h2>Pulled off the line</h2><div class="fl-row">${fd.stuck.map(c => chipHtml(c, sel)).join('')}</div></section>` : '';
  const other = fd.other.length ? `<section class="fl-other" aria-label="Also waiting"><h2>Also on the floor</h2><div class="fl-row">${fd.other.map(c => chipHtml(c, sel)).join('')}</div></section>` : '';
  return `<div class="ln-body fl-body"><div class="fl-floor"><div class="fl-stage">${code}${handoffHtml(fd, sel)}${paper}</div>${shippedHtml(data.doneList, fd.delivered)}${stuck}${other}${newLinesHtml(fd, sel)}</div>${popHtml(fd, sel, panel)}</div>`;
}

/** In an epic's panel (Core 4.10.0): once its breakdown is approved, build its stories here, hands-off, in order. */
export function epicPanelHtml(it) {
  const f = it && flowOf(it);
  if (!f || f.id !== 'epic') return '';
  const e = ((S.D && S.D.epics) || []).find(x => x && x.folder === it.folder);
  const busy = S.ui.busy && S.ui.busy['epic:' + it.folder];
  if (e && e.asked) {
    const line = e.total ? `${e.ready} of ${e.total} stories ready to publish. Each one builds on its own, after the story it depends on.` : 'Tandem is making a local item for each story. They start building as soon as they exist.';
    return `<div class="ln-epic"><p class="sub-h">Building the stories here</p><p>${h(line)}</p><p class="dim">A story's plan waits for you only if it drifts from the breakdown. Every PR waits for you at Publish.</p></div>`;
  }
  if (stepIndex(it) < 4) return '';
  return `<div class="ln-epic"><p class="sub-h">Approving the breakdown is enough</p><p>Tandem makes a local item for each story and builds them in order, hands-off. A story's plan waits for you only if it drifts from the breakdown (more files, a new dependency, a migration, auth code, or areas it did not name). Every PR still waits for you at Publish.</p>` +
    `<div class="row"><button type="button" class="btn primary" data-epic-build="${h(it.folder)}"${busy ? ' disabled' : ''}>${busy ? 'Starting…' : 'Build the stories here'}</button></div></div>`;
}

// ------------------------------------------------------------------ List (rows, Loom 6.6.0)
/** The List view: one row per card, grouped Needs you, Running and Also waiting, each with its line's station track. */
export function rowsData(data) {
  const fd = floorData(data);
  const at = {};
  for (const [line, list] of [['code', fd.code], ['paper', fd.paper]]) for (const s of list) for (const c of s.cards) at[keyOf(c)] = { line, st: s.id };
  for (const c of fd.express) at[keyOf(c)] = { line: 'code', st: c.station };
  for (const c of fd.belt) at[keyOf(c)] = { line: 'code', st: 'belt' };
  for (const c of fd.stuck) at[keyOf(c)] = { line: lineOf(c), st: 'stuck', was: c.it ? stationOf({ ...c, it: { ...c.it, blocked: null, paused: false } }) : '' };
  const rows = data.cards.map(c => {
    const a = at[keyOf(c)] || { line: 'other', st: '' };
    const stations = a.line === 'code' ? CODE : a.line === 'paper' ? PAPER : [];
    const cur = a.st === 'belt' ? -1 : stations.findIndex(s => s.id === (a.st === 'stuck' ? a.was : a.st));
    const track = stations.map((s, i) => ({ id: s.id, name: s.name, st: a.st === 'stuck' && i === cur ? 'stuck' : i < cur ? 'done' : i === cur ? 'now' : 'next' }));
    const since = c.it && c.it.step && c.it.step.at ? Date.parse(c.it.step.at) : c.it && c.it.modifiedMs ? c.it.modifiedMs : 0;
    const where = a.st === 'belt' ? 'On the hand-off belt' : a.st === 'stuck' ? 'Pulled off the line' : cur >= 0 ? stations[cur].name : '';
    return { c, line: a.line, track, where, since };
  });
  const order = (x, y) => (y.c.at - x.c.at);
  return [
    { id: 'mine', name: 'Needs you', rows: rows.filter(r => r.c.mine).sort(order) },
    { id: 'running', name: 'Running', rows: rows.filter(r => !r.c.mine && r.line !== 'other').sort(order) },
    { id: 'other', name: 'Also waiting', rows: rows.filter(r => !r.c.mine && r.line === 'other').sort(order) }
  ].filter(g => g.rows.length);
}
function rowHtml(r, sel) {
  const c = r.c;
  const key = keyOf(c);
  const on = sel && sel === key;
  const track = r.track.length ? `<span class="fl-track" aria-hidden="true">${r.track.map(t => `<span class="fl-tk ${h(t.st)}" title="${h(t.name)}"></span>`).join('')}</span>` : '<span class="fl-track"></span>';
  const label = `${TYPE(c)}: ${c.title}. ${r.where || c.status}${c.mine ? '. Your turn: ' + c.action : ''}`;
  return `<li><button type="button" class="fl-rowb${c.it && c.it.story ? ' story' : ''}${c.mine ? ' mine' : ''}${on ? ' on' : ''}" data-lane-open="${h(key)}" data-lane="${h(c.lane)}" aria-pressed="${!!on}" aria-label="${h(label)}">` +
    `<span class="fl-rid">${projSw(c)}${c.id ? '#' + h(c.id) : ''}</span><span class="fl-rtitle"><span class="fl-type">${h(TYPE(c))}</span> ${h(c.title)}</span>${track}` +
    `<span class="fl-rwhere">${h(r.where || c.status)}</span><span class="fl-rtime">${r.since ? h(ago(r.since)) : ''}</span>` +
    (c.mine && c.action ? `<span class="fl-act">${h(c.action)}</span>` : '<span></span>') + '</button></li>';
}
/** The List view, with the open card's panel beside it. */
export function rowsHtml(data, sel, panel) {
  const groups = rowsData(data);
  const ready = data.cards.filter(c => c.lane === 'ready' && c.it).map(c => c.it);
  let body = groups.length ? groups.map(g => `<section class="fl-rgroup" aria-label="${h(g.name)}"><h2>${h(g.name)} <span class="fl-ln">${g.rows.length}</span>${g.id === 'mine' ? publishAllHtml(ready) : ''}</h2><ul class="fl-rows" role="list">${g.rows.map(r => rowHtml(r, sel)).join('')}</ul></section>`).join('')
    : '<p class="ln-empty">Nothing running. Drop something in above.</p>';
  // Done today (6.7.0): the runs finished today, each opening its run.
  const done = data.doneList || [];
  if (done.length) body += `<section class="fl-rgroup" aria-label="Done today"><h2>Done today <span class="fl-ln">${done.length}</span></h2><ul class="fl-rows ln-donelist" role="list">${done.map(d => `<li><button type="button" class="fl-rowb fl-done" data-open-run="${h(d.folder)}"><span class="fl-rid">${d.id ? '#' + h(d.id) : ''}</span><span class="fl-rtitle">${h(d.title)}</span></button></li>`).join('')}</ul></section>`;
  return `<div class="ln-body fl-body${panel ? ' has-panel' : ''}"><div class="fl-list">${body}</div>${panel || ''}</div>`;
}

/** The picker's explanation sits behind a quiet ? (shared hints: retires after a few opens, Settings brings it back). */
function pickHint(id, text) {
  const T = typeof window !== 'undefined' && window.WorkshopTheme;
  return T && T.hints ? T.hints.html(id, text) : '';
}

// ------------------------------------------------------------------ Add regression tests (Loom 6.8.0)
/** The Add regression tests picker under the drop box: a product (from Settings, with repos) and an optional area.
    A pick runs the connector's tests.cover (Tandem's /cover): one hands-off Quick change per UI repo, cards marked Tests. */
export function coverPickHtml() {
  if (!S.ui.coverPick) return '';
  const list = (S.products || []).filter(p => p && !p.archived && (p.repos || []).length);
  const busy = S.ui.busy && S.ui.busy.cover;
  const rows = list.length ? `<ul role="list">${list.map(p => `<li><button type="button" class="ln-prow" data-cover-go="${h(p.name)}"${busy ? ' disabled' : ''}><span class="ln-ptitle">${h(p.name)}</span><span class="ln-ptype">${h(plural(p.repos.length, 'repo'))}</span></button></li>`).join('')}</ul>`
    : '<p class="dim">No products with repos yet.</p>';
  return `<div class="ln-pick ln-cover"><p class="ln-dl">Pick a product${pickHint('loom.cover', 'Tandem writes mocked end-to-end tests, one hands-off PR per UI repo. Products go in Settings, Products.')}</p>` +
    `<label class="ln-dl" for="ln-cover-area">Area or pages (optional)</label><input type="text" id="ln-cover-area" data-draft="lanes:cover" maxlength="200" placeholder="Leave empty for the main pages" value="${h((S.ui.drafts && S.ui.drafts['lanes:cover']) || '')}">${rows}</div>`;
}

// ------------------------------------------------------------------ Onboard a product (Loom 6.6.0)
/** Products from Settings (main.js reads them) that are not being onboarded yet. */
export function onboardable() {
  const doing = new Set(((S.D && S.D.onboarding) || []).map(o => String(o.product || '').toLowerCase()));
  return (S.products || []).filter(p => p && !p.archived && (p.repos || []).length && !doing.has(String(p.name || '').toLowerCase()));
}
/** The Onboard a product picker under the drop box (opened from its link). */
export function onboardPickHtml() {
  if (!S.ui.onboardPick) return '';
  const list = onboardable();
  const busy = S.ui.busy && S.ui.busy.onboard;
  const rows = list.length ? `<ul role="list">${list.map(p => `<li><button type="button" class="ln-prow" data-onboard-go="${h(p.name)}"${busy ? ' disabled' : ''}><span class="ln-ptitle">${h(p.name)}</span><span class="ln-ptype">${h(plural(p.repos.length, 'repo'))}</span></button></li>`).join('')}</ul>`
    : '<p class="dim">All onboarded.</p>';
  return `<div class="ln-pick ln-onboard"><p class="ln-dl">Pick a product${pickHint('loom.onboard', 'Tandem fills gaps and starts a trial run. New products go in Settings, Products.')}</p>${rows}</div>`;
}
