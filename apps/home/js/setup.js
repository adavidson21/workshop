/* Home: the Get started checklist. Each step ticks itself off from what Workshop can see (connected to
   Workshop on this computer, your name, the ADO connector, a Docket task, a receipt),
   so it works as an interactive guide for someone new. Any step can be skipped. Hiding the checklist and
   skipped steps are saved in Home's own collection `setup` (home.setup v1, no items; meta: {hidden,
   skipped: [step ids], machine ('work' | 'personal', the Connect step's choice), appsPicked, folded (you folded
   the card to one line), updatedAt}); everything else is read live, read-only.

   factsFor() reads, stepsFor() decides (pure), card() builds the HTML (pure), createSetup() loads and
   saves. main.js puts the card under the greeting and repaints it when anything changes. */
import { esc } from './view.js';
import { SITE } from '../../../shared/site.js';
import { readCards } from '../../../shared/summary.js';

export const SETUP_VERSION = 1;

/* ------------------------------------------------------------------------------------------- reading */

/** Plain-words state of the ADO connector for the checklist. */
export function adoFact(info, config) {
  if (!info) return { state: 'missing' };
  if (!info.enabled || info.status.state === 'disabled') return { state: 'off' };
  const s = info.status;
  const d = s.details || {};
  const conns = config && Array.isArray(config.config?.connections) ? config.config.connections : null;
  if (conns && !conns.length) return { state: 'noConnection' };
  if (Array.isArray(d.patsMissing) && d.patsMissing.length) return { state: 'noPat', patEnv: d.patsMissing[0] };
  if (s.state === 'ready') {
    const noExpiry = !!conns && conns.some(c => !c.patExpires);
    return { state: 'ready', message: s.message || '', noExpiry, patEnv: conns && conns[0] && conns[0].patEnv || 'ADO_PAT' };
  }
  if (s.state === 'error' && /add an ado connection/i.test(s.message || '')) return { state: 'noConnection' };
  return { state: 'error', message: s.message || 'The ADO connector is not ready yet.' };
}


/** Your own person in the people directory (relation You): its name, or '' when there is none. */
export const selfName = dir => {
  const me = dir && Array.isArray(dir.people) ? dir.people.find(p => !p.archived && p.relation === 'self') : null;
  return me ? String(me.name || '').trim() : '';
};

/** Active reports and manager in the people directory (ws.people, docs/people.md): the people Rapport works with. */
export const teamCount = dir => (dir && Array.isArray(dir.people) ? dir.people.filter(p => !p.archived && (p.relation === 'report' || p.relation === 'manager')).length : 0);

/** Receipts logged, from Rapport's summary (docs/summaries.md, the `entries` count card). 0 when it has none. */
export function receiptsCount(summaryEnv) {
  const cards = readCards(summaryEnv, 'receipts');
  const c = cards && cards.get('entries');
  return c && c.kind === 'count' && Number.isInteger(c.count) ? c.count : 0;
}

/** How many area paths your team has in Settings (docs/teams.md); 0 when none or unreadable. */
export function areaCount(env) {
  const t = env && Array.isArray(env.items) ? env.items.find(x => x && x.id === 't_mine') : null;
  return t && Array.isArray(t.areas) ? t.areas.filter(a => typeof a === 'string' && a.trim()).length : 0;
}

/** Whether a data folder is inside OneDrive (any OneDrive: "OneDrive - Company" on Windows, OneDrive-Company on a Mac). */
export const onOneDrive = dir => /[\\/]OneDrive([ -][^\\/]*)?([\\/]|$)/i.test(String(dir || ''));

/**
 * Everything the checklist needs, read through the SDK. Never throws: a fact it cannot read is null
 * ("don't know yet"), which keeps that step open rather than ticking it.
 */
