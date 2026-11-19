/* Loom floor (Loom 6.4.0; plan: claude/loom-floor-v1-plan.md in the Workshop project). The same cards as the lanes
   (lanes.js lanesData), drawn as a workshop floor: stations in a line, with each card stacked over the station it is
   at, so a busy station is visibly taller. Two lines:
   - Code line (Build: feature, bug, quick change): Plan desk, Build bay, Test bench, UI check, Review, Fix shop,
     Loading dock. Quick changes Tandem is building hands-off ride the express lane above it.
   - Paper line (Ask, Diagnose, Docs, Epic): Plan desk, Research, Write, Review, Out tray. It ends in a brief or a
     breakdown, never a PR, and its runs never take a build slot.
   Stopped cards leave the line for the "Pulled off the line" bin. Everything else (requests, hand-offs, teammates'
   PRs, other sessions) is a chip under the lines. A card's station follows from its lane, stage, autopilot step and
   what its session says it is doing; nothing is stored. Clicking a card opens the same panel as the lanes
   (data-lane-open), so every button is the one the lanes already use. No DOM: main.js paints what this returns.

   Loom 6.5.0 (eng-agents Core 4.10.0, opencode connector 1.23.0): stories from an approved breakdown wear the brand
   color and ride the hand-off belt until they start; each epic building hands-off has a tracker card (its stories
   and where each one is). Products being onboarded show as new lines at the top, their five steps lit (Add, Scan,
   Fill the gaps, Trial run, Live). */
import { S } from './state.js';
import { h, plural, itemSession, isBusy, itemAuto } from './view.js';
import { flowOf, stepIndex, stepsOf } from './flows.js';
import { KINDS, keyOf } from './lanes.js';

