/* Chat, Rewrite a draft (docs/writing.md): paste what you wrote, get one version in your voice for an audience,
   then say what you did with it (Sent as is, I changed it, Didn't use). Moved here from Settings in Chat 1.1.0.

   Reads Settings' `writing` collection (the style guide, samples and rules; read only) and the people directory.
   Your answers go in this app's own `writing-feedback` collection; Settings applies them to its samples and rules
   (shared/voice.js, applyPending). Until it does, the pending answers are applied to what this page reads, so a
   reason you give counts on the next rewrite. The AI steps go through the opencode connector's voice.run and
   voice.result (read-only agent). */
import * as V from '../../../shared/voice.js';
import * as D from '../../../shared/people.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errText = e => (e && e.message) || String(e);
const OC = 'opencode';
const POLL_MS = 2000, WAIT_MS = 4 * 60 * 1000;

export function startRewrite(ws, { onClose = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const el = document.createElement('section');
  el.className = 'rw';
  el.setAttribute('aria-label', 'Rewrite a draft');
  el.hidden = true;

  let val = V.defaults(), people = [], fbEnv = null, loaded = false;
  let busy = '';            // 'rewrite' | 'learn'
  let draft = null;         // {audience, reader, input, text, warnings, answered}
  let typed = { input: '', audience: '', reader: '' };
  let more = '';            // 'edited' | 'rejected' while its box is open

  async function load() {
    let env = null;
    try { env = await ws.data.get(V.COLLECTION, { app: 'settings' }); } catch { env = null; }
    try { fbEnv = await ws.data.get(V.FEEDBACK); } catch { fbEnv = null; }
    val = V.applyPending(V.fromEnvelope(env).value, fbEnv && Array.isArray(fbEnv.items) ? fbEnv.items : []);
    try { people = D.active(await ws.people.get(), { kind: 'person' }).sort((a, b) => a.name.localeCompare(b.name)); } catch { people = []; }
    loaded = true;
    paint();
  }

  async function saveFeedback(input) {
    const item = V.feedbackItem(input);
    for (let attempt = 0; attempt < 2; attempt++) {
      const base = fbEnv && fbEnv.schema === 'chat.' + V.FEEDBACK ? fbEnv : { schema: 'chat.' + V.FEEDBACK, version: 1, rev: 0, items: [], deleted: {} };
      // Keep the newest 200 answers: Settings has applied older ones long ago.
      const next = Object.assign({}, base, { items: (base.items || []).concat(item).slice(-200) });
      try {
        const r = await ws.data.put(V.FEEDBACK, next);
        fbEnv = Object.assign(next, { rev: r.rev });
        val = V.applyPending(val, [item]);
        return true;
      } catch (err) {
        if (err && err.code === 'conflict' && attempt === 0) { fbEnv = err.current || await ws.data.get(V.FEEDBACK); continue; }
        ws.toast(errText(err) || "Couldn't save.", { kind: 'error' }); return false;
      }
    }
    return false;
  }

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
      throw new Error('That took more than 4 minutes. Try again.');
    } finally { busy = ''; paint(); }
  }
  const aiError = e => {
    const m = errText(e);
    if (/not installed|unknown connector|not_found/i.test(m) && /opencode/i.test(m)) return 'Rewrite uses opencode. Set it up in Settings, opencode, first.';
    return m;
  };

  const audOptions = sel => val.audiences.map(a => `<option value="${esc(a.id)}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
  const readerOptions = sel => '<option value="">Anyone</option>' + people.map(p => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.name)}</option>`).join('');

  function paint() {
    const ready = V.totalSamples(val) > 0;
    const d = draft || typed;
    const moreHtml = more === 'edited'
      ? `<textarea class="rw-text" rows="6" data-final aria-label="What you sent">${esc(draft.text)}</textarea>
         <div class="row"><button type="button" class="btn primary" data-fb="edited">Save what I sent</button></div>`
      : more === 'rejected'
        ? `<input class="rw-in" data-reason maxlength="300" aria-label="Why not" placeholder="Why not? Optional, but a reason teaches it the most (like: too formal for Erik)">
         <div class="row"><button type="button" class="btn" data-fb="rejected">Done</button></div>`
        : '';
    el.innerHTML = `<header class="chat-top rw-top"><button type="button" class="btn ghost" data-rw-close>Back to chats</button><h2>Rewrite a draft</h2></header>
      <div class="rw-col">
        <p class="hub-meta">Paste what you wrote, the way it came out. You get back one version in your voice for that audience. Nothing is sent anywhere but your opencode, and nothing is posted.</p>
        ${!loaded ? '<p class="hub-meta">Loading your voice...</p>' : ready ? '' : '<p class="rw-note">Add a few samples in Settings, Writing, first, so it knows how you write. <button type="button" class="lnk" data-rw-settings>Open Writing</button></p>'}
        <form class="rw-form">
          <div class="rw-pick"><label>For <select data-aud>${audOptions(d.audience || val.audiences[0].id)}</select></label>
            <label>Reader <select data-reader>${readerOptions(d.reader || '')}</select></label></div>
          <textarea class="rw-text" rows="7" data-input aria-label="Your draft" placeholder="Paste your draft here">${esc(d.input || '')}</textarea>
          <div class="row"><button class="btn primary" data-go${busy ? ' disabled' : ''}>${busy === 'rewrite' ? 'Rewriting...' : 'Rewrite'}</button></div>
        </form>
        ${d.text ? `<div class="rw-out">
          <h3>In your voice</h3>
          <textarea class="rw-text" rows="7" readonly data-out aria-label="Rewritten draft">${esc(d.text)}</textarea>
          ${d.warnings.length ? `<ul class="rw-warn">${d.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
          <div class="row"><button type="button" class="btn" data-copy>Copy</button></div>
          ${d.answered ? `<p class="hub-meta">${esc(d.answered)}</p>` : `<p class="hub-meta">Then tell it what happened. This is how it learns.</p>
          <div class="row rw-fb">
            <button type="button" class="btn" data-fb="approved"${busy ? ' disabled' : ''}>Sent as is</button>
            <button type="button" class="btn${more === 'edited' ? ' on' : ''}" data-fb="edited-open"${busy ? ' disabled' : ''}>I changed it</button>
            <button type="button" class="btn ghost${more === 'rejected' ? ' on' : ''}" data-fb="rejected-open"${busy ? ' disabled' : ''}>Didn't use</button>
          </div>
          ${moreHtml ? `<div class="rw-more">${moreHtml}</div>` : ''}`}
        </div>` : ''}
      </div>`;
  }

  el.addEventListener('input', e => { if (!draft && e.target.matches('[data-input]')) typed.input = e.target.value; });
  el.addEventListener('change', e => {
    if (e.target.matches('[data-aud]')) { typed.audience = e.target.value; if (draft) draft.audience = e.target.value; }
    if (e.target.matches('[data-reader]')) { typed.reader = e.target.value; if (draft) draft.reader = e.target.value; }
  });
  el.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const input = f.querySelector('[data-input]').value.trim();
    const audience = f.querySelector('[data-aud]').value, readerId = f.querySelector('[data-reader]').value;
    if (!input) { ws.toast('Paste a draft first.'); return; }
    if (input.length > V.MAX_TEXT) { ws.toast('That draft is too long. Rewrite a shorter part.', { kind: 'error' }); return; }
    const person = people.find(p => p.id === readerId);
    draft = { audience, reader: readerId, input, text: '', warnings: [], answered: '' };
    typed = { input: '', audience, reader: readerId };
    more = '';
    try {
      const text = (await ai('rewrite', V.rewritePrompt(val, { audience, draft: input, reader: V.readerOf(person) }))).trim();
      draft = Object.assign({}, draft, { text, warnings: V.check(val, audience, text) });
    } catch (err) { ws.toast(aiError(err), { kind: 'error' }); }
    paint();
  });
  el.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-rw-close]')) { onClose(); return; }
    if (t.matches('[data-rw-settings]')) { ws.open({ app: 'settings', path: 'writing' }).catch(() => {}); return; }
    if (t.matches('[data-copy]')) {
      try { await navigator.clipboard.writeText(draft.text); ws.toast('Copied.'); } catch { el.querySelector('[data-out]').select(); ws.toast('Press Ctrl+C to copy.'); }
      return;
    }
    const fb = t.dataset.fb;
    if (!fb || !draft) return;
    const person = people.find(p => p.id === draft.reader);
    const ctx = { audience: draft.audience, reader: person ? person.name : '', draft: draft.text };
    if (fb === 'edited-open' || fb === 'rejected-open') {
      more = fb === 'edited-open' ? 'edited' : 'rejected'; paint();
      const box = el.querySelector('[data-final],[data-reason]'); if (box) box.focus();
      return;
    }
    if (fb === 'approved') {
      if (await saveFeedback({ verdict: 'approved', ...ctx })) { draft.answered = 'Saved as a sample. Thanks.'; more = ''; paint(); }
      return;
    }
    if (fb === 'rejected') {
      const reason = (el.querySelector('[data-reason]') || {}).value || '';
      if (await saveFeedback({ verdict: 'rejected', reason, ...ctx })) { draft.answered = reason.trim() ? 'Got it. That is a rule now (see Settings, Writing, Rules).' : 'Noted.'; more = ''; paint(); }
      return;
    }
    if (fb === 'edited') {
      const final = ((el.querySelector('[data-final]') || {}).value || '').trim();
      if (!final) { ws.toast('Paste what you sent.'); return; }
      more = '';
      if (final === draft.text.trim()) { if (await saveFeedback({ verdict: 'approved', ...ctx })) { draft.answered = 'Same as the draft, so saved as a sample.'; paint(); } return; }
      draft.answered = 'Looking at what you changed...';
      paint();
      let learn = null, note = '';
      try {
        const parsed = V.parseLearn(await ai('learn', V.learnPrompt(val, { audience: ctx.audience, draft: ctx.draft, final })));
        learn = V.learnForSave(val, parsed, ctx.audience);
        note = parsed.kind === 'new' ? `Learned a proposed rule: ${parsed.text}` : learn && learn.kind === 'same' ? 'Same change as before, so that rule is active now.' : 'Saved. Nothing new to learn from that change.';
      } catch (err) { note = 'Saved what you sent. Could not look at the change: ' + aiError(err); }
      if (await saveFeedback({ verdict: 'edited', final, learn, ...ctx })) draft.answered = note;
      else draft.answered = '';
      paint();
    }
  });

  ws.data.subscribe(V.COLLECTION, () => { if (!busy) load(); }, { app: 'settings' });

  return {
    el,
    show(on) { el.hidden = !on; if (on) { load(); const box = el.querySelector('[data-input]'); if (box && !draft) setTimeout(() => box.focus(), 0); } },
    get shown() { return !el.hidden; }
  };
}
