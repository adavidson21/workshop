/* Settings, Manager, Tokens & sign-ins (docs/security.md, Secrets): every token, key and password Workshop uses,
   in one place, so nobody needs a terminal for them.
   - For your connections: each field that needs one, with Add, Replace and Remove.
   - MCP sign-ins: servers that sign in (OAuth), with Sign in and Sign out.
   - Other saved secrets: ones nothing uses now, to remove.
   Values never come back from Workshop: rows show only whether one is saved, where, and until when.
   The HTML builders are pure (test/secrets-page.test.mjs); mountSecrets draws them and keeps them current. */
import { kindWords, openSecretDialog } from './secret-dialog.js';

/** A saved secret's state in words: {text, tone: ok|warn|bad}. */
export function stateOf(s) {
  if (!s || !s.set) return { text: 'Not added', tone: 'bad' };
  const d = typeof s.daysLeft === 'number' ? s.daysLeft : null;
  if (d !== null && d < 0) return { text: `Expired ${s.expires}`, tone: 'bad' };
  if (d !== null && d <= 14) return { text: `Expires in ${d} day${d === 1 ? '' : 's'}`, tone: 'warn' };
  return { text: s.expires ? `Saved, until ${s.expires}` : 'Saved', tone: 'ok' };
}

/** The rows for "For your connections": a variable field is left out when a token field beside it names one. */
export function connectionRows(data) {
  const byName = Object.fromEntries((data.secrets || []).map(s => [s.name, s]));
  const signinSecrets = new Set((data.signins || []).map(s => s.secret).filter(Boolean));
  const prefix = p => p.replace(/\.[^.]+$/, '');
  const uses = (data.uses || []).filter(u => !(u.kind === 'secret' && signinSecrets.has(u.name)));
  return uses.filter(u => !(u.kind === 'env' && uses.some(o => o.connector === u.connector && o.kind === 'secret' && o.name && prefix(o.path) === prefix(u.path))))
    .map(u => {
      const s = u.name ? byName[u.name] : null;
      let st = stateOf(s);
      if (!s && u.kind === 'env' && u.envSet) st = { text: `From the ${u.env} variable`, tone: 'ok' };
      return { ...u, state: st, saved: !!s };
    });
}

/** Saved secrets nothing in Settings uses now. */
export function otherSecrets(data) {
  const used = new Set([...(data.uses || []).map(u => u.name), ...(data.signins || []).map(s => s.secret)].filter(Boolean));
  return (data.secrets || []).filter(s => !used.has(s.name));
}

export function pageHtml(data, esc, { local = true } = {}) {
  const dis = local ? '' : ' disabled';
  const pill = st => `<span class="cx-state sd-state" data-tone="${esc(st.tone)}">${esc(st.text)}</span>`;
  const rows = connectionRows(data);
  const groups = [...new Set(rows.map(r => r.connector))];
  const conn = groups.length ? groups.map(id => {
    const list = rows.filter(r => r.connector === id);
    return `<h3 class="cx-h">${esc(list[0].connectorName)}${list[0].enabled ? '' : ' <span class="sub">(off)</span>'}</h3><ul class="cx-list">${list.map(r => {
      const w = kindWords(r.secretKind);
      const key = r.kind === 'env' ? `env="${esc(r.env)}"` : `name="${esc(r.name || '')}"`;
      return `<li class="cx-row"><div class="cx-main"><b>${esc(r.title)}</b> ${pill(r.state)}
        <div class="cx-meta">${r.kind === 'env' ? `Goes by <code>${esc(r.env)}</code>` : r.name ? `Saved as <code>${esc(r.name)}</code>` : 'No name yet'}</div></div>
        <span class="sd-acts">${r.saved ? `<button type="button" class="btn ghost" data-sd-remove="${esc(r.name)}"${dis}>Remove</button>` : ''}
        <button type="button" class="btn${r.saved ? '' : ' primary'}" data-sd-add data-sd-kind="${esc(r.secretKind)}" data-sd-${key} data-sd-connector="${esc(r.connector)}" data-sd-path="${esc(r.path)}" data-sd-replace="${r.saved ? '1' : ''}"${dis}>${esc(r.saved ? w.replace : w.add)}</button></span></li>`;
    }).join('')}</ul>`;
  }).join('') : '<p class="sub">No connection needs a token yet. Turn on a connector (Azure DevOps, GitHub, Cloudflare, Google Play) and it shows here.</p>';

  const si = (data.signins || []);
  const signins = si.length ? `<ul class="cx-list">${si.map(s => `<li class="cx-row"><div class="cx-main"><b>${esc(s.name)}</b> ${pill(s.signedIn ? { text: 'Signed in', tone: 'ok' } : { text: 'Not signed in', tone: 'bad' })}
      <div class="cx-meta">Signs in at <code>${esc(s.host)}</code></div></div>
      <span class="sd-acts">${s.signedIn ? `<button type="button" class="btn ghost" data-sd-signout="${esc(s.id)}"${dis}>Sign out</button>` : ''}
      <button type="button" class="btn${s.signedIn ? '' : ' primary'}" data-sd-signin="${esc(s.id)}"${dis}>${s.signedIn ? 'Sign in again' : 'Sign in'}</button></span></li>`).join('')}</ul>` : '';

  const other = otherSecrets(data);
  const others = other.length ? `<ul class="cx-list">${other.map(s => `<li class="cx-row"><div class="cx-main"><code>${esc(s.name)}</code> ${pill(stateOf(s))}${s.note ? `<div class="cx-meta">${esc(s.note)}</div>` : ''}</div>
      <span class="sd-acts"><button type="button" class="btn ghost" data-sd-remove="${esc(s.name)}"${dis}>Remove</button></span></li>`).join('')}</ul>` : '';

  return {
    connections: conn,
    signins,
    others,
    note: local ? '' : '<p class="sub warn">Open Workshop on this computer to add or remove tokens. This page only shows them.</p>'
  };
}

