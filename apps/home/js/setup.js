/* Home: the Get started checklist. Each step ticks itself off from what Workshop can see (connected to
   Workshop on this computer, your name, the ADO connector, a Docket task, a receipt),
   so it works as an interactive guide for someone new. Any step can be skipped. Hiding the checklist and
   skipped steps are saved in Home's own collection `setup` (home.setup v1, no items; meta: {hidden,
   skipped: [step ids], updatedAt}); everything else is read live, read-only.

   factsFor() reads, stepsFor() decides (pure), card() builds the HTML (pure), createSetup() loads and
   saves. main.js puts the card under the greeting and repaints it when anything changes. */
import { esc } from './view.js';

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

const count = env => (env && Array.isArray(env.items) ? env.items.length : 0);

/**
 * Everything the checklist needs, read through the SDK. Never throws: a fact it cannot read is null
 * ("don't know yet"), which keeps that step open rather than ticking it.
 */
export async function factsFor(ws) {
  const agent = ws.backend === 'agent';
  const quiet = p => p.catch(() => null);
  const [receipts, list, cfg, adoCfg] = await Promise.all([
    quiet(ws.data.get('entries', { app: 'receipts' })),
    agent ? quiet(ws.connectors.list()) : null,
    agent ? quiet(ws.config.get()) : null,
    agent ? quiet(ws.connectors.getConfig('ado')) : null
  ]);
  const byId = id => (Array.isArray(list) ? list.find(c => c.id === id) : undefined);
  const oc = byId('opencode');
  return {
    connected: agent,
    mode: ws.mode,
    ado: agent ? (list ? adoFact(byId('ado'), adoCfg) : null) : { state: 'browser' },
    receipts: count(receipts),
    dispatch: agent && list ? (oc && oc.enabled && oc.status.state === 'ready' ? 'ready' : oc ? 'off' : 'missing') : null,
    startAtLogin: cfg && cfg.features ? cfg.features.startAtLogin === true : null,
    workMode: cfg && cfg.features ? cfg.features.workMode === true : false
  };
}

/* ------------------------------------------------------------------------------------------- deciding */

// The order a new person goes in. `core` steps count toward "n of m"; the rest are for later.
export const STEPS = [
  { id: 'connect', core: true, title: 'Connect Workshop on this computer' },
  { id: 'name', core: true, title: 'Add your name' },
  { id: 'ado', core: true, title: 'Connect Azure DevOps', needs: 'connect' },
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
    name: !!(f.name && String(f.name).trim()),
    ado: f.ado && f.ado.state === 'ready',
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
  const settingsBtn = (label = 'Open Settings') => ctx.settings && ctx.settings.inShell ? btn(label, 'data-open="settings"', true)
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
      const site = /^https:\/\//.test(ctx.origin || '') ? ctx.origin : 'https://workshop.alexisdavidson.org';
      const cmd = ctx.platform === 'win' ? `irm ${site}/install.ps1 | iex` : `curl -fsSL ${site}/install.sh | bash`;
      return `<p>Workshop keeps your data in files on your computer and talks to Azure DevOps from there. Install it once, for your user only, with no admin rights:</p>
        ${copy(cmd)}
        <p class="su-fine">Run it in ${ctx.platform === 'win' ? 'PowerShell (not as admin)' : 'a terminal'}. Answer <b>n</b> to the AI model question unless you want Dispatch. If your company blocks piping a script, follow "By hand" in the README.</p>
        <p>The installer opens Workshop on this computer once, which signs this browser in. Then click <b>Connect</b> on the rail and <b>Allow</b> in the small window.</p>
        <p class="su-fine">Already installed? Run <code>workshop restart</code>, then click Connect.</p>`;
    }
    case 'name':
      return `<p>Used only for the greeting on this page.</p><p>${btn('Add your name', 'data-edit-profile', true)}</p>`;
    case 'ado': {
      const a = f.ado || {};
      if (a.state === 'ready') {
        return `<p>Connected.${a.message ? ' ' + esc(a.message) : ''}</p>${a.noExpiry ? `<p class="su-fine">Tip: set <b>PAT expires</b> on the connection in ${settingsWhere} to get a warning two weeks before it stops working.</p>` : ''}`;
      }
      if (a.state === 'off' || a.state === 'missing') {
        return `<p>Docket syncs your work items and the pull requests waiting on your review through the Azure DevOps connector.</p>
          <ol class="su-list"><li>Make a personal access token in ADO with <b>Work Items (Read)</b>, plus <b>Code (Read)</b> for pull requests. Note its expiry date.</li>
          <li>Save it on this computer: ${copy('workshop pat ADO_PAT')}It asks for the token without showing it.</li>
          <li>In ${settingsWhere} turn on <b>Azure DevOps</b> and add your connection, or <b>Import settings from a file</b> with your <code>ado-helper.json</code>. Set <b>PAT expires</b>, Save, and try the Test field with a work item ID.</li></ol>
          <p>${settingsBtn()}</p>`;
      }
      if (a.state === 'noConnection') {
        return `<p>The connector is on but has no connection yet. In ${settingsWhere} open Azure DevOps settings and add your server, collection and project, or <b>Import settings from a file</b> with your <code>ado-helper.json</code>.</p><p>${settingsBtn()}</p>`;
      }
      if (a.state === 'noPat') {
        return `<p>The connection is set up, but the token isn't saved on this computer yet. Run this and paste your token when asked:</p>${copy(`workshop pat ${a.patEnv || 'ADO_PAT'}`)}
          <p class="su-fine">${ctx.platform === 'win' ? 'Workshop picks it up within seconds; this step ticks itself off.' : 'Then run <code>workshop restart</code>; this step ticks itself off.'}</p>`;
      }
      if (a.state === 'browser') return '<p>Do <b>Connect Workshop on this computer</b> first.</p>';
      return `<p>${esc(a.message || 'The ADO connector is not ready yet.')}</p><p>${settingsBtn()}</p>`;
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
      return `<p>Run Workshop by hand for a few days first. When it has been trouble free, turn on <b>Start at login</b> in ${settingsWhere}, or run:</p>${copy('workshop install --login')}<p>${settingsBtn()}</p>`;
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
  const s = { loaded: false, facts: null, hidden: false, skipped: [], env: null };

  async function loadSaved() {
    try {
      s.env = await ws.data.get('setup');
      const m = s.env && s.env.meta || {};
      s.hidden = m.hidden === true;
      s.skipped = Array.isArray(m.skipped) ? m.skipped.filter(id => STEPS.some(x => x.id === id)) : [];
    } catch (e) { /* keep what is shown; Home's own waiting state covers the folder */ }
  }
  async function load() {
    const [facts] = await Promise.all([factsFor(ws), loadSaved()]);
    s.facts = facts;
    s.loaded = true;
    onChange();
  }

  async function save(patch) {
    const before = { hidden: s.hidden, skipped: s.skipped };
    Object.assign(s, patch);
    onChange();
    const build = base => ({
      schema: 'home.setup', version: SETUP_VERSION, rev: base ? base.rev : 0, items: [], deleted: base && base.deleted || {},
      meta: Object.assign({}, base && base.meta, { hidden: s.hidden, skipped: s.skipped, updatedAt: Date.now() })
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

  const view = () => stepsFor({ ...(s.facts || {}), ...extra() }, s.skipped);
  return {
    s, load, view,
    hide: () => save({ hidden: true }),
    show: () => save({ hidden: false }),
    skip: id => save({ skipped: [...new Set([...s.skipped, id])] }),
    unskip: id => save({ skipped: s.skipped.filter(x => x !== id) })
  };
}
