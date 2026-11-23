/* Settings, Cloudflare: change sets and what happened to them (connectors/cloudflare/README.md, Change sets).
   Tandem proposes; a set waits in Approvals (Settings, Connections & approvals), the one place you approve or reject changes,
   and runs only after you approve it there. */

const when = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };

/** The HTML for the list. Pure, so a test can check it. */
export function changesHtml(sets, esc, { open = null } = {}) {
  const waiting = sets.filter(s => s.status === 'waiting');
  const done = sets.filter(s => s.status !== 'waiting').slice(0, 8);
  const steps = s => `<ol class="cf-steps">${(s.steps || []).map((st, i) => {
    const r = s.results && s.results[i];
    const mark = !r ? '' : r.ok ? '<span class="cf-ok">Done</span> ' : r.skipped ? '<span class="cf-skip">Skipped</span> ' : '<span class="cf-fail">Failed</span> ';
    return `<li>${mark}${esc(st.summary)}${r && r.error ? `<div class="cf-err">${esc(r.error)}</div>` : ''}</li>`;
  }).join('')}</ol>`;
  const head = s => `<div class="cf-head"><b>${esc(s.title)}</b><span class="sub">${esc(s.from === 'Tandem' ? 'From Tandem' : 'From you')}${s.item ? ` for ${esc(s.item)}` : ''}, ${esc(when(s.created))}</span></div>${s.why ? `<p class="cf-why">${esc(s.why)}</p>` : ''}`;
  let html = '';
  if (!waiting.length) html += '<p class="sub">Nothing waiting. When Tandem proposes changes, they wait here until you apply them.</p>';
  for (const s of waiting) {
    const problems = (s.steps || []).filter(st => st.problem);
    html += `<div class="cf-set" data-id="${esc(s.id)}">${head(s)}${steps(s)}
      ${problems.length ? `<p class="cf-err">${problems.map(st => esc(st.problem)).join(' ')} Reject it, and ask Tandem for a new one.</p>` : ''}
      <div class="acts"><button type="button" class="btn primary" data-goto-page="approvals">Review in Approvals</button></div></div>`;
  }
  if (done.length) {
    html += `<h3 class="cf-recent">Recent</h3><ul class="cf-done">${done.map(s => `<li><details${open === s.id ? ' open' : ''}><summary><span class="cf-status" data-status="${esc(s.status)}">${esc(s.status === 'applied' ? 'Applied' : s.status === 'failed' ? 'Failed' : 'Rejected')}</span> ${esc(s.title)} <span class="sub">${esc(when(s.decided))}</span></summary>${steps(s)}${s.note ? `<p class="sub">${esc(s.note)}</p>` : ''}</details></li>`).join('')}</ul>`;
    html += '<p class="sub">Every change is also written to <code>cloudflare/log.md</code> in your data folder.</p>';
  }
  return html;
}

/**
 * Draws the card on the Cloudflare page and keeps it current. `full` loads every set's steps (changes.get) so they
 * can be read before Apply.
 */
export function mountCloudflareChanges({ ws, card, esc, toast, errText }) {
  const sec = card('Change sets', 'Tandem proposes changes; nothing happens on Cloudflare until you approve them in Approvals.', 'c-cloudflare', 15);
  sec.classList.add('cf-changes');
  sec.dataset.needsOn = '1';
  const box = sec.appendChild(document.createElement('div'));
  let open = null;

  async function load() {
    try {
      const list = await ws.connectors.call('cloudflare', 'changes.list', {});
      const sets = await Promise.all(list.slice(0, 12).map(s => ws.connectors.call('cloudflare', 'changes.get', { id: s.id }).catch(() => ({ ...s, steps: [] }))));
      box.innerHTML = changesHtml(sets, esc, { open });
    } catch (e) {
      box.innerHTML = `<p class="sub">${esc(errText(e))}</p>`;
    }
  }

  ws.connectors.on('cloudflare', 'changes', () => load());
  ws.connectors.onStatus('cloudflare', () => load());
  load();
  return { load };
}