export async function factsFor(ws) {
  const agent = ws.backend === 'agent';
  const quiet = p => p.catch(() => null);
  const [summary, people, list, cfg, adoCfg, teams] = await Promise.all([
    quiet(ws.data.get('summary', { app: 'receipts' })),
    quiet(ws.people.get()),
    agent ? quiet(ws.connectors.list()) : null,
    agent ? quiet(ws.config.get()) : null,
    agent ? quiet(ws.connectors.getConfig('ado')) : null,
    quiet(ws.data.get('teams', { app: 'settings' }))
  ]);
  const byId = id => (Array.isArray(list) ? list.find(c => c.id === id) : undefined);
  const oc = byId('opencode');
  return {
    connected: agent,
    mode: ws.mode,
    ado: agent ? (list ? adoFact(byId('ado'), adoCfg) : null) : { state: 'browser' },
    receipts: receiptsCount(summary),
    team: teamCount(people),
    self: selfName(people),
    areas: areaCount(teams),
    dataDir: cfg && typeof cfg.dataDir === 'string' ? cfg.dataDir : null,
    dispatch: agent && list ? (oc && oc.enabled && oc.status.state === 'ready' ? 'ready' : oc ? 'off' : 'missing') : null,
    startAtLogin: cfg && cfg.features ? cfg.features.startAtLogin === true : null,
    workMode: cfg && cfg.features ? cfg.features.workMode === true : false
  };
}

/**
 * Pick your apps: one line per app on the rail, with the ones that cannot do much here suggested off. Slate
 * without Azure DevOps and without Dispatch is only a local request board; Dispatch needs its agents.
 */
export function appSuggestions(f = {}) {
  const ado = f.ado && f.ado.state === 'ready';
  const agents = f.dispatch === 'ready';
  return [
    { id: 'prioritizer', name: 'Docket', why: 'your tasks, today and what you handed over.' },
    { id: 'slate', name: 'Slate', why: ado || agents ? 'requests from idea to shipped.' : 'requests from idea to shipped. Without Azure DevOps or Dispatch it is a local board you fill in by hand.', off: !ado && !agents },
    { id: 'agents', name: 'Dispatch', why: agents ? 'coding agents on your work items.' : 'coding agents on your work items. Not set up on this computer.', off: !agents },
    { id: 'receipts', name: 'Rapport', why: '1:1s and evidence for reviews.' },
    { id: 'notes', name: 'Folio', why: 'notes, kept as files.' },
    { id: 'runway', name: 'Runway', why: 'roadmaps you can share as an image.' }
  ];
}

/* ------------------------------------------------------------------------------------------- deciding */

// The order a new person goes in. `core` steps count toward "n of m"; the rest are for later.
export const STEPS = [
  { id: 'connect', core: true, title: 'Connect Workshop on this computer' },
  { id: 'name', core: true, title: 'Add yourself' },
  { id: 'backup', core: true, title: 'Keep your data backed up', needs: 'connect' },
  { id: 'ado', core: true, title: 'Connect Azure DevOps', needs: 'connect' },
  { id: 'apps', core: true, title: 'Pick your apps' },
  { id: 'team', core: true, title: 'Add your team' },
  { id: 'areas', core: true, title: "Set your team's area paths", needs: 'ado' },
  { id: 'task', core: true, title: 'Add your first task in Docket' },
  { id: 'receipt', core: true, title: 'Log your first receipt' },
  { id: 'dispatch', core: false, title: 'Set up Dispatch for coding agents', needs: 'connect' },
  { id: 'login', core: false, title: 'Start Workshop when you log in', needs: 'connect' }
];

/**
 * Each step's state: 'done', 'skipped', 'blocked' (needs an earlier step) or 'todo'. `facts` from
 * factsFor() plus {name, tasks} from Home; `skipped` the saved list. `current` is the first core step to
 * do, or the first later one once the core is done.
 */
