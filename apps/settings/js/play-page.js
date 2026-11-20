/* Settings, Google Play: release sets and what happened to them (connectors/play/README.md, Release sets).
   Tandem (or `workshop play release`) proposes; a set waits in Approvals (Settings, Manager), the one place you
   approve or reject changes, and runs only after you approve it there. Styled like Cloudflare's change sets. */

const when = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };

/** The HTML for the list. Pure, so a test can check it. */
export function releasesHtml(sets, esc, { open = null } = {}) {
  const waiting = sets.filter(s => s.status === 'waiting');
  const done = sets.filter(s => s.status !== 'waiting').slice(0, 8);
  const steps = s => `<ol class="cf-steps">${(s.steps || []).map((st, i) => {
    const r = s.results && s.results[i];
    const mark = !r ? '' : r.ok ? '<span class="cf-ok">Done</span> ' : r.skipped ? '<span class="cf-skip">Not done</span> ' : '<span class="cf-fail">Failed</span> ';
    return `<li>${mark}${esc(st.summary)}${r && r.error ? `<div class="cf-err">${esc(r.error)}</div>` : ''}${r && r.note ? `<div class="sub">${esc(r.note)}</div>` : ''}</li>`;
  }).join('')}</ol>`;
  const head = s => `<div class="cf-head"><b>${esc(s.title)}</b><span class="sub">${esc(s.app || '')}, ${esc(s.from === 'Tandem' ? 'from Tandem' : 'from you')}${s.item ? ` for ${esc(s.item)}` : ''}, ${esc(when(s.created))}</span></div>${s.why ? `<p class="cf-why">${esc(s.why)}</p>` : ''}`;
  let html = '';
  if (!waiting.length) html += '<p class="sub">Nothing waiting. When Tandem (or <code>workshop play release</code>) proposes a release, it waits here until you approve it.</p>';
  for (const s of waiting) {
    const problems = (s.steps || []).filter(st => st.problem);
    html += `<div class="cf-set" data-id="${esc(s.id)}">${head(s)}${steps(s)}
      ${problems.length ? `<p class="cf-err">${problems.map(st => esc(st.problem)).join(' ')} Reject it, and ask for a new one.</p>` : ''}
      <div class="acts"><button type="button" class="btn primary" data-goto-page="approvals">Review in Approvals</button></div></div>`;
  }
  if (done.length) {
    html += `<h3 class="cf-recent">Recent</h3><ul class="cf-done">${done.map(s => `<li><details${open === s.id ? ' open' : ''}><summary><span class="cf-status" data-status="${esc(s.status)}">${esc(s.status === 'applied' ? 'Done' : s.status === 'failed' ? 'Failed' : 'Rejected')}</span> ${esc(s.title)} <span class="sub">${esc(when(s.decided))}</span></summary>${steps(s)}${s.note ? `<p class="sub">${esc(s.note)}</p>` : ''}</details></li>`).join('')}</ul>`;
    html += '<p class="sub">Every change is also written to <code>play/log.md</code> in your data folder.</p>';
  }
  return html;
}

/** Draws the card on the Google Play page and keeps it current. */
export function mountPlayReleases({ ws, card, esc, errText }) {
  const sec = card('Release sets', 'Tandem proposes releases; nothing changes on Google Play until you approve them in Approvals.', 'c-play', 15);
  sec.classList.add('cf-changes');
  sec.dataset.needsOn = '1';
  const box = sec.appendChild(document.createElement('div'));

  async function load() {
    try {
      const list = await ws.connectors.call('play', 'releases.list', {});
      const sets = await Promise.all(list.slice(0, 12).map(s => ws.connectors.call('play', 'releases.get', { id: s.id }).catch(() => ({ ...s, steps: [] }))));
      box.innerHTML = releasesHtml(sets, esc);
    } catch (e) {
      box.innerHTML = `<p class="sub">${esc(errText(e))}</p>`;
    }
  }

  ws.connectors.on('play', 'releases', () => load());
  ws.connectors.onStatus('play', () => load());
  load();
  return { load };
}
