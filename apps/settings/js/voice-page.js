/* Settings, Writing (docs/writing.md): three pages, Voice, Audiences and Rules.
   Voice: samples per audience, Build my style guide and the style guide (editable). Rewrite a draft is in Chat
   since Settings 6.4.0: Chat saves your answers in its `writing-feedback` collection and this page applies them
   (shared/voice.js, applyPending). Audiences: caps, rules, shared rules, banned words.
   Rules: what it learned, by status. Saves Settings' `writing` collection meta (voice-model.js); the AI steps go
   through the opencode connector's voice.run and voice.result (read-only agent, needs Hub on). */
import * as V from './voice-model.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errText = e => (e && e.message) || String(e);
const OC = 'opencode';
const POLL_MS = 2000, WAIT_MS = 20 * 60 * 1000; // 20 minutes: a local model on one GPU can take a while (4 before)

export async function mountWriting({ ws, toast, pageEl, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  let env = null, val = V.defaults();
  let busy = '';                 // 'style' | 'rewrite' | 'learn' while an AI step runs
  let showSamples = '';          // audience id whose samples are listed

  const voiceEl = pageEl('writing-voice'), audEl = pageEl('writing-audiences'), rulesEl = pageEl('writing-rules');
  const sec = (el, cls) => { const s = document.createElement('section'); s.className = `card ${cls}`; el.appendChild(s); return s; };
  const rewriteSec = sec(voiceEl, 'wv-rewrite'), samplesSec = sec(voiceEl, 'wv-samples'), styleSec = sec(voiceEl, 'wv-style');
  const audSec = sec(audEl, 'wv-aud'), sharedSec = sec(audEl, 'wv-shared'), rulesSec = sec(rulesEl, 'wv-rules');

  /* ---------- data ---------- */
  async function load() {
    try { env = await ws.data.get(V.COLLECTION); } catch { env = null; }
    if (env && env.schema !== V.SCHEMA) env = null;
    val = V.fromEnvelope(env).value;
    paint();
    await applyChat();
  }
  // Answers from Chat's Rewrite a draft not applied yet: samples, rules and learned changes.
  async function applyChat() {
    let fb = null;
    try { fb = await ws.data.get(V.FEEDBACK, { app: 'chat' }); } catch { return; }
    const items = fb && Array.isArray(fb.items) ? fb.items : [];
    if (V.applyPending(val, items) !== val) await save(v => V.applyPending(v, items));
  }
  async function save(change, msg) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const next = V.toEnvelope(env, change(val));
      try {
        const r = await ws.data.put(V.COLLECTION, next);
        env = Object.assign(next, { rev: r.rev }); val = V.fromEnvelope(env).value;
        await exportVoice();
        if (msg) toast(msg, 'success');
        paint(); return true;
      } catch (err) {
        if (err && err.code === 'conflict' && attempt === 0) { env = err.current || await ws.data.get(V.COLLECTION); val = V.fromEnvelope(env).value; continue; }
        toast(errText(err) || "Couldn't save.", 'error'); return false;
      }
    }
    return false;
  }

  // voice.md in Settings' folder, for Tandem's writer (docs/writing.md). Best effort: a failed write never blocks a save.
  async function exportVoice() {
    const text = V.voiceMd(val);
    if (!text || !ws.files) return;
    try {
      const cur = await ws.files.read(V.VOICE_FILE);
      if (cur && cur.content === text) return;
      await ws.files.write(V.VOICE_FILE, text, cur ? { mtime: cur.mtime } : { create: true });
    } catch { /* written on the next save */ }
  }

  /* ---------- AI steps ---------- */
  async function ai(kind, prompt) {
    busy = kind; paint();
    try {
      const { session } = await ws.connectors.call(OC, 'voice.run', { kind, prompt }, { confirm: true });
      const until = Date.now() + WAIT_MS;
      while (Date.now() < until) {
        await sleep(POLL_MS);
        const r = await ws.connectors.call(OC, 'voice.result', { session });
        if (r.state === 'done') return r.text;
        if (r.state === 'failed') throw new Error(r.error || 'The step failed.');
      }
      throw new Error('That took more than 20 minutes. Check the session in Loom, then try again.');
    } finally { busy = ''; paint(); }
  }
  const aiError = e => {
    const m = errText(e);
    if (/not installed|unknown connector|not_found/i.test(m) && /opencode/i.test(m)) return 'Writing uses opencode. Set it up in Settings, opencode, first.';
    return m;
  };

  /* ---------- paint ---------- */

  function paint() {
    paintRewrite(); paintSamples(); paintStyle(); paintAudiences(); paintShared(); paintRules();
  }

  function paintRewrite() {
    rewriteSec.innerHTML = `<h2>Rewrite a draft</h2>
      <p class="sub">Rewrite a draft is in Chat now, next to your conversations. What you tell it there (Sent as is, I changed it, Didn't use) still teaches this page: new samples and rules show up here.</p>
      <div class="acts left"><button type="button" class="btn primary" data-open-rewrite>Open in Chat</button></div>`;
  }

  function paintSamples() {
    samplesSec.innerHTML = `<h2>Samples</h2>
      <p class="sub">Messages you sent that landed well. 5 to 10 per audience is plenty to start. Paste only your own words: cut quoted replies and signatures, and leave out anything HR-sensitive.</p>
      ${val.audiences.map(a => {
        const list = val.samples[a.id] || [];
        const open = showSamples === a.id;
        return `<div class="wv-aud-samples" data-aud-id="${esc(a.id)}">
          <div class="cfg-row"><b>${esc(a.name)}</b> <span class="pill-tag">${list.length} sample${list.length === 1 ? '' : 's'}</span>
            ${list.length ? `<button type="button" class="btn ghost small" data-show>${open ? 'Hide' : 'View'}</button>` : ''}</div>
          ${open ? `<ul class="wv-list">${list.map(s => `<li><span class="wv-snip">${esc(s.text.slice(0, 240))}${s.text.length > 240 ? '...' : ''}</span>
            ${s.from === 'approved' ? '<span class="pill-tag">sent draft</span>' : ''}
            <button type="button" class="btn ghost small" data-rm-sample="${esc(s.id)}">Remove</button></li>`).join('')}</ul>` : ''}
          <details><summary>Add samples for ${esc(a.name)}</summary>
            <textarea class="cfg-input" rows="8" data-paste aria-label="Samples for ${esc(a.name)}" placeholder="Paste one or more messages. Put a line with --- between messages."></textarea>
            <div class="acts left"><button type="button" class="btn" data-add-samples>Add</button></div>
          </details>
        </div>`;
      }).join('')}`;
  }

  function paintStyle() {
    const n = V.totalSamples(val);
    styleSec.innerHTML = `<h2>Style guide</h2>
      <p class="sub">A one-page description of how you write, made from your samples. Every rewrite reads it, and Tandem's writer uses it when it writes as you (saved as <span class="mono">settings/voice.md</span>). Fix anything that is wrong and save.</p>
      <div class="acts left"><button type="button" class="btn${val.style ? '' : ' primary'}" data-build${!n || busy ? ' disabled' : ''}>${busy === 'style' ? 'Building...' : val.style ? 'Rebuild from samples' : 'Build my style guide'}</button>
        ${n ? '' : '<span class="cfg-help">Add samples first.</span>'}</div>
      <form class="wv-style-form">
        <textarea class="cfg-input" rows="12" data-style aria-label="Style guide" placeholder="Not built yet.">${esc(val.style)}</textarea>
        <div class="acts left"><button class="btn" data-save-style>Save style guide</button></div>
      </form>`;
  }

  function paintAudiences() {
    audSec.innerHTML = `<h2>Audiences</h2>
      <p class="sub">Who you write for. Each has its own samples, a sentence limit and rules.</p>
      ${val.audiences.map(a => `<form class="wv-aud-form" data-aud-id="${esc(a.id)}">
        <div class="cfg-row"><label>Name</label><input class="cfg-input" data-name value="${esc(a.name)}" maxlength="60">
          <label>Most sentences</label><input class="cfg-input" type="number" min="1" max="30" data-cap value="${a.cap}" style="width:5rem"></div>
        <div class="cfg-row"><label>Rules, one per line</label><textarea class="cfg-input" rows="3" data-rules>${esc(a.rules.join('\n'))}</textarea></div>
        <div class="acts left"><button class="btn">Save</button>
          ${val.audiences.length > 1 ? `<button type="button" class="btn ghost small" data-del-aud>Delete</button>` : ''}</div>
      </form>`).join('')}
      <form class="wv-add-aud cfg-row"><input class="cfg-input" data-new-aud placeholder="New audience, like Skip-level follow-up" maxlength="60"><button class="btn">Add audience</button></form>`;
  }

  function paintShared() {
    sharedSec.innerHTML = `<h2>Rules for every audience</h2>
      <form class="wv-shared-form">
        <div class="cfg-row"><label>Rules, one per line</label><textarea class="cfg-input" rows="5" data-shared>${esc(val.shared.join('\n'))}</textarea></div>
        <div class="cfg-row"><label>Banned words, one per line</label><textarea class="cfg-input" rows="5" data-banned>${esc(val.banned.join('\n'))}</textarea></div>
        <p class="cfg-help">Every rewrite is also checked for em dashes, banned words and length. Anything found shows as a warning; the text is never changed for you.</p>
        <div class="acts left"><button class="btn">Save</button></div>
      </form>`;
  }

  function paintRules() {
    const name = id => (val.audiences.find(a => a.id === id) || {}).name || 'Every audience';
    const group = (status, title, sub, acts) => {
      const list = val.rules.filter(r => r.status === status);
      if (!list.length && status === 'rejected') return '';
      return `<h3 class="shead">${title} <span class="pill-tag">${list.length}</span></h3><p class="cfg-help">${sub}</p>
        ${list.length ? `<ul class="wv-list">${list.map(r => `<li data-rule="${esc(r.id)}"><span>${esc(r.text)}</span>
          <span class="pill-tag">${esc(name(r.audience))}</span>${r.reader ? `<span class="pill-tag">${esc(r.reader)}</span>` : ''}
          ${acts.map(([s, l]) => `<button type="button" class="btn ghost small" data-set="${s}">${l}</button>`).join('')}</li>`).join('')}</ul>` : '<p class="state">None</p>'}`;
    };
    rulesSec.innerHTML = `<h2>What it learned</h2>
      <p class="sub">From your feedback on rewrites. A reason you give for not using a draft becomes active right away. A change it sees in your edits is proposed first and becomes active the second time it shows up. Only active and pinned rules are used.</p>
      ${group('proposed', 'Proposed', 'Seen once in your edits.', [['active', 'Approve'], ['rejected', 'Reject']])}
      ${group('active', 'Active', 'Used in every rewrite for its audience.', [['pinned', 'Pin'], ['rejected', 'Reject']])}
      ${group('pinned', 'Pinned', 'Always kept.', [['active', 'Unpin']])}
      ${group('rejected', 'Rejected', 'Kept so it is not proposed again.', [['proposed', 'Restore'], ['delete', 'Delete']])}`;
  }

  /* ---------- events: Rewrite (in Chat) ---------- */
  rewriteSec.addEventListener('click', e => {
    if (e.target.closest('[data-open-rewrite]')) ws.open({ app: 'chat', path: 'rewrite' }).catch(() => {});
  });

  /* ---------- events: Samples and style ---------- */
  samplesSec.addEventListener('click', async e => {
    const box = e.target.closest('[data-aud-id]');
    if (!box) return;
    const aud = box.dataset.audId;
    if (e.target.matches('[data-show]')) { showSamples = showSamples === aud ? '' : aud; paintSamples(); return; }
    if (e.target.matches('[data-rm-sample]')) { await save(v => V.removeSample(v, aud, e.target.dataset.rmSample), 'Sample removed.'); return; }
    if (e.target.matches('[data-add-samples]')) {
      const texts = V.splitSamples(box.querySelector('[data-paste]').value);
      if (!texts.length) { toast('Nothing to add. Paste at least one full message.'); return; }
      const name = (val.audiences.find(a => a.id === aud) || {}).name;
      await save(v => V.addSamples(v, aud, texts), `Added ${texts.length} sample${texts.length === 1 ? '' : 's'} for ${name}.`);
    }
  });
  styleSec.addEventListener('click', async e => {
    if (!e.target.matches('[data-build]')) return;
    if (val.style && !confirm('Replace your style guide with a new one from your samples? Edits you made to it are lost.')) return;
    try {
      const text = (await ai('style', V.stylePrompt(val))).trim();
      await save(v => Object.assign({}, v, { style: text }), 'Style guide built. Read it and fix anything that is off.');
    } catch (err) { toast(aiError(err), 'error'); }
  });
  styleSec.addEventListener('submit', async e => {
    e.preventDefault();
    const style = styleSec.querySelector('[data-style]').value;
    await save(v => Object.assign({}, v, { style }), 'Style guide saved.');
  });

  /* ---------- events: Audiences ---------- */
  audSec.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    if (f.matches('.wv-add-aud')) { const n = f.querySelector('[data-new-aud]').value; if (n.trim()) await save(v => V.addAudience(v, n), 'Audience added.'); return; }
    const id = f.dataset.audId;
    const name = f.querySelector('[data-name]').value.trim(), cap = Number(f.querySelector('[data-cap]').value) || 4, rules = V.lines(f.querySelector('[data-rules]').value);
    if (!name) { toast('Give it a name.'); return; }
    await save(v => Object.assign({}, v, { audiences: v.audiences.map(a => a.id === id ? Object.assign({}, a, { name, cap: Math.max(1, Math.min(30, cap)), rules }) : a) }), 'Saved.');
  });
  audSec.addEventListener('click', async e => {
    if (!e.target.matches('[data-del-aud]')) return;
    const id = e.target.closest('[data-aud-id]').dataset.audId;
    const a = val.audiences.find(x => x.id === id);
    if (!confirm(`Delete ${a.name}? Its samples are deleted too.`)) return;
    await save(v => { const samples = Object.assign({}, v.samples); delete samples[id]; return Object.assign({}, v, { audiences: v.audiences.filter(x => x.id !== id), samples }); }, 'Deleted.');
  });
  sharedSec.addEventListener('submit', async e => {
    e.preventDefault();
    const shared = V.lines(sharedSec.querySelector('[data-shared]').value), banned = V.lines(sharedSec.querySelector('[data-banned]').value);
    await save(v => Object.assign({}, v, { shared, banned }), 'Saved.');
  });

  /* ---------- events: Rules ---------- */
  rulesSec.addEventListener('click', async e => {
    const s = e.target.dataset.set;
    if (!s) return;
    const id = e.target.closest('[data-rule]').dataset.rule;
    await save(v => s === 'delete' ? V.removeRule(v, id) : V.setRuleStatus(v, id, s));
  });

  ws.data.subscribe(V.COLLECTION, async () => {
    if (busy) return;
    try { const fresh = await ws.data.get(V.COLLECTION); if (fresh && fresh.schema === V.SCHEMA && (!env || fresh.rev !== env.rev)) { env = fresh; val = V.fromEnvelope(env).value; paint(); } } catch { /* keep */ }
  });
  ws.data.subscribe(V.FEEDBACK, () => { if (!busy) applyChat(); }, { app: 'chat' });
  await load();
  return { reload: load };
}
