/* Settings, Writing (docs/writing.md): three pages, Voice, Audiences and Rules.
   Voice: samples per audience, Build my style guide, the style guide (editable), and Rewrite a draft with
   one-click feedback (Sent as is, I changed it, Didn't use). Audiences: caps, rules, shared rules, banned words.
   Rules: what it learned, by status. Saves Settings' `writing` collection meta (voice-model.js); the AI steps go
   through the opencode connector's voice.run and voice.result (read-only agent, needs Hub on). */
import * as V from './voice-model.js';
import * as D from '../../../shared/people.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errText = e => (e && e.message) || String(e);
const OC = 'opencode';
const POLL_MS = 2000, WAIT_MS = 4 * 60 * 1000;

export async function mountWriting({ ws, toast, pageEl, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  let env = null, val = V.defaults(), people = [];
  let busy = '';                 // 'style' | 'rewrite' | 'learn' while an AI step runs
  let draft = null;              // {audience, reader, input, text, warnings, answered}
  let showSamples = '';          // audience id whose samples are listed
  let typed = { input: '', audience: '', reader: '' }; // the Rewrite form as typed, kept across repaints

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
  }
  async function save(change, msg) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const next = V.toEnvelope(env, change(val));
      try {
        const r = await ws.data.put(V.COLLECTION, next);
        env = Object.assign(next, { rev: r.rev }); val = V.fromEnvelope(env).value;
        if (msg) toast(msg, 'success');
        paint(); return true;
      } catch (err) {
        if (err && err.code === 'conflict' && attempt === 0) { env = err.current || await ws.data.get(V.COLLECTION); val = V.fromEnvelope(env).value; continue; }
        toast(errText(err) || "Couldn't save.", 'error'); return false;
      }
    }
    return false;
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
      throw new Error('That took more than 4 minutes. Check the session in Dispatch, then try again.');
    } finally { busy = ''; paint(); }
  }
  const aiError = e => {
    const m = errText(e);
    if (/not installed|unknown connector|not_found/i.test(m) && /opencode/i.test(m)) return 'Writing uses opencode. Set it up in Settings, opencode, first.';
    return m;
  };

  /* ---------- paint ---------- */
  const audOptions = sel => val.audiences.map(a => `<option value="${esc(a.id)}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
  const readerOptions = sel => `<option value="">Anyone</option>` + people.map(p => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.name)}</option>`).join('');

  function paint() {
    paintRewrite(); paintSamples(); paintStyle(); paintAudiences(); paintShared(); paintRules();
  }

  function paintRewrite() {
    const ready = V.totalSamples(val) > 0;
    const d = draft || typed;
    rewriteSec.innerHTML = `<h2>Rewrite a draft</h2>
      <p class="sub">Paste what you wrote, the way it came out. You get back one version in your voice for that audience. Nothing is sent anywhere but your opencode, and nothing is posted.</p>
      ${ready ? '' : '<p class="cfg-help">Add a few samples below first, so it knows how you write.</p>'}
      <form class="wv-rw">
        <div class="cfg-row"><label for="wvAud">For</label><select id="wvAud" class="cfg-input" data-aud>${audOptions(d.audience || val.audiences[0].id)}</select>
          <label for="wvReader">Reader</label><select id="wvReader" class="cfg-input" data-reader>${readerOptions(d.reader || '')}</select></div>
        <textarea class="cfg-input wv-text" rows="7" data-input aria-label="Your draft" placeholder="Paste your draft here">${esc(d.input || '')}</textarea>
        <div class="acts left"><button class="btn primary" data-go${busy ? ' disabled' : ''}>${busy === 'rewrite' ? 'Rewriting...' : 'Rewrite'}</button></div>
      </form>
      ${d.text ? `<div class="wv-out">
        <h3 class="shead">In your voice</h3>
        <textarea class="cfg-input wv-text" rows="7" readonly data-out aria-label="Rewritten draft">${esc(d.text)}</textarea>
        ${d.warnings.length ? `<ul class="wv-warn">${d.warnings.map(w => `<li class="warn-text">${esc(w)}</li>`).join('')}</ul>` : ''}
        <div class="acts left"><button type="button" class="btn" data-copy>Copy</button></div>
        ${d.answered ? `<p class="sub">${esc(d.answered)}</p>` : `<p class="sub">Then tell it what happened. This is how it learns.</p>
        <div class="acts left wv-fb">
          <button type="button" class="btn" data-fb="approved"${busy ? ' disabled' : ''}>Sent as is</button>
          <button type="button" class="btn" data-fb="edited-open"${busy ? ' disabled' : ''}>I changed it</button>
          <button type="button" class="btn ghost" data-fb="rejected-open"${busy ? ' disabled' : ''}>Didn't use</button>
        </div>
        <div class="wv-more" data-more hidden></div>`}
      </div>` : ''}`;
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
      <p class="sub">A one-page description of how you write, made from your samples. Every rewrite reads it. Fix anything that is wrong and save.</p>
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

  /* ---------- events: Rewrite ---------- */
  rewriteSec.addEventListener('input', e => { if (!draft && e.target.matches('[data-input]')) typed.input = e.target.value; });
  rewriteSec.addEventListener('change', e => {
    if (e.target.matches('[data-aud]')) { typed.audience = e.target.value; if (draft) draft.audience = e.target.value; }
    if (e.target.matches('[data-reader]')) { typed.reader = e.target.value; if (draft) draft.reader = e.target.value; }
  });
  rewriteSec.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const input = f.querySelector('[data-input]').value.trim();
    const audience = f.querySelector('[data-aud]').value, readerId = f.querySelector('[data-reader]').value;
    if (!input) { toast('Paste a draft first.'); return; }
    if (input.length > V.MAX_TEXT) { toast('That draft is too long. Rewrite a shorter part.', 'error'); return; }
    const person = people.find(p => p.id === readerId);
    draft = { audience, reader: readerId, input, text: '', warnings: [], answered: '' };
    typed = { input: '', audience, reader: readerId };
    try {
      const text = (await ai('rewrite', V.rewritePrompt(val, { audience, draft: input, reader: V.readerOf(person) }))).trim();
      draft = Object.assign({}, draft, { text, warnings: V.check(val, audience, text) });
    } catch (err) { toast(aiError(err), 'error'); }
    paint();
  });
  rewriteSec.addEventListener('click', async e => {
    const t = e.target;
    if (t.matches('[data-copy]')) {
      try { await navigator.clipboard.writeText(draft.text); toast('Copied.'); } catch { rewriteSec.querySelector('[data-out]').select(); toast('Press Ctrl+C to copy.'); }
      return;
    }
    const fb = t.dataset.fb;
    if (!fb || !draft) return;
    const more = rewriteSec.querySelector('[data-more]');
    const person = people.find(p => p.id === draft.reader);
    const ctx = { audience: draft.audience, reader: person ? person.name : '', draft: draft.text };
    if (fb === 'edited-open') {
      more.hidden = false;
      more.innerHTML = `<textarea class="cfg-input wv-text" rows="6" data-final aria-label="What you sent">${esc(draft.text)}</textarea>
        <div class="acts left"><button type="button" class="btn primary" data-fb="edited">Save what I sent</button></div>`;
      more.querySelector('textarea').focus();
      return;
    }
    if (fb === 'rejected-open') {
      more.hidden = false;
      more.innerHTML = `<input class="cfg-input" data-reason maxlength="300" placeholder="Why not? Optional, but a reason teaches it the most (like: too formal for Erik)">
        <div class="acts left"><button type="button" class="btn" data-fb="rejected">Done</button></div>`;
      more.querySelector('input').focus();
      return;
    }
    if (fb === 'approved') {
      if (await save(v => V.applyFeedback(v, Object.assign({ verdict: 'approved' }, ctx)))) { draft.answered = 'Saved as a sample. Thanks.'; paintRewrite(); }
      return;
    }
    if (fb === 'rejected') {
      const reason = (more.querySelector('[data-reason]') || {}).value || '';
      if (await save(v => V.applyFeedback(v, Object.assign({ verdict: 'rejected', reason }, ctx)))) { draft.answered = reason.trim() ? 'Got it. That is a rule now (see Rules).' : 'Noted.'; paintRewrite(); }
      return;
    }
    if (fb === 'edited') {
      const final = ((more.querySelector('[data-final]') || {}).value || '').trim();
      if (!final) { toast('Paste what you sent.'); return; }
      if (final === draft.text.trim()) { if (await save(v => V.applyFeedback(v, Object.assign({ verdict: 'approved' }, ctx)))) { draft.answered = 'Same as the draft, so saved as a sample.'; paintRewrite(); } return; }
      if (!(await save(v => V.applyFeedback(v, Object.assign({ verdict: 'edited', final }, ctx))))) return;
      draft.answered = 'Saved what you sent as a sample. Looking at what you changed...';
      paintRewrite();
      try {
        const parsed = V.parseLearn(await ai('learn', V.learnPrompt(val, { audience: ctx.audience, draft: ctx.draft, final })));
        await save(v => V.applyLearn(v, parsed, ctx));
        draft.answered = parsed.kind === 'new' ? `Learned a proposed rule: ${parsed.text}` : parsed.kind === 'same' ? 'Same change as before, so that rule is active now.' : 'Saved. Nothing new to learn from that change.';
      } catch (err) { draft.answered = 'Saved what you sent. Could not look at the change: ' + aiError(err); }
      paintRewrite();
    }
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
  try { people = D.active(await ws.people.get(), { kind: 'person' }).sort((a, b) => a.name.localeCompare(b.name)); } catch { people = []; }
  await load();
  return { reload: load };
}
