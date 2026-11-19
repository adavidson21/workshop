/* Settings, Cloudflare: change sets waiting for you, with Apply and Reject, and what happened to the recent ones
   (connectors/cloudflare/README.md, Change sets). Tandem proposes; only a click here (or in Needs you, which links
   here) changes anything on Cloudflare. Reads and writes go through the connector only. */

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
    const blocked = s.ok === false || !s.digest;
    html += `<div class="cf-set" data-id="${esc(s.id)}" data-digest="${esc(s.digest || '')}">${head(s)}${steps(s)}
      ${problems.length ? `<p class="cf-err">${problems.map(st => esc(st.problem)).join(' ')} Reject it, and ask Tandem for a new one.</p>` : ''}
      <div class="acts"><span class="msg" aria-live="polite"></span>
        <button type="button" class="btn" data-cf-reject="${esc(s.id)}">Reject</button>
        <button type="button" class="btn primary" data-cf-apply="${esc(s.id)}"${blocked ? ' disabled' : ''}>Apply ${(s.steps || []).length} change${(s.steps || []).length === 1 ? '' : 's'} on Cloudflare</button></div></div>`;
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
  const sec = card('Changes waiting for you', 'Tandem proposes changes; nothing happens on Cloudflare until you click Apply.', 'c-cloudflare', 15);
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

  box.addEventListener('click', async e => {
    const apply = e.target.closest('[data-cf-apply]');
    const reject = e.target.closest('[data-cf-reject]');
    if (!apply && !reject) return;
    const id = (apply || reject).dataset[apply ? 'cfApply' : 'cfReject'];
    const set = box.querySelector(`.cf-set[data-id="${CSS.escape(id)}"]`);
    const msg = set && set.querySelector('.msg');
    set?.querySelectorAll('button').forEach(b => { b.disabled = true; });
    if (msg) msg.textContent = apply ? 'Applying...' : '';
    try {
      if (apply) {
        // A write: confirm comes only from this click, on a button that says what will happen.
        // With the fingerprint of the steps on screen, so an edit to the set since then is refused.
        const r = await ws.connectors.call('cloudflare', 'changes.apply', { id, digest: set.dataset.digest }, { confirm: true });
        const okCount = r.results.filter(x => x.ok).length;
        toast(r.status === 'applied' ? `Applied ${okCount} change${okCount === 1 ? '' : 's'} on Cloudflare.` : `Stopped after ${okCount} of ${r.results.length}. See what failed below.`, r.status === 'applied' ? 'success' : 'error');
      } else {
        await ws.connectors.call('cloudflare', 'changes.reject', { id });
        toast('Rejected. Nothing changed on Cloudflare.');
      }
      open = id;
    } catch (err) {
      if (msg) msg.textContent = errText(err);
      set?.querySelectorAll('button').forEach(b => { b.disabled = false; });
      return;
    }
    await load();
  });

  ws.connectors.on('cloudflare', 'changes', () => load());
  ws.connectors.onStatus('cloudflare', () => load());
  load();
  return { load };
}
