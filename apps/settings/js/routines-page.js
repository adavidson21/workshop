/* Settings, Routines (docs/config.md, Routines): Tandem commands or prompts Workshop starts on a schedule on this
   computer, each in a new chat (open Chat to read them). Pure HTML builders for test/routines-page.test.mjs. */

const DAYS = { daily: 'Every day', weekdays: 'Weekdays', mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays', sun: 'Sundays' };
const when = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };

export const scheduleWords = s => `${DAYS[s.days] || s.days} at ${s.time}`;

export function routinesHtml(view, esc, { local = true, editing = null } = {}) {
  const list = view.routines || [];
  const row = r => `<li class="cx-row${r.enabled === false ? ' off' : ''}" data-rt="${esc(r.id)}">
    <div class="cx-main"><b>${esc(r.name)}</b> <span class="sub">${esc(scheduleWords(r.schedule))}${r.enabled === false ? ', off' : ''}</span>
      <div class="cx-meta"><code>${esc(r.run.length > 120 ? `${r.run.slice(0, 120)}...` : r.run)}</code>${r.agent ? ` · agent ${esc(r.agent)}` : ''}</div>
      <div class="cx-meta">${r.next ? `Next ${esc(when(r.next))}` : 'Not scheduled'}${r.lastRun ? ` · Last ${esc(when(r.lastRun.at))}: ${r.lastRun.ok ? 'started' : `<span class="warn">${esc(r.lastRun.error || 'did not start')}</span>`}` : ''}</div></div>
    ${local ? `<div class="acts"><button type="button" class="btn" data-rt-run="${esc(r.id)}">Run now</button><button type="button" class="btn" data-rt-edit="${esc(r.id)}">Edit</button></div>` : ''}</li>`;
  const e = editing || { name: '', run: '', agent: '', schedule: { days: 'weekdays', time: '08:30' }, enabled: true };
  const form = local ? `<form class="rt-form" data-rt-form${editing && editing.id ? ` data-id="${esc(editing.id)}"` : ''}>
    <h3 class="cx-h">${editing && editing.id ? 'Edit routine' : 'New routine'}</h3>
    <label>Name <input name="name" maxlength="80" required value="${esc(e.name)}" placeholder="Morning Cloudflare check"></label>
    <label>Run <textarea name="run" rows="2" maxlength="4000" required placeholder="/cloudflare why workshop">${esc(e.run)}</textarea></label>
    <div class="rt-when"><label>Days <select name="days">${Object.entries(DAYS).map(([k, v]) => `<option value="${k}"${e.schedule.days === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Time <input name="time" type="time" required value="${esc(e.schedule.time)}"></label>
      <label>Agent <input name="agent" maxlength="64" value="${esc(e.agent || '')}" placeholder="opencode's default"></label>
      <label class="rt-on"><input name="enabled" type="checkbox"${e.enabled === false ? '' : ' checked'}> On</label></div>
    <p class="sub">A slash command runs that Tandem command; anything else is sent as a prompt. Each run starts a new chat you can read in Chat. A run missed while this computer slept runs when Workshop is back, if it is at most ${esc(view.catchUpHours || 6)} hours late.</p>
    <div class="acts">${editing && editing.id ? `<button type="button" class="btn" data-rt-delete="${esc(editing.id)}">Delete</button><button type="button" class="btn" data-rt-cancel>Cancel</button>` : ''}<button type="submit" class="btn primary">${editing && editing.id ? 'Save' : 'Add routine'}</button></div></form>` : '<p class="sub">Add and change routines from Workshop on this computer.</p>';
  const runs = (view.runs || []).slice(0, 10);
  return `${list.length ? `<ul class="cx-list">${list.map(row).join('')}</ul>` : '<p class="sub">No routines yet.</p>'}${form}
    ${runs.length ? `<h3 class="cx-h">Recent runs</h3><ul class="cf-done">${runs.map(r => `<li>${esc(when(r.at))} · ${esc(r.name)} · ${r.how === 'now' ? 'Run now' : 'scheduled'} · ${r.ok ? 'started in Chat' : `<span class="warn">${esc(r.error || 'did not start')}</span>`}</li>`).join('')}</ul>` : ''}`;
}

/** The routine a form describes. */
export function fromForm(f, id) {
  const v = n => (f.elements[n] ? String(f.elements[n].value || '').trim() : '');
  return { ...(id ? { id } : {}), name: v('name'), run: v('run'), ...(v('agent') ? { agent: v('agent') } : {}), schedule: { days: v('days'), time: v('time') }, enabled: !!(f.elements.enabled && f.elements.enabled.checked) };
}

export function mountRoutines({ ws, card, esc, toast, errText, local }) {
  const sec = card('', 'Tandem runs on a schedule, on this computer, while Workshop is running. Results land in Chat.', 'routines', 10);
  const box = sec.appendChild(document.createElement('div'));
  let view = { routines: [], runs: [] };
  let editing = null;
  const draw = () => { box.innerHTML = routinesHtml(view, esc, { local, editing }); };
  async function load() { try { view = await ws.routines.get(); draw(); } catch (e) { box.innerHTML = `<p class="err">${esc(errText(e))}</p>`; } }
  const save = async list => { view = await ws.routines.put(list); editing = null; draw(); };

  box.addEventListener('click', async e => {
    const run = e.target.closest('[data-rt-run]'), edit = e.target.closest('[data-rt-edit]'), del = e.target.closest('[data-rt-delete]'), cancel = e.target.closest('[data-rt-cancel]');
    try {
      if (run) { run.disabled = true; const r = await ws.routines.run(run.dataset.rtRun); toast(r.ok ? 'Started. Open Chat to follow it.' : r.error, r.ok ? 'success' : 'error'); await load(); }
      else if (edit) { editing = view.routines.find(r => r.id === edit.dataset.rtEdit) || null; draw(); }
      else if (cancel) { editing = null; draw(); }
      else if (del) { await save(view.routines.filter(r => r.id !== del.dataset.rtDelete)); toast('Routine deleted.'); }
    } catch (err) { toast(errText(err), 'error'); if (run) run.disabled = false; }
  });
  box.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target.closest('[data-rt-form]');
    const r = fromForm(f, f.dataset.id);
    const list = f.dataset.id ? view.routines.map(x => (x.id === f.dataset.id ? { ...x, ...r } : x)) : [...view.routines, r];
    try { await save(list.map(({ lastRun, next, ...keep }) => keep)); toast('Saved.', 'success'); } catch (err) { toast(errText(err), 'error'); }
  });
  ws.routines.on(() => load());
  load();
}
