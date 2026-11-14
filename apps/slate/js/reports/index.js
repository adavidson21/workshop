/* Loom's team reports, in Health: the section, the team profile, the pull and the Excel export. Moved from Runway
   (Runway 3.0.0), which had them from Docket. main.js imports this with a dynamic import() the first time Health
   shows them. It reads through Workshop's ADO connector `dataset` action only, and never writes to ADO.

   The team profile (area paths, people, window) is kept in this browser (localStorage "slate.reports"). The first
   time, it is taken from Runway's profile ("runway.reports"), or Docket's older one, when they ran in this browser.
   A profile with no area paths gets them (and the connection) filled in from your team in Workshop's People app
   (settings.teams). The last pull is cached in IndexedDB ("slate-cache"), since it can always be pulled again. */
import { esc } from '../model.js';
import { TABS, WINDOWS, buildWorkbook, compute, fmtMD, lines, teamLines, usable } from './model.js';
import { RENDER, rpCard } from './view.js';

/** Area paths and connection from the first team in Settings' `teams` (v1) that has any; null when none. */
export function teamDefaults(env) {
  if (!env || env.schema !== 'settings.teams' || env.version !== 1 || !Array.isArray(env.items)) return null;
  const t = env.items.find(x => x && Array.isArray(x.areas) && x.areas.some(a => typeof a === 'string' && a.trim()));
  if (!t) return null;
  return { areas: t.areas.filter(a => typeof a === 'string' && a.trim()).slice(0, 20), connection: typeof t.connection === 'string' ? t.connection : '' };
}

const KEY = 'slate.reports';
const OLD_KEYS = ['runway.reports'];
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function readProfile() {
  const base = { days: 42, areas: '', people: '', connection: '', tab: 'churn' };
  try {
    const mine = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (mine && typeof mine === 'object') return { ...base, ...mine };
    for (const k of OLD_KEYS) {
      const was = JSON.parse(localStorage.getItem(k) || 'null');
      if (was && typeof was === 'object') return { ...base, ...was };
    }
    const docket = JSON.parse(localStorage.getItem('prioritizer.ui') || 'null');
    const rp = docket && (docket.rp || docket.wl);
    if (rp && typeof rp === 'object') return { ...base, days: +rp.days || 42, areas: String(rp.areas || ''), people: String(rp.people || ''), tab: rp.tab || 'churn' };
  } catch (e) { /* storage off: defaults */ }
  return base;
}

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('slate-cache', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function cacheGet(k) {
  const db = await idb();
  return new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });
}
async function cacheSet(k, v) {
  const db = await idb();
  return new Promise(res => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => res(); });
}

let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return xlsxLoading || (xlsxLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../../../../shared/vendor/xlsx.full.min.js', import.meta.url).href;
    s.onload = () => (window.XLSX ? res(window.XLSX) : rej(new Error('Excel export did not load.')));
    s.onerror = () => { xlsxLoading = null; rej(new Error('Excel export did not load.')); };
    document.head.appendChild(s);
  }));
}

/**
 * @param {object} o {ws, ado: () => {ready, message}, toast, toastErr, ask (html, wire) => Promise<form|null>, saveFile, requestPaint}
 */