export function stepsFor(facts, skipped = []) {
  const f = facts || {};
  const skip = new Set(skipped);
  const done = {
    connect: f.connected === true,
    // Your name lives in People (relation You), so every app knows who you are.
    name: !!(f.self && String(f.self).trim()),
    apps: f.appsPicked === true,
    backup: onOneDrive(f.dataDir),
    ado: f.ado && f.ado.state === 'ready',
    team: Number(f.team) > 0,
    areas: Number(f.areas) > 0,
    task: Number(f.tasks) > 0,
    receipt: f.receipts > 0,
    dispatch: f.dispatch === 'ready',
    login: f.startAtLogin === true
  };
  const state = {};
  for (const s of STEPS) {
    if (done[s.id]) state[s.id] = 'done';
    else if (skip.has(s.id)) state[s.id] = 'skipped';
    // A step whose prerequisite was skipped is skipped too (no Workshop on this computer, no ADO).
    else if (s.needs && state[s.needs] === 'skipped') state[s.id] = 'skipped';
    else if (s.needs && state[s.needs] !== 'done') state[s.id] = 'blocked';
    else state[s.id] = 'todo';
  }
  const steps = STEPS.map(s => ({ ...s, state: state[s.id], explicitSkip: skip.has(s.id) }));
  const core = steps.filter(s => s.core);
  const finished = core.filter(s => s.state === 'done' || s.state === 'skipped').length;
  const next = core.find(s => s.state === 'todo') || core.find(s => s.state === 'blocked')
    || steps.find(s => !s.core && s.state === 'todo') || null;
  return { steps, done: core.filter(s => s.state === 'done').length, finished, total: core.length, complete: finished === core.length, current: next ? next.id : null };
}

/* ------------------------------------------------------------------------------------------- showing */

const ICON = {
  done: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7"/><path d="M4.8 8.3l2.1 2.1 4.3-4.6"/></svg>',
  todo: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/></svg>',
  skipped: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M5 8h6"/></svg>',
  blocked: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke-dasharray="2 2.2"/></svg>'
};
const LABEL = { done: 'Done', todo: 'To do', skipped: 'Skipped', blocked: 'Waiting' };

const code = (text, i) => `<div class="su-code"><code>${esc(text)}</code><button type="button" class="btn ghost su-copy" data-copy="${i}">Copy</button></div>`;
const btn = (label, attrs, primary) => `<button type="button" class="btn${primary ? ' primary' : ' ghost'}" ${attrs}>${esc(label)}</button>`;

/**
 * What to say and offer for one step. `ctx`: {facts, platform ('win' | 'mac' | 'linux'), origin (this
 * site, for the installer), settings: {inShell} | {href} | null, copies: [] (filled with copyable text)}.
 */
