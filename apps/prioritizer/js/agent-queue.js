/* Docket: the agent queue (Docket 12.0.0; Workshop project docs claude/workshop-vision-v2.md and
   claude/work-items-source-v1-plan.md). Docket is the queue of what Tandem's builds need from you, plus PR reviews.

   - Agents on Today: Loom's `agents` summary card (slate.summary, Loom 6.2.0): answer Tandem, teach a gap, approve
     a plan, publish a PR. Rows only, read from Loom; clicking one opens it in Loom. Docket stores nothing for them.
   - Personal tasks: Workshop's Settings shows Docket's `personalTasks` switch (app.json settings, Workshop
     docs/app-settings.md), off by default. Off: tasks that are not PR reviews are hidden everywhere in Docket (the
     shared `shown` filter in state.js); nothing is deleted, and turning it on brings them all back. On Docket's own
     site there is no switch and personal tasks always show.

   agentRowsOf and personalShownWith are pure (test/agent-queue.test.mjs). */

const SETTING = 'personalTasks';
let env = null;
let personal = true; // Docket's own site, or a Workshop that does not know the switch: everything shows
let linked = false;

/** The agents card's rows from Loom's summary envelope: [{id, title, note, route, flag}] (at most 50). */
export function agentRowsOf(e) {
  if (!e || e.schema !== 'slate.summary' || !Array.isArray(e.items)) return [];
  const card = e.items.find(c => c && c.id === 'agents' && c.kind === 'list' && Array.isArray(c.rows));
  if (!card) return [];
  const str = v => (typeof v === 'string' ? v : '');
  return card.rows.filter(r => r && typeof r.id === 'string' && str(r.title)).slice(0, 50)
    .map(r => ({ id: r.id, title: str(r.title).slice(0, 200), note: str(r.note).slice(0, 80), route: str(r.route).slice(0, 200), flag: r.flag === 'urgent' ? 'urgent' : '' }));
}

/** Whether a task shows with personal tasks on or off: PR reviews always do. */
export const personalShownWith = (on, t) => !!on || !!(t && t.pr);
export const personalShown = t => personalShownWith(personal, t);
export const personalOn = () => personal;
export const agentRows = () => agentRowsOf(env);
export const agentsLinked = () => linked;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The Agents section on Today (above Reviews). Empty when Loom has nothing, or outside Workshop. */
export function agentsHtml() {
  const rows = agentRows();
  if (!linked || !rows.length) return '';
  return `<section class="treviews tagents" aria-label="What your builds need from you"><header class="tblk-h"><b>Agents</b><span class="tbn">${rows.length} need${rows.length === 1 ? 's' : ''} you</span></header>
    <div class="rows">${rows.map(r => `<div class="row agent${r.flag ? ' urgent' : ''}"><button class="lnk agent-open" data-agent-open="${esc(r.route)}" title="Open it in Loom"><b>${esc(r.note)}</b> <span>${esc(r.title)}</span></button></div>`).join('')}</div></section>`;
}

/** One line when personal tasks are off, so a hidden list is never a surprise. */
export function personalOffHtml(hidden) {
  if (personal || !hidden) return '';
  return `<p class="hint agent-hint">Docket shows your agent queue and PR reviews. ${hidden} personal task${hidden === 1 ? ' is' : 's are'} hidden; turn on Personal tasks under Docket in Workshop Settings, Apps, to see ${hidden === 1 ? 'it' : 'them'}.</p>`;
}

/** Inside Workshop: read Loom's summary and the Personal tasks switch, now and on every change. */
export function startAgentQueue(ws, embedded, onChange = () => {}) {
  if (!ws || !embedded) return;
  linked = true;
  const read = () => ws.data.get('summary', { app: 'slate' }).then(e => { env = e; onChange(); }, () => {});
  read();
  try { ws.data.subscribe('summary', read, { app: 'slate' }); } catch { /* no data backend */ }
  const setFrom = values => {
    const v = values && values[SETTING];
    const next = typeof v === 'boolean' ? v : false;
    if (next !== personal) { personal = next; onChange(); }
  };
  (async () => {
    try {
      if (!ws.appSettings || !(await ws.appSettings.declared()).some(d => d.id === SETTING)) return;
      const all = await ws.data.get('app-settings', { app: 'settings' }).catch(() => null);
      const item = all && Array.isArray(all.items) ? all.items.find(x => x && x.id === 'prioritizer') : null;
      setFrom(item && item.values);
      ws.appSettings.subscribe(setFrom);
    } catch { /* settings cannot be read: everything shows */ }
  })();
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('[data-agent-open]');
    if (!b) return;
    e.preventDefault();
    ws.open({ app: 'slate', path: b.getAttribute('data-agent-open') || '' }).catch(() => {});
  });
}