export function createReports(o) {
  const st = { profile: readProfile(), data: null, calc: null, busy: false, error: '', loaded: false };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st.profile)); } catch (e) { /* this session only */ } };
  const hasProfile = () => !!(lines(st.profile.areas).length || lines(st.profile.people).length);
  const ready = () => !!o.ado().ready;

  cacheGet('reports').then(d => { if (usable(d) && !st.data) { st.data = d; o.requestPaint(); } }).catch(() => {}).finally(() => { st.loaded = true; });

  function calc() {
    if (!st.data) return null;
    if (!st.calc || st.calc.key !== st.data.generatedAt) st.calc = compute(st.data);
    return st.calc;
  }

  function head() {
    const p = st.profile, d = st.data, nA = lines(p.areas).length, nP = lines(p.people).length;
    const n = [nA && plural(nA, 'area'), nP && plural(nP, 'person').replace('persons', 'people')].filter(Boolean).join(', ');
    if (!ready() || !hasProfile()) return '';
    const sub = d ? `${fmtMD(new Date(d.since + 'T12:00'))} to ${fmtMD(new Date(d.generatedAt || Date.now()))} · ${n}` : n;
    return `<div class="rp-head"><span class="soft">${esc(sub)}</span>
        <select class="rp-days" data-rp-days aria-label="Window">${WINDOWS.map(x => `<option value="${x}"${x === p.days ? ' selected' : ''}>${x} days</option>`).join('')}</select>
        <button class="btn" type="button" data-rp="refresh"${st.busy ? ' disabled' : ''}>${st.busy ? 'Refreshing' : 'Refresh'}</button>
        ${d ? '<button class="btn" type="button" data-rp="export">Export to Excel</button>' : ''}
        <button class="btn ghost" type="button" data-rp="profile">Team profile</button></div>`;
  }

  function body() {
    if (!ready()) {
      const a = o.ado();
      const why = a.message || 'Open Loom inside Workshop on this computer, with the ADO connector on.';
      return rpCard('Connect Azure DevOps', `Team reports read your team's work items from ADO through Workshop's ADO connector. ${esc(why)}`, '');
    }
    if (!hasProfile()) return rpCard('Set up your team profile', "Add your team's area paths and people. Every report uses them.", '<button class="btn primary" type="button" data-rp="profile">Set up team profile</button>');
    if (!st.data) {
      return rpCard(st.busy ? 'Reading ADO history' : 'No report data yet', st.busy ? 'This can take a minute for a big team.' : esc(st.error || "Pull your team's data from ADO."),
        `<button class="btn primary" type="button" data-rp="refresh"${st.busy ? ' disabled' : ''}>${st.busy ? 'Refreshing' : 'Pull data'}</button><button class="btn" type="button" data-rp="profile">Team profile</button>`);
    }
    const d = st.data, c = calc(), tab = TABS.some(t => t[0] === st.profile.tab) ? st.profile.tab : 'churn';
    const tabs = `<div class="seg rp-tabs" role="tablist" aria-label="Report">${TABS.map(([k, n]) => `<button type="button" role="tab" data-rp="tab" data-tab="${k}" aria-selected="${k === tab}">${n}</button>`).join('')}</div>`;
    const warn = d.truncated ? `<p class="hint">Only the ${d.scanned} most recently changed items were checked for history. Narrow the profile or window for full counts.</p>` : '';
    return `${tabs}${warn}<div class="reports">${RENDER[tab](c, d)}</div>`;
  }

  const html = () => head() + body();

  async function refresh() {
    if (st.busy) return;
    if (!ready()) { o.toast('Turn on the ADO connector in Workshop first.'); return; }
    if (!hasProfile()) return profile();
    st.busy = true; st.error = ''; o.requestPaint();
    try {
      const p = st.profile;
      const d = await o.ws.connectors.call('ado', 'dataset', { days: p.days, areas: lines(p.areas), people: lines(p.people), ...(p.connection ? { connection: p.connection } : {}) });
      d.generatedAt = d.generatedAt || new Date().toISOString();
      st.data = d; st.calc = null;
      cacheSet('reports', d).catch(() => {});
      o.toast(`Reports updated: ${plural(d.items.length, 'work item')}, ${plural(d.events.length, 'change')}`);
    } catch (e) {
      st.error = e && e.message ? e.message : 'Could not read from ADO.';
      o.toastErr(e);
    } finally { st.busy = false; o.requestPaint(); }
  }

  async function profile() {
    let p = st.profile;
    let team = [];
    try { team = teamLines(await o.ws.data.get('people', { app: 'settings' })); } catch (e) { team = []; }
    // No area paths yet: fill them in from your team in Workshop's People app (docs/teams.md). Saved only on Save.
    let fromTeam = false;
    if (!lines(p.areas).length) {
      let t = null;
      try { t = teamDefaults(await o.ws.data.get('teams', { app: 'settings' })); } catch (e) { t = null; }
      if (t && t.areas.length) { p = { ...p, areas: t.areas.join('\n'), connection: p.connection || t.connection }; fromTeam = true; }
    }
    const f = await o.ask(`<form method="dialog" class="dlg wide" data-form="reports-profile">
      <h2>Team profile</h2>
      <p class="soft">Area paths are the work your team owns. People are your team members. Add both to see work your people do for other teams. Read only: nothing changes in ADO.</p>
      <label>Area paths, one per line<textarea name="areas" rows="4" class="mono" placeholder="Project\\Team" spellcheck="false">${esc(p.areas)}</textarea></label>
      <p class="soft small">Includes everything under each.${fromTeam ? ' Filled in from your team in Workshop\'s People app.' : ''}</p>
      <label>People, one per line<textarea name="people" rows="4" class="mono" placeholder="name@company.com" spellcheck="false">${esc(p.people)}</textarea></label>
      <p class="soft small">Email or exact ADO display name.${team.length ? ` <button type="button" class="lnk" data-team>Use my team from Workshop (${team.length})</button>` : ''}</p>
      <label>Default window<select name="days">${WINDOWS.map(n => `<option value="${n}"${n === p.days ? ' selected' : ''}>Last ${n} days</option>`).join('')}</select></label>
      <label>ADO connection<input name="connection" value="${esc(p.connection)}" maxlength="40" placeholder="The connector's default"></label>
      <p class="soft warn" data-msg aria-live="polite"></p>
      <div class="acts"><span class="grow"></span><button class="btn" type="button" value="cancel" data-rp-cancel>Cancel</button><button class="btn primary" type="submit" value="ok">Save and pull data</button></div>
    </form>`, form => {
      const b = form.querySelector('[data-team]');
      if (b) b.addEventListener('click', () => { form.people.value = team.join('\n'); });
      form.addEventListener('submit', e => {
        if (!lines(form.areas.value).length && !lines(form.people.value).length) {
          e.preventDefault(); e.stopImmediatePropagation(); form.querySelector('[data-msg]').textContent = 'Add at least one area path or person.';
        }
      });
    });
    if (!f) return;
    st.profile = { ...p, areas: f.areas.value.trim(), people: f.people.value.trim(), days: +f.days.value || 42, connection: f.connection.value.trim().slice(0, 40) };
    save(); st.data = null; st.calc = null; o.requestPaint();
    refresh();
  }

  async function exportXlsx() {
    if (!st.data) return;
    try {
      const X = await loadXlsx();
      const out = X.write(buildWorkbook(X, st.data), { bookType: 'xlsx', type: 'array' });
      const how = await o.saveFile(`team-reports-${new Date().toISOString().slice(0, 10)}.xlsx`, out, XLSX_TYPE);
      if (how !== 'canceled') o.toast('Reports exported to Excel');
    } catch (e) { o.toastErr(e); }
  }

  /** Handles a click inside the page. Returns true when it was a Reports control. */
  function click(t, e) {
    const b = t.closest('[data-rp]');
    if (!b) return false;
    const a = b.dataset.rp;
    if (a === 'tab') { st.profile.tab = b.dataset.tab; save(); o.requestPaint(); }
    else if (a === 'refresh') refresh();
    else if (a === 'profile') profile();
    else if (a === 'export') exportXlsx();
    return true;
  }
  function change(t) {
    if (!t.matches('[data-rp-days]')) return false;
    st.profile.days = +t.value || 42; save(); refresh();
    return true;
  }

  return { st, html, refresh, profile, exportXlsx, click, change, calc };
}