export function mountSecrets({ card, esc, agentCall, toast, errText, local, setField, onChanged = () => {} }) {
  const store = { name: "this computer's secret store" };
  const main = card('Tokens & sign-ins', '', 'secrets', 10);
  const sub = document.createElement('p'); sub.className = 'sub'; main.appendChild(sub);
  const body = document.createElement('div'); main.appendChild(body);
  const signCard = card('MCP sign-ins', 'MCP servers that sign in with your account instead of a token.', 'secrets', 20);
  const signBody = document.createElement('div'); signCard.appendChild(signBody);
  const otherCard = card('Other saved secrets', 'Saved on this computer, but no connection uses them now.', 'secrets', 30);
  const otherBody = document.createElement('div'); otherCard.appendChild(otherBody);

  async function load() {
    let data;
    try { data = await agentCall('GET', '/api/secrets'); } catch (e) { body.innerHTML = `<p class="err">${esc(errText(e))}</p>`; return; }
    store.name = data.store || store.name;
    sub.innerHTML = data.store
      ? `Workshop keeps these in ${esc(data.store)}, never in a file, and never shows them again. Connectors read them when they need them; Tandem never sees them.`
      : `This computer has no secret store Workshop can use (${esc(data.platform || '')}).`;
    const h = pageHtml(data, esc, { local });
    body.innerHTML = h.note + h.connections;
    signBody.innerHTML = h.signins; signCard.hidden = !h.signins;
    otherBody.innerHTML = h.others; otherCard.hidden = !h.others;
  }

  async function onClick(e) {
    const add = e.target.closest('[data-sd-add]');
    const rm = e.target.closest('[data-sd-remove]');
    const sin = e.target.closest('[data-sd-signin]');
    const sout = e.target.closest('[data-sd-signout]');
    try {
      if (add) {
        const d = add.dataset;
        const r = await openSecretDialog({ kind: d.sdKind || 'token', name: d.sdName || d.sdConnector || '', env: d.sdEnv || '', store: store.name, replace: d.sdReplace === '1', esc },
          b => agentCall('POST', '/api/secrets', b));
        if (!r) return;
        // A token field with no name yet: save the name into the connector's settings too.
        if (!d.sdEnv && !d.sdName && d.sdConnector) await setField(d.sdConnector, d.sdPath, r.name);
        toast('Saved', 'success');
        await load(); onChanged();
      } else if (rm) {
        if (!confirm(`Remove ${rm.dataset.sdRemove} from ${store.name}? Connections that use it stop working until you add a new one.`)) return;
        await agentCall('DELETE', `/api/secrets/${encodeURIComponent(rm.dataset.sdRemove)}`);
        toast('Removed', 'success');
        await load(); onChanged();
      } else if (sin) {
        const tab = window.open('about:blank', '_blank');
        try {
          const r = await agentCall('POST', `/api/signin/mcp/${encodeURIComponent(sin.dataset.sdSignin)}`);
          if (tab) tab.location.href = r.url; else window.open(r.url, '_blank');
          toast(`Finish signing in on ${r.host || 'the server'}'s page.`);
        } catch (err) { if (tab) tab.close(); throw err; }
      } else if (sout) {
        if (!confirm('Sign out? Its tools stop working until you sign in again.')) return;
        await agentCall('POST', `/api/signout/mcp/${encodeURIComponent(sout.dataset.sdSignout)}`);
        toast('Signed out', 'success');
        await load(); onChanged();
      }
    } catch (err) { toast(errText(err), 'error'); }
  }

  for (const el of [body, signBody, otherBody]) el.addEventListener('click', onClick);
  window.addEventListener('message', e => { if (e.data && e.data.workshop === 'signed-in') { toast('Signed in', 'success'); load(); onChanged(); } });
  window.addEventListener('focus', () => load());
  return load();
}