function detail(s, ctx) {
  const f = ctx.facts || {};
  const copy = text => code(text, ctx.copies.push(text) - 1);
  // path: the Settings page to open (apps/settings/js/pages.js), for example connections.
  const settingsBtn = (label = 'Open Settings', path = '') => ctx.settings && ctx.settings.inShell ? btn(label, `data-open="settings"${path ? ` data-path="${esc(path)}"` : ''}`, true)
    : ctx.settings && ctx.settings.href ? `<a class="btn primary" href="${esc(ctx.settings.href)}" target="_blank" rel="noopener">${esc(label)} on this computer</a>`
      : '';
  const settingsWhere = ctx.settings && ctx.settings.inShell ? 'Settings' : '<b>Workshop on this computer</b> (run <code>workshop open</code>, or the button below), Settings,';
  if (s.state === 'blocked') {
    const need = STEPS.find(x => x.id === s.needs);
    return `<p>Do <b>${esc(need.title)}</b> first.</p>`;
  }
  switch (s.id) {
    case 'connect': {
      if (f.workMode) return `<p>Work mode is on: Workshop runs from the pinned copy on this computer, so there is nothing to connect. Open it with <code>workshop open</code> and check it with <code>workshop doctor</code>.</p>`;
      const site = /^https:\/\//.test(ctx.origin || '') ? ctx.origin : SITE.workshop;
      const work = ctx.machine !== 'personal';
      const pick = (id, label) => `<button type="button" class="btn${(id === 'work') === work ? ' primary' : ' ghost'}" data-machine="${id}" aria-pressed="${(id === 'work') === work}">${label}</button>`;
      const choose = `<p class="su-pick" role="group" aria-label="Which computer is this?">${pick('work', 'Work computer')}${pick('personal', 'Personal computer')}</p>`;
      if (work) {
        return `${choose}<p>Install Workshop in work mode, once, for your user only, with no admin rights. It runs only from a copy on your computer, no website can reach it, and your data goes in your company OneDrive:</p>
        ${copy(ctx.platform === 'win' ? `irm ${site}/install-work.ps1 | iex` : `curl -fsSL ${site}/install-work.sh | bash`)}
        <p class="su-fine">Run it in ${ctx.platform === 'win' ? 'PowerShell (not as admin)' : 'a terminal'}. If your company blocks piping a script, follow "Work mode, by hand" in the README.</p>
        <p>It opens Workshop on your computer when it finishes, with this checklist. From then on, open it from the Start menu (<b>Workshop</b>) or with <code>workshop up</code>.</p>`;
      }
      const cmd = ctx.platform === 'win' ? `irm ${site}/install.ps1 | iex` : `curl -fsSL ${site}/install.sh | bash`;
      return `${choose}<p>Workshop keeps your data in files on your computer and talks to Azure DevOps from there. Install it once, for your user only, with no admin rights:</p>
        ${copy(cmd)}
        <p class="su-fine">Run it in ${ctx.platform === 'win' ? 'PowerShell (not as admin)' : 'a terminal'}. Answer <b>n</b> to the AI model question unless you want Dispatch. If piping a script is blocked, follow "By hand" in the README.</p>
        <p>The installer opens Workshop on this computer once, which signs this browser in. Then click <b>Connect</b> on the rail and <b>Allow</b> in the small window.</p>
        <p class="su-fine">Already installed? Run <code>workshop restart</code>, then click Connect.</p>`;
    }
    case 'backup': {
      const where = f.dataDir ? `<code>${esc(f.dataDir)}</code>` : 'your data folder';
      if (onOneDrive(f.dataDir)) return `<p>Your data is in ${where}, so OneDrive backs it up.</p>`;
      if (f.workMode) return `<p>Everything you add is saved as files in ${where}. Workshop never uploads it, so if this computer is replaced, those files are your only copy.</p>
        <p>Move it into your company OneDrive, which backs it up. This copies your files, switches to the new folder and keeps the old one:</p>${copy('workshop data-folder --onedrive')}
        <p class="su-fine">Prefer another folder? <code>workshop data-folder &lt;folder&gt;</code>. Happy with local files? Skip this step.</p>`;
      return `<p>Everything you add is saved as files in ${where}. Workshop never uploads it, so if this computer is replaced, those files are your only copy.</p>
        <p>Keep the folder somewhere your computer backs up (a synced folder, or one your backup tool copies). This copies your files, switches to the new folder and keeps the old one:</p>${copy('workshop data-folder <folder>')}
        <p class="su-fine">Happy with where it is? Skip this step.</p>`;
    }
    case 'team':
      return `<p>Add your direct reports and your manager once. Rapport shows a page per report with 1:1 prep and their receipts, and quick capture on this page knows their names ("john shipped the migration" becomes a receipt for John). A long list can be imported from a spreadsheet.</p><p>${btn('Open People', 'data-open="settings" data-path="people"', true)}</p>`;
    case 'areas':
      return `<p>The Azure DevOps area paths your team works in. Slate lists your team's backlog from them (its Inbox is empty without them), and Runway's ADO roadmaps and the Dispatch hub use them too.</p><p>${btn('Open Team area paths', 'data-open="settings" data-path="team"', true)}</p>`;
    case 'name':
      return `<p>Add yourself in People: your name, and the name Azure DevOps knows you by, so Docket, Slate and Rapport know what is yours. Home greets you by it too.</p><p>${btn('Add yourself', `data-open="settings" data-path="people/you${f.name ? '/' + esc(encodeURIComponent(f.name)) : ''}"`, true)}</p>`;
    case 'apps': {
      const sug = appSuggestions(f);
      const rows = sug.map(a => `<li><b>${esc(a.name)}</b>: ${esc(a.why)}${a.off ? ' <span class="su-off">Suggested: off</span>' : ''}</li>`).join('');
      return `<p>Turn off what you won't use, so the rail only shows what helps. Anything can come back later in Settings, Apps.</p><ul class="su-list">${rows}</ul>
        <p>${ctx.settings && ctx.settings.inShell ? btn('Open Apps', 'data-open="settings" data-path="apps"') : ctx.settings && ctx.settings.href ? `<a class="btn ghost" href="${esc(ctx.settings.href)}#apps" target="_blank" rel="noopener">Open Apps on this computer</a>` : btn('Open Apps', 'data-open="settings" data-path="apps"')} ${btn('These look right', 'data-apps-ok', true)}</p>`;
    }
    case 'ado': {
      const a = f.ado || {};
      if (a.state === 'ready') {
        return `<p>Connected.${a.message ? ' ' + esc(a.message) : ''}</p>${a.noExpiry ? `<p class="su-fine">Tip: set <b>PAT expires</b> on the connection in ${settingsWhere} to get a warning two weeks before it stops working.</p>` : ''}`;
      }
      if (a.state === 'off' || a.state === 'missing') {
        return `<p>Docket syncs your work items and the pull requests waiting on your review, and Slate and Runway read your backlog and publish to it, through the Azure DevOps connector.</p>
          <ol class="su-list"><li>Make a personal access token in ADO with <b>Work Items (Read &amp; write)</b>, plus <b>Code (Read)</b> for pull requests. Note its expiry date. (Work Items (Read) is enough if you only use Docket: Slate and Runway then can't publish, comment or close items.)</li>
          <li>Save it on this computer: ${copy('workshop pat ADO_PAT')}It asks for the token without showing it.</li>
          <li>In ${settingsWhere} turn on <b>Azure DevOps</b> and paste any link from Azure DevOps (a work item or board) to fill in your connection. Set <b>PAT expires</b>, Save, and try the Test field with a work item ID.</li></ol>
          <p>${settingsBtn('Open Settings', 'connections')}</p>`;
      }
      if (a.state === 'noConnection') {
        return `<p>The connector is on but has no connection yet. In ${settingsWhere} open Connections and paste any Azure DevOps link, or add your server, collection and project by hand.</p><p>${settingsBtn('Open Settings', 'connections')}</p>`;
      }
      if (a.state === 'noPat') {
        return `<p>The connection is set up, but the token isn't saved on this computer yet. Run this and paste your token when asked:</p>${copy(`workshop pat ${a.patEnv || 'ADO_PAT'}`)}
          <p class="su-fine">${ctx.platform === 'win' ? 'Workshop picks it up within seconds; this step ticks itself off.' : 'Then run <code>workshop restart</code>; this step ticks itself off.'}</p>`;
      }
      if (a.state === 'browser') return '<p>Do <b>Connect Workshop on this computer</b> first.</p>';
      return `<p>${esc(a.message || 'The ADO connector is not ready yet.')}</p><p>${settingsBtn('Open Settings', 'connections')}</p>`;
    }
    case 'task':
      return `<p>Docket decides what you work on next. It opens with a short tour; <b>Load sample tasks</b> there if you just want to look around.</p><p>${btn('Open Docket', 'data-open="prioritizer"', true)}</p>`;
    case 'receipt':
      return `<p>Rapport keeps evidence of your and your team's work for reviews, next to your 1:1s. Add one thing you did this week.</p><p>${btn('Open Rapport', 'data-open="receipts" data-path="me"', true)}</p>`;
    case 'dispatch':
      return f.workMode
        ? `<p>Dispatch runs coding agents with an AI provider, so work mode leaves it out. Add it only if your company allows a coding agent: follow "Dispatch in work mode" in the README (install opencode and Tandem at its release tag, set the Workspace folder, then <b>Approved AI providers</b>), or run the one-line installer again with <code>WORKSHOP_DISPATCH=1</code>.</p><p>${btn('Open Dispatch', 'data-open="agents"')}</p>`
        : `<p>Dispatch runs opencode coding agents on your work items. It needs opencode, Tandem and an AI model; Dispatch's own setup guide walks you through it.</p><p>${btn('Open Dispatch', 'data-open="agents"', true)}</p>`;
    case 'login':
      return `<p>Run Workshop by hand for a few days first. When it has been trouble free, turn on <b>Start at login</b> in ${settingsWhere} (This computer), or run:</p>${copy('workshop install --login')}<p>${settingsBtn('Open Settings', 'computer')}</p>`;
    default: return '';
  }
}

