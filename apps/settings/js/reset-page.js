/* Settings, Data: Start over (docs/agent-api.md, Reset). Deletes some or all apps' data, and Tandem's work items if
   picked, after the agent saves it all to a zip beside the data folder. Made hard to do by accident:
   - the card is closed until you open it, and opening it asks the agent for a ticket;
   - you tick each app (or Everything) and type the phrase that names what goes ("delete 2 apps");
   - the button stays locked until the agent's wait has passed (10 seconds), and the agent checks that too;
   - only from Workshop on this computer (or `workshop reset` in a terminal).
   When it ends, the agent tells every Workshop window to reload; this page then shows what happened. */
import { OLD_FOLDERS, formerIds } from '../../../shared/app-folders.js';

const PENDING = 'workshop.resetPending';
const MB = 1024 * 1024;
const size = n => (n < 1024 ? `${n} B` : n < MB ? `${Math.round(n / 1024)} KB` : `${(n / MB).toFixed(1)} MB`);

/** The phrase to type, from the agent's patterns (GET /api/reset `phrases`). null when nothing is picked. */
export function phraseFor(phrases, { everything, count, tandem }) {
  if (!phrases) return null;
  if (everything) return phrases.everything;
  if (count === 1) return phrases.one;
  if (count > 1) return phrases.many.replace('{n}', String(count));
  return tandem ? phrases.workOnly : null;
}

/** Seconds left before the button unlocks. */
export const secondsLeft = (waitMs, since, now = Date.now()) => Math.max(0, Math.ceil((waitMs - (now - since)) / 1000));

/** This browser's saved view settings for the reset apps: localStorage keys named after an app's id or folder. */
export function viewKeys(keys, apps) {
  const prefixes = new Set();
  // Its id, its folder, and the ids and folders it had before the rename (shared/app-folders.js).
  for (const a of apps || []) for (const n of [a.id, a.folder, ...formerIds(a.id), ...(OLD_FOLDERS[a.id] || [])]) if (n) prefixes.add(`${n}.`);
  return keys.filter(k => k !== 'workshop.agent' && [...prefixes].some(p => k.startsWith(p)));
}

/** The lines that say what a reset did (GET /api/reset `last`). */
export function resultLines(last) {
  if (!last) return [];
  if (last.error) return [`Start over stopped: ${last.error}`];
  const lines = [`Deleted ${last.everything ? 'everything' : last.apps.length ? last.apps.map(a => a.name).join(', ') : 'no app data'}. Backup: ${last.backup.path} (${last.backup.files} file${last.backup.files === 1 ? '' : 's'}).`];
  if (last.tandem) {
    lines.push(`Tandem: removed ${last.tandem.removed} work item${last.tandem.removed === 1 ? '' : 's'}${last.tandem.stopped ? `, after stopping ${last.tandem.stopped} running agent${last.tandem.stopped === 1 ? '' : 's'}` : ''}.`);
    for (const k of last.tandem.kept || []) lines.push(`Kept worktree ${k}`);
    for (const f of last.tandem.failed || []) lines.push(`Could not remove ${f}`);
  }
  for (const f of last.failed || []) lines.push(`Could not delete ${f}. Close any program using it, then delete it yourself.`);
  return lines;
}

function clearViews(apps) {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    for (const k of viewKeys(keys, apps)) localStorage.removeItem(k);
  } catch (e) { /* storage blocked */ }
  if (apps.some(a => a.id === 'builds') && typeof indexedDB !== 'undefined') { try { indexedDB.deleteDatabase('builds-cache'); } catch (e) { /* none */ } }
}

function reloadAll() {
  try { (window.top && window.top.location.origin === location.origin ? window.top : window).location.reload(); } catch (e) { location.reload(); }
}

/**
 * @param {object} o {ws, card, esc, agentCall, toast, errText}
 */