export const CODE = [
  { id: 'plan', name: 'Plan desk', you: true, desc: 'Plans to approve' },
  { id: 'build', name: 'Build bay', desc: 'Building' },
  { id: 'test', name: 'Test bench', desc: 'Running tests' },
  { id: 'ui', name: 'UI check', desc: 'Screenshots' },
  { id: 'review', name: 'Review', desc: 'Checking the work' },
  { id: 'fix', name: 'Fix shop', desc: 'Fixing what review found' },
  { id: 'dock', name: 'Loading dock', you: true, desc: 'Ready to publish' }
];
export const PAPER = [
  { id: 'plan', name: 'Plan desk', you: true, desc: 'Starting up' },
  { id: 'research', name: 'Research', desc: 'Reading the code' },
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
/** The paper station for a flow step's key. */
const PAPER_STEP = { investigate: 'research', scope: 'research', slice: 'write', draft: 'write', stories: 'review', milestones: 'review', read: 'review', check: 'review', final: 'review', findings: 'out', backlog: 'out', save: 'out' };

/** The station a card is at: 'stuck', or a station id on its line. */
export function stationOf(c) {
  const line = lineOf(c);
  const it = c && c.it;
  if (isStuck(it)) return 'stuck';
  if (line === 'code') {
    if (c.lane === 'clarify' || c.lane === 'plan') return 'plan';
    if (c.lane === 'ready') return 'dock';
    if (!it) return 'build';
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
  const where = {};
  for (const c of data.cards) {
    const line = lineOf(c);
    const st = stationOf(c);
    const card = { ...c, station: st, line, quick: !!(c.it && c.it.lane === 'quick'), story: isStoryCard(c) };
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
  return { code, paper, express: express.sort(order), stuck: stuck.sort(order), other: other.sort(order), belt: belt.sort((a, b) => String(a.it.story.story).localeCompare(String(b.it.story.story))), epics, onboarding, slots, mine: data.counts.mine || 0 };
}

// ------------------------------------------------------------------ drawing
const TYPE = c => (c.it && c.it.story) ? 'Story ' + (c.it.story.story || '') : (c.it && c.it.trial) ? 'Trial' : c.quick ? 'Quick' : c.kind === 'build' ? (c.it && c.it.lane === 'bug' ? 'Bug' : 'Feature') : KINDS[c.kind] ? KINDS[c.kind].name : 'Run';
function chipHtml(c, sel) {
  const key = keyOf(c);
  const on = sel && sel === key;
  const label = `${TYPE(c)}: ${c.title}. ${c.status}${c.mine ? '. Your turn: ' + c.action : ''}`;
  return `<button type="button" class="fl-card k-${h(c.kind)}${c.it && c.it.story ? ' story' : ''}${c.mine ? ' mine' : ''}${on ? ' on' : ''}" data-lane-open="${h(key)}" aria-pressed="${!!on}" aria-label="${h(label)}" title="${h(c.title + ' · ' + c.status)}">` +
    `<span class="fl-ctop"><span class="fl-id">${c.id ? '#' + h(c.id) : h(TYPE(c))}</span>${c.id ? `<span class="fl-type">${h(TYPE(c))}</span>` : ''}</span>` +
    `<span class="fl-title">${h(c.title)}</span>${c.mine && c.action ? `<span class="fl-act">${h(c.action)}</span>` : ''}</button>`;
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
  const cls = s.you ? ' you' : busy ? ' busy' : '';
  const sub = extra && s.id === 'build' && (extra.running || extra.queued) ? `${extra.running} building${extra.queued ? `, ${extra.queued} queued` : ''}` : s.desc;
  return `<div class="fl-plate${cls}"><span class="fl-name">${h(s.name)}</span><span class="fl-sub">${h(sub)}</span><span class="fl-n" aria-label="${h(plural(s.cards.length, 'item'))}">${s.cards.length}</span></div>`;
}
function stationHtml(line, s, sel, extra) {
  return `<section class="fl-station st-${h(s.id)}" aria-label="${h(s.name + ': ' + plural(s.cards.length, 'item'))}">${stackHtml(line, s, sel)}${plateHtml(s, extra)}</section>`;
}
function expressHtml(fd, sel) {
  if (!fd.express.length) return '';
  const cols = CODE.map(s => `<div class="fl-xcol">${EXPRESS.has(s.id) ? fd.express.filter(c => c.station === s.id).map(c => chipHtml(c, sel)).join('') : ''}</div>`).join('');
  return `<div class="fl-express" aria-label="Express lane: quick changes Tandem builds hands-off"><span class="fl-xlabel">Express</span><div class="fl-xbelt">${cols}</div></div>`;
}
function lineHtml(id, title, sub, stations, sel, extra, before) {
  const n = stations.reduce((t, s) => t + s.cards.length, 0);
  return `<section class="fl-line fl-${id}" aria-label="${h(title)}"><header class="fl-lh"><h2>${h(title)}</h2><span class="fl-ls">${h(sub)}</span><span class="fl-ln">${h(plural(n, 'item'))}</span></header>` +
    (before || '') + `<div class="fl-stations" style="--n:${stations.length}">${stations.map(s => stationHtml(id, s, sel, extra)).join('')}</div><div class="fl-belt" aria-hidden="true"></div></section>`;
}
const STEP_WORD = { done: 'done', now: 'now', next: 'next' };
/** New lines: products being onboarded, their five steps lit (Core 4.10.0 /onboard-product). */
function newLinesHtml(fd, sel) {
  if (!fd.onboarding.length) return '';
  const row = o => {
    const steps = o.steps.map(x => `<li class="fl-step ${h(x.st)}" aria-label="${h(x.name + ': ' + STEP_WORD[x.st])}"><span class="fl-dot" aria-hidden="true"></span>${h(x.name)}</li>`).join('');
    const gaps = o.gaps ? `<button type="button" class="lnk plain" data-lane-filter="teach">${h(plural(o.gaps, 'gap'))} to answer</button>` : '';
    const trial = o.trial ? (o.trial.folder ? `<button type="button" class="lnk plain${sel === o.trial.folder ? ' on' : ''}" data-lane-open="${h(o.trial.folder)}">Trial run ${h(o.trial.id)}</button>` : `<span class="dim">Trial run ${h(o.trial.id)}</span>`) : '';
    const done = o.live ? `<span class="fl-live">Live</span><button type="button" class="lnk plain" data-onboard-dismiss="${h(o.product)}">Hide</button>` : '';
    return `<li class="fl-nl"><span class="fl-nlname">${h(o.product)}</span><ol class="fl-steps" role="list">${steps}</ol><span class="fl-nlx">${gaps}${trial}${done}</span></li>`;
  };
  return `<section class="fl-new" aria-label="New lines: products being onboarded"><h2>New lines</h2><ul class="fl-nls" role="list">${fd.onboarding.map(row).join('')}</ul></section>`;
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

/** The floor, with the open card's panel beside it (the lanes' own panel, passed in). */
export function floorHtml(data, sel, panel) {
  const fd = floorData(data);
  const paperN = fd.paper.reduce((t, s) => t + s.cards.length, 0);
  const code = lineHtml('code', 'Code line', 'Feature, bug and quick change. Ends in a PR.', fd.code, sel, fd.slots, expressHtml(fd, sel));
  const paper = paperN || S.ui.floorPaper ? lineHtml('paper', 'Paper line', 'Investigate, error log, docs and epics. Ends in a brief or a breakdown.', fd.paper, sel, null, '')
    : `<p class="fl-fold">Paper line: nothing running. <button type="button" class="lnk plain" data-floor-paper="1">Show it</button></p>`;
  const stuck = fd.stuck.length ? `<section class="fl-stuck" aria-label="Pulled off the line"><h2>Pulled off the line</h2><div class="fl-row">${fd.stuck.map(c => chipHtml(c, sel)).join('')}</div></section>` : '';
  const other = fd.other.length ? `<section class="fl-other" aria-label="Also waiting"><h2>Also on the floor</h2><div class="fl-row">${fd.other.map(c => chipHtml(c, sel)).join('')}</div></section>` : '';
  return `<div class="ln-body fl-body${panel ? ' has-panel' : ''}"><div class="fl-floor">${newLinesHtml(fd, sel)}${code}${stuck}${handoffHtml(fd, sel)}${paper}${other}</div>${panel || ''}</div>`;
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