const ICON_UI = {
  refresh: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10a6 6 0 0 1 10.3-4.2M16 10a6 6 0 0 1-10.3 4.2"/><path d="M14.6 2.8v3.3h-3.3M5.4 17.2v-3.3h3.3"/></svg>',
  up: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 12.5L10 8l4.5 4.5"/></svg>',
  down: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 8l4.5 4.5L14.5 8"/></svg>',
  x: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>'
};
const ibtn = (icon, label, attr) => `<button type="button" class="ibtn" ${attr} aria-label="${esc(label.split('.')[0])}" title="${esc(label)}">${icon}</button>`;

/** The one-line form of the checklist under the greeting: the next step and n of total. Click opens the card. */
export function strip(view) {
  const cur = view.steps.find(s => s.id === view.current);
  const label = view.complete ? "You're set up" : cur ? 'Next: ' + cur.title : 'Get started';
  return `<section class="su-strip${view.complete ? ' complete' : ''}" aria-label="Get started">
    <button type="button" class="su-line" data-setup-expand aria-expanded="false"><span class="su-ic">${view.complete ? ICON.done : ICON[cur ? cur.state : 'todo']}</span>
      <span class="su-title">${esc(label)}</span><span class="su-count num">${view.finished}/${view.total}</span>${ICON_UI.down}</button>
    ${ibtn(ICON_UI.x, 'Hide. The progress button at the top brings it back.', 'data-setup-hide')}</section>`;
}