export async function mountReset({ ws, card, esc, agentCall, toast, errText }) {
  const sec = card('Start over', '', 'data', 90, 'Delete data for some or all apps and begin again. Everything deleted is saved to a zip first.');
  sec.classList.add('reset-card');
  const body = document.createElement('div');
  sec.appendChild(body);

  if (ws.backend !== 'agent') {
    body.innerHTML = '<p class="cfg-help">Starting over needs Workshop running on this computer. Without it, your data is in this browser: clear this site\'s data in the browser\'s settings to start over.</p>';
    return;
  }
  if (ws.mode !== 'local') {
    body.innerHTML = '<p class="cfg-help">Start over from Workshop on this computer (run <code>workshop open</code>), or run <code>workshop reset</code> in a terminal.</p>';
    return;
  }

  // Back from a reset: say what happened, then clear this browser's view settings for those apps.
  // PENDING is "1" while a reset runs, or {"error"} when the agent refused it (the page may reload before it shows).
  let done = null;
  let pending = null;
  try { pending = sessionStorage.getItem(PENDING); sessionStorage.removeItem(PENDING); } catch (e) { /* none */ }
  if (pending === '1') {
    try { done = (await agentCall('GET', '/api/reset')).last; } catch (e) { done = { error: errText(e) }; }
    if (done && !done.error) clearViews(done.apps || []);
  } else if (pending) {
    try { done = JSON.parse(pending); } catch (e) { done = null; }
  }

  const closed = () => {
    body.innerHTML = `${done ? `<div class="reset-done${done.error ? ' err' : ''}" role="status">${resultLines(done).map(l => `<p>${esc(l)}</p>`).join('')}</div>` : ''}
      <p class="cfg-help">Deletes the data of the apps you pick, and Tandem's work items if you want, after saving it all to a zip you can put back. Connections, tokens, the data folder location and your repos stay.</p>
      <div class="acts left"><button type="button" class="btn" data-open>Start over...</button></div>`;
    body.querySelector('[data-open]').addEventListener('click', open);
  };

  async function open() {
    let plan;
    try { plan = await agentCall('GET', '/api/reset'); } catch (e) { toast(errText(e), 'error'); return; }
    if (plan.running) { toast('Workshop is already starting over.', 'error'); return; }
    const since = Date.now();
    const t = plan.tandem || { available: false };
    body.innerHTML = `<fieldset class="reset-pick"><legend>What to delete</legend>
        <label class="reset-row reset-all"><input type="checkbox" data-all> <b>Everything</b> <span class="soft">every app, plus the trash, backups and readable copy</span></label>
        ${plan.apps.map(a => `<label class="reset-row"><input type="checkbox" data-app="${esc(a.id)}"> ${esc(a.name)} <span class="soft">${a.files ? `${a.files} file${a.files === 1 ? '' : 's'}, ${size(a.bytes)}` : 'no data'}</span></label>`).join('')}
        <label class="reset-row reset-tandem"><input type="checkbox" data-tandem ${t.available ? '' : 'disabled'}> Tandem's work items
          <span class="soft">${t.available ? `${t.items} in <code>${esc(t.workspace)}/.work</code>. Running agents are stopped first; worktrees with uncommitted changes are kept.` : esc(t.why || 'Not available.')}</span></label>
      </fieldset>
      <p class="cfg-help">Saved first to a zip in <code>${esc(plan.backupDir)}</code>, read back, then deleted. Kept: connections and tokens, the data folder location, work mode, your repos and their branches. Every Workshop window reloads when it is done.</p>
      <label class="reset-type">Type <b data-phrase>the phrase</b> to confirm <input type="text" class="cfg-input" data-typed autocomplete="off" spellcheck="false" disabled></label>
      <div class="acts left"><button type="button" class="btn danger" data-go disabled>Delete and start over</button><button type="button" class="btn ghost" data-cancel>Cancel</button><span class="msg" aria-live="polite"></span></div>`;
    const q = s => body.querySelector(s);
    const boxes = [...body.querySelectorAll('[data-app]')];
    const all = q('[data-all]'), tandem = q('[data-tandem]'), typed = q('[data-typed]'), go = q('[data-go]'), msg = q('.msg'), phraseEl = q('[data-phrase]');
    let timer = null;
    const pick = () => {
      const ids = boxes.filter(b => b.checked).map(b => b.dataset.app);
      const everything = ids.length === boxes.length && boxes.length > 0;
      return { ids, everything, tandem: tandem.checked, phrase: phraseFor(plan.phrases, { everything, count: ids.length, tandem: tandem.checked }) };
    };
    const update = () => {
      const p = pick();
      all.checked = p.everything;
      all.indeterminate = !p.everything && p.ids.length > 0;
      phraseEl.textContent = p.phrase || 'the phrase';
      typed.disabled = !p.phrase;
      const left = secondsLeft(plan.waitMs, since);
      const match = !!p.phrase && typed.value.trim() === p.phrase;
      go.disabled = !match || left > 0;
      go.textContent = match && left > 0 ? `Delete and start over (${left})` : 'Delete and start over';
      if (match && left > 0 && !timer) timer = setInterval(() => { update(); if (!secondsLeft(plan.waitMs, since)) { clearInterval(timer); timer = null; } }, 500);
    };
    all.addEventListener('change', () => { for (const b of boxes) b.checked = all.checked; update(); });
    for (const b of [...boxes, tandem]) b.addEventListener('change', update);
    typed.addEventListener('input', update);
    q('[data-cancel]').addEventListener('click', () => { if (timer) clearInterval(timer); closed(); });
    go.addEventListener('click', async () => {
      const p = pick();
      if (!p.phrase || typed.value.trim() !== p.phrase) return;
      for (const el of body.querySelectorAll('input, button')) el.disabled = true;
      msg.textContent = 'Saving the backup, then deleting...';
      try { sessionStorage.setItem(PENDING, '1'); } catch (e) { /* the result still shows in the log */ }
      try {
        await agentCall('POST', '/api/reset', { apps: p.ids, tandem: p.tandem, phrase: typed.value, ticket: plan.ticket });
        msg.textContent = 'Done. Reloading Workshop...';
        setTimeout(reloadAll, 1500); // the agent's reset event usually reloads first
      } catch (e) {
        done = { error: errText(e) };
        try { sessionStorage.setItem(PENDING, JSON.stringify(done)); setTimeout(() => { try { sessionStorage.removeItem(PENDING); } catch (x) { /* none */ } }, 4000); } catch (x) { /* none */ }
        if (timer) clearInterval(timer);
        closed();
      }
    });
    update();
  }

  closed();
}
