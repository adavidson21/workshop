/* Settings, Connections manager (docs/security.md, Approvals and Activity):
   - All connections: every connector and MCP server, what it reaches, where its token is (and when it expires),
     when it was last used, and what agents may do with it.
   - Approvals: changes agents asked for, waiting for you; your always-allow rules.
   - Activity: the activity log.
   The HTML builders are pure (test/connections-page.test.mjs); mountConnections draws them and keeps them current. */

const when = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
const ago = (iso, now = Date.now()) => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return 'never';
  const m = Math.round((now - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const BY = { you: 'You', agent: 'Tandem', rule: 'Always-allow rule', routine: 'A routine' };

/** The hosts a connector's settings point at: every http(s) address in its config. */
export function hostsOf(config) {
  const out = new Set();
  const walk = v => {
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) { try { out.add(new URL(v).host); } catch { /* not an address */ } }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(config);
  return [...out];
}

/** One row per connector: {id, name, enabled, state, message, hosts, tokens: [{label, ok, note}], lastUsed, agentReads, agentAsks}. */
export function connectionRows(list, views, lastUsed) {
  return list.map(c => {
    const v = views[c.id] || {};
    const tokens = [];
    for (const [n, s] of Object.entries(v.env || {})) tokens.push({ label: `Variable ${n}`, ok: !!(s && s.set), note: s && s.set ? 'set' : 'not set' });
    for (const [n, s] of Object.entries(v.secrets || {})) {
      const d = s && typeof s.daysLeft === 'number' ? s.daysLeft : null;
      tokens.push({ label: `Secret ${n}`, ok: !!(s && s.set) && !(d !== null && d < 0), note: !s || !s.set ? 'not saved on this computer' : d !== null && d < 0 ? `expired ${s.expires}` : d !== null && d <= 14 ? `expires in ${d} days` : `in ${s.store || 'your secret store'}${s.expires ? `, until ${s.expires}` : ''}` });
    }
    const actions = c.actions || [];
    return {
      id: c.id, name: c.name, enabled: !!c.enabled, state: (c.status && c.status.state) || 'stopped', message: (c.status && c.status.message) || '',
      hosts: hostsOf(v.config), tokens, lastUsed: lastUsed[c.id] || null,
      agentReads: actions.filter(a => a.agent === true && !a.write).length, agentAsks: actions.filter(a => a.agent === 'ask' && a.write).length
    };
  });
}

export function overviewHtml(rows, servers, esc, { now = Date.now() } = {}) {
  const row = r => `<li class="cx-row${r.enabled ? '' : ' off'}">
    <div class="cx-main"><b>${esc(r.name)}</b> <span class="cx-state" data-state="${esc(r.enabled ? r.state : 'off')}">${esc(r.enabled ? r.state : 'off')}</span>
      ${r.message ? `<div class="sub">${esc(r.message)}</div>` : ''}
      <div class="cx-meta">${r.hosts.length ? `Reaches ${r.hosts.map(h => `<code>${esc(h)}</code>`).join(', ')}` : 'Stays on this computer'}${r.tokens.length ? ` · ${r.tokens.map(t => `<span class="${t.ok ? '' : 'warn'}">${esc(t.label)}: ${esc(t.note)}</span>`).join(' · ')}` : ''}</div>
      <div class="cx-meta">Last used ${esc(ago(r.lastUsed, now))}${r.agentReads || r.agentAsks ? ` · Tandem may ${[r.agentReads ? `read (${r.agentReads})` : '', r.agentAsks ? `ask to change (${r.agentAsks})` : ''].filter(Boolean).join(' and ')}` : ' · Not open to Tandem'}</div>
    </div>
    <button type="button" class="btn" data-goto-page="c-${esc(r.id)}" data-cx-open="${esc(r.id)}">Settings</button></li>`;
  const srv = s => `<li class="cx-row${s.enabled === false ? ' off' : ''}"><div class="cx-main"><b>${esc(s.name)}</b> <span class="cx-state" data-state="${esc(s.ok === false ? 'error' : s.enabled === false ? 'off' : 'ready')}">${esc(s.enabled === false ? 'off' : s.ok === false ? 'error' : 'ready')}</span>
      <div class="cx-meta">Reaches <code>${esc(s.host)}</code>${s.tokenSecret ? ` · Secret ${esc(s.tokenSecret)}` : ' · No token'}${typeof s.tools === 'number' ? ` · ${s.tools} tools, ${s.readOnly || 0} read-only` : ''}</div>
      ${s.error ? `<div class="sub warn">${esc(s.error)}</div>` : ''}</div></li>`;
  return `<ul class="cx-list">${rows.map(row).join('')}</ul>
    <h3 class="cx-h">MCP servers</h3>
    ${servers.length ? `<ul class="cx-list">${servers.map(srv).join('')}</ul>` : '<p class="sub">None yet. Tandem uses them through Workshop, and never sees their tokens.</p>'}
    <div class="acts left"><button type="button" class="btn" data-goto-page="c-mcp" data-cx-open="mcp">Add an MCP server</button></div>`;
}

export function approvalsHtml(list, rules, esc, { local = true } = {}) {
  const waiting = list.filter(a => a.status === 'waiting');
  const done = list.filter(a => a.status !== 'waiting').slice(0, 15);
  const scopeWords = a => (a.scopes && a.scopes.length ? a.scopes.join(', ') : 'any use');
  const one = a => `<div class="ap-set" data-id="${esc(a.id)}" data-digest="${esc(a.digest || '')}">
      <div class="ap-head"><b>${esc(a.title)}</b><span class="sub">${esc(BY[a.by] || 'You')} asked, ${esc(when(a.requested))} · ${esc(a.connectorName)}: ${esc(a.actionTitle)}</span></div>
      <ul class="ap-lines">${(a.lines || []).map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      ${a.problem ? `<p class="cf-err">${esc(a.problem)}</p>` : ''}
      ${local && !a.problem ? `<label class="ap-always"><input type="checkbox" data-ap-always> Always allow ${esc(a.connectorName)} to ${esc(String(a.actionTitle || '').toLowerCase())} for ${esc(scopeWords(a))}</label>` : ''}
      <div class="acts"><span class="msg" aria-live="polite"></span>
        <button type="button" class="btn" data-ap-reject="${esc(a.id)}">Reject</button>
        <button type="button" class="btn primary" data-ap-approve="${esc(a.id)}"${a.problem || !a.digest ? ' disabled' : ''}>Approve</button></div></div>`;
  let html = waiting.length ? waiting.map(one).join('') : '<p class="sub">Nothing waiting. When Tandem asks to change something outside this computer, it waits here.</p>';
  html += `<h3 class="cx-h">Always allow</h3>`;
  html += rules.length
    ? `<ul class="cx-list">${rules.map(r => `<li class="cx-row"><div class="cx-main">${esc(r.label || `${r.connector}: ${r.action}`)} <span class="sub">for ${esc(r.scopes && r.scopes.length ? r.scopes.join(', ') : 'any use')}, since ${esc(when(r.created))}</span></div>${local ? `<button type="button" class="btn" data-ap-unrule="${esc(r.id)}">Remove</button>` : ''}</li>`).join('')}</ul>`
    : '<p class="sub">No rules. Tick "Always allow" when you approve something you never want to be asked about again.</p>';
  if (!local) html += '<p class="sub">Add or remove rules from Workshop on this computer.</p>';
  if (done.length) {
    html += `<h3 class="cx-h">Recent</h3><ul class="cf-done">${done.map(a => `<li><details><summary><span class="cf-status" data-status="${esc(a.status === 'approved' ? 'applied' : a.status)}">${esc(a.status === 'approved' ? 'Approved' : a.status === 'failed' ? 'Failed' : 'Rejected')}</span> ${esc(a.title)} <span class="sub">${esc(when(a.decided))}</span></summary><ul class="ap-lines">${(a.lines || []).map(l => `<li>${esc(l)}</li>`).join('')}</ul>${a.error ? `<p class="cf-err">${esc(a.error)}</p>` : ''}${a.note ? `<p class="sub">${esc(a.note)}</p>` : ''}</details></li>`).join('')}</ul>`;
  }
  return html;
}

export function activityHtml(entries, esc) {
  if (!entries.length) return '<p class="sub">Nothing yet. Every change outside this computer, every call Tandem makes and every approval shows here.</p>';
  const kind = e => ({ write: 'Changed', read: 'Read', request: 'Asked to change', reject: 'Rejected' })[e.kind] || e.kind;
  return `<table class="cx-table"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Connection</th><th></th></tr></thead><tbody>${entries.map(e => `<tr${e.ok === false ? ' class="bad"' : ''}>
    <td>${esc(when(e.at))}</td><td>${esc(BY[e.by] || e.by)}</td><td>${esc(kind(e))}: <code>${esc(e.action)}</code>${e.summary ? ` <span class="sub">${esc(e.summary)}</span>` : ''}</td>
    <td>${esc(e.connector)}</td><td>${e.ok === false ? `<span class="warn">${esc(e.error || 'failed')}</span>` : e.approval ? `<span class="sub">${esc(e.approval)}</span>` : ''}</td></tr>`).join('')}</tbody></table>
    <p class="sub">Also in <code>connections/activity/</code> in your data folder, one file a month.</p>`;
}

/** Draws the three pages and keeps them current. */
export function mountConnections({ ws, card, esc, toast, errText, local }) {
  const ov = card('', 'Everything Workshop reaches outside this computer. Tokens live in this computer\'s secret store or a variable, never in Workshop\'s settings.', 'outside', 10);
  const ovBox = ov.appendChild(document.createElement('div'));
  const ap = card('', 'Changes Tandem asked for. Nothing outside this computer changes until you approve it here.', 'approvals', 10);
  const apBox = ap.appendChild(document.createElement('div'));
  const ac = card('', 'The newest first: changes made outside, calls from Tandem, rules and routines, and your decisions. Never what was sent.', 'activity', 10);
  ac.insertAdjacentHTML('beforeend', '<div class="acts left cx-filter"><select data-ac-by aria-label="Who"><option value="">Anyone</option><option value="agent">Tandem</option><option value="you">You</option><option value="rule">Rules</option><option value="routine">Routines</option></select></div>');
  const acBox = ac.appendChild(document.createElement('div'));

  async function loadOverview() {
    try {
      const [list, act] = await Promise.all([ws.connectors.list(), ws.activity.recent({ limit: 1 }).catch(() => ({ lastUsed: {} }))]);
      const views = {};
      await Promise.all(list.map(async c => { try { views[c.id] = await ws.connectors.getConfig(c.id); } catch { views[c.id] = {}; } }));
      let servers = [];
      const mcp = list.find(c => c.id === 'mcp');
      const cfgServers = (views.mcp && views.mcp.config && Array.isArray(views.mcp.config.servers)) ? views.mcp.config.servers : [];
      let live = [];
      if (mcp && mcp.enabled && mcp.status && mcp.status.state === 'ready') { try { live = await ws.connectors.call('mcp', 'servers.list', {}); } catch { live = []; } }
      servers = cfgServers.map(s => { const l = live.find(x => x.id === s.id) || {}; let host = ''; try { host = new URL(s.url).host; } catch { host = s.url; } return { ...s, host, ...l }; });
      ovBox.innerHTML = overviewHtml(connectionRows(list.filter(c => c.id !== 'mcp' || c.enabled), views, act.lastUsed || {}), servers, esc);
    } catch (e) { ovBox.innerHTML = `<p class="err">${esc(errText(e))}</p>`; }
  }
  async function loadApprovals() {
    try {
      const [{ approvals }, { rules }] = await Promise.all([ws.approvals.list(), ws.approvals.rules()]);
      apBox.innerHTML = approvalsHtml(approvals, rules, esc, { local });
    } catch (e) { apBox.innerHTML = `<p class="err">${esc(errText(e))}</p>`; }
  }
  async function loadActivity() {
    try {
      const by = ac.querySelector('[data-ac-by]').value;
      const { entries } = await ws.activity.recent({ limit: 150, by: by || undefined });
      acBox.innerHTML = activityHtml(entries, esc);
    } catch (e) { acBox.innerHTML = `<p class="err">${esc(errText(e))}</p>`; }
  }

  apBox.addEventListener('click', async e => {
    const yes = e.target.closest('[data-ap-approve]'), no = e.target.closest('[data-ap-reject]'), un = e.target.closest('[data-ap-unrule]');
    if (un) {
      un.disabled = true;
      try { await ws.approvals.removeRule(un.dataset.apUnrule); toast('Rule removed. Tandem will ask again.'); } catch (err) { toast(errText(err), 'error'); }
      return loadApprovals();
    }
    if (!yes && !no) return;
    const set = (yes || no).closest('.ap-set');
    const msg = set.querySelector('.msg');
    set.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      if (yes) {
        msg.textContent = 'Running it...';
        const always = !!(set.querySelector('[data-ap-always]') || {}).checked;
        // Confirmed by this click, with the digest of exactly what is on screen.
        await ws.approvals.decide(set.dataset.id, { approve: true, digest: set.dataset.digest, always });
        toast(always ? 'Approved, and it will not ask again for this.' : 'Approved and done.', 'success');
      } else {
        await ws.approvals.decide(set.dataset.id, { approve: false });
        toast('Rejected. Nothing changed.');
      }
    } catch (err) {
      msg.textContent = errText(err);
      set.querySelectorAll('button').forEach(b => { b.disabled = false; });
      return;
    }
    loadApprovals(); loadActivity();
  });
  ac.querySelector('[data-ac-by]').addEventListener('change', loadActivity);

  ws.approvals.on(() => { loadApprovals(); loadActivity(); });
  loadOverview(); loadApprovals(); loadActivity();
  return { loadOverview, loadApprovals, loadActivity };
}