/**
 * The checklist card. `view` from stepsFor(); `open` the id of the step shown expanded (null: the current
 * one); ctx as in detail(). Returns {html, copies}: data-copy="<n>" buttons copy copies[n].
 */
export function card(view, open, ctx) {
  const c = { ...ctx, copies: [] };
  const shown = open === undefined || open === null ? view.current : open;
  const row = s => {
    const isOpen = s.id === shown;
    const canSkip = s.state === 'todo' || s.state === 'blocked';
    return `<li class="su-step ${s.state}${isOpen ? ' open' : ''}" data-step="${s.id}">
      <button type="button" class="su-head" data-toggle-step="${s.id}" aria-expanded="${isOpen}">
        <span class="su-ic">${ICON[s.state]}</span><span class="su-title">${esc(s.title)}</span><span class="su-state">${LABEL[s.state]}</span>
      </button>
      ${isOpen ? `<div class="su-body">${detail(s, c)}
        <p class="su-acts">${canSkip ? `<button type="button" class="lnk" data-skip="${s.id}">Skip this step</button>` : ''}${s.explicitSkip && s.state === 'skipped' ? `<button type="button" class="lnk" data-unskip="${s.id}">Do this step after all</button>` : ''}</p>
      </div>` : ''}
    </li>`;
  };
  // Finished steps fold into one line ("3 done") unless asked for, or one of them is the step shown.
  const folded = st => st.state === 'done' && !ctx.showDone && st.id !== shown;
  const nDone = view.steps.filter(folded).length;
  const core = view.steps.filter(s => s.core && !folded(s)), later = view.steps.filter(s => !s.core && !folded(s));
  const pct = Math.round(100 * view.finished / view.total);
  const html = `<section class="setup" aria-labelledby="setup-h">
    <div class="su-top">
      <div><p class="su-eyebrow">Get started · ${view.finished} of ${view.total}</p>
        <h2 id="setup-h">${view.complete ? "You're set up" : 'Set up Workshop'}</h2>
        <p class="su-sub">${view.complete ? 'Everything below ticks itself off as you go. Hide this whenever you like; the progress button at the top brings it back.' : 'Each step ticks itself off when Workshop sees it done. Skip anything you don\'t use.'}</p></div>
      <div class="su-tools">${ibtn(ICON_UI.refresh, 'Check again', 'data-setup-check')}${ibtn(ICON_UI.up, 'Fold to one line', 'data-setup-collapse')}${ibtn(ICON_UI.x, 'Hide. The progress button at the top brings it back.', 'data-setup-hide')}</div>
    </div>
    <div class="su-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${view.total}" aria-valuenow="${view.finished}" aria-label="Setup progress"><span style="width:${pct}%"></span></div>
    ${nDone ? `<button type="button" class="su-done" data-setup-done>${ICON.done}<span>${nDone} done</span><span class="su-fine">Show</span></button>` : ''}
    ${core.length ? `<ol class="su-steps">${core.map(row).join('')}</ol>` : ''}
    ${later.length ? `<p class="su-later">Later</p><ol class="su-steps">${later.map(row).join('')}</ol>` : ''}
  </section>`;
  return { html, copies: c.copies };
}

/* ------------------------------------------------------------------------------------------- saving */

/**
 * Loads the facts and the saved state, and saves hide and skip. `extra()` gives {name, tasks} from Home
 * (tasks: null while the board is unknown). onChange is called after every load or save.
 */
export function createSetup(ws, { onChange = () => {}, extra = () => ({}) } = {}) {
  const s = { loaded: false, facts: null, hidden: false, skipped: [], env: null, machine: 'work', appsPicked: false, folded: false };

  async function loadSaved() {
    try {
      s.env = await ws.data.get('setup');
      const m = s.env && s.env.meta || {};
      s.hidden = m.hidden === true;
      s.skipped = Array.isArray(m.skipped) ? m.skipped.filter(id => STEPS.some(x => x.id === id)) : [];
      s.machine = m.machine === 'personal' ? 'personal' : 'work';
      s.appsPicked = m.appsPicked === true;
      s.folded = m.folded === true;
    } catch (e) { /* keep what is shown; Home's own waiting state covers the folder */ }
  }
  async function load() {
    const [facts] = await Promise.all([factsFor(ws), loadSaved()]);
    s.facts = facts;
    s.loaded = true;
    onChange();
  }

  async function save(patch) {
    const before = { hidden: s.hidden, skipped: s.skipped, machine: s.machine, appsPicked: s.appsPicked, folded: s.folded };
    Object.assign(s, patch);
    onChange();
    const build = base => ({
      schema: 'home.setup', version: SETUP_VERSION, rev: base ? base.rev : 0, items: [], deleted: base && base.deleted || {},
      meta: Object.assign({}, base && base.meta, { hidden: s.hidden, skipped: s.skipped, machine: s.machine, appsPicked: s.appsPicked, folded: s.folded, updatedAt: Date.now() })
    });
    try {
      try {
        const env = build(s.env);
        const r = await ws.data.put('setup', env);
        s.env = Object.assign(env, { rev: r.rev });
      } catch (e) {
        if (!(e.code === 'conflict' && e.current)) throw e;
        const env = build(e.current);
        const r = await ws.data.put('setup', env);
        s.env = Object.assign(env, { rev: r.rev });
      }
    } catch (e) {
      Object.assign(s, before);
      onChange();
      throw e;
    }
  }

  const view = () => stepsFor({ ...(s.facts || {}), ...extra(), appsPicked: s.appsPicked }, s.skipped);
  return {
    s, load, view,
    hide: () => save({ hidden: true }),
    show: () => save({ hidden: false }),
    skip: id => save({ skipped: [...new Set([...s.skipped, id])] }),
    unskip: id => save({ skipped: s.skipped.filter(x => x !== id) }),
    setMachine: m => save({ machine: m === 'personal' ? 'personal' : 'work' }),
    appsOk: () => save({ appsPicked: true }),
    fold: on => save({ folded: !!on })
  };
}
