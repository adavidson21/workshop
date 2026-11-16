/* Chat, Rewrite a draft (docs/writing.md): paste what you wrote, get one version in your voice for an audience,
   then say what you did with it (Sent as is, I changed it, Didn't use). Moved here from Settings in Chat 1.1.0.

   Chat 2.2.0: no longer a screen of its own. Rewrite is a mode of New chat, picked like Hub in the composer's agent
   picker (chat.js mounts this element in the New chat pane). Your drafts and their rewrites show as turns, the
   composer stays at the bottom with For and Reader in its bar, and each rewrite has its own Copy and feedback.

   Reads Settings' `writing` collection (the style guide, samples and rules; read only) and the people directory.
   Your answers go in this app's own `writing-feedback` collection; Settings applies them to its samples and rules
   (shared/voice.js, applyPending). Until it does, the pending answers are applied to what this page reads, so a
   reason you give counts on the next rewrite. The AI steps go through the opencode connector's voice.run and
   voice.result (read-only agent). */
import * as V from '../../../shared/voice.js';
import * as D from '../../../shared/people.js';
import { keepFocus } from './thread.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errText = e => (e && e.message) || String(e);
const OC = 'opencode';
const POLL_MS = 2000, WAIT_MS = 4 * 60 * 1000;
const UP = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 19V6M6 11l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

/* `bar` draws chat.js's agent picker (and its popup) into this composer, so switching back to an agent works
   the same as everywhere else in Chat. */
export function startRewrite(ws, { sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let bar = { picks: () => '', pop: () => '' };
  const el = document.createElement('div');
  el.className = 'rw';
  el.setAttribute('aria-label', 'Rewrite a draft');

  let val = V.defaults(), people = [], fbEnv = null, loaded = false, loading = false;
  let busy = '';            // 'rewrite' | 'learn'
  const items = [];         // {id, audience, reader, input, text, warnings, answered, more, error}
  let typed = { input: '', audience: '', reader: '' };
  let nextId = 1;

  async function load() {
    if (loading) return;
    loading = true;
    let env = null;
    try { env = await ws.data.get(V.COLLECTION, { app: 'settings' }); } catch { env = null; }
    try { fbEnv = await ws.data.get(V.FEEDBACK); } catch { fbEnv = null; }
    val = V.applyPending(V.fromEnvelope(env).value, fbEnv && Array.isArray(fbEnv.items) ? fbEnv.items : []);
    try { people = D.active(await ws.people.get(), { kind: 'person' }).sort((a, b) => a.name.localeCompare(b.name)); } catch { people = []; }
    loaded = true; loading = false;
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

  const audId = () => typed.audience || (val.audiences[0] && val.audiences[0].id) || '';
  const audName = id => (val.audiences.find(a => a.id === id) || {}).name || id;
  const personOf = id => people.find(p => p.id === id) || null;
  const audOptions = sel => val.audiences.map(a => `<option value="${esc(a.id)}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
  const readerOptions = sel => '<option value="">Anyone</option>' + people.map(p => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.name)}</option>`).join('');

  function feedbackHtml(it) {
    if (it.answered) return `<p class="hub-meta rw-said">${esc(it.answered)}</p>`;
    const off = busy ? ' disabled' : '';
    const more = it.more === 'edited'
      ? `<div class="rw-more"><textarea class="rw-text" rows="5" data-keep="rw-final:${it.id}" data-rw-final="${it.id}" aria-label="What you sent">${esc(it.final != null ? it.final : it.text)}</textarea>
         <div class="row"><button type="button" class="btn primary" data-fb="edited" data-rw-id="${it.id}"${off}>Save what I sent</button></div></div>`
      : it.more === 'rejected'
        ? `<div class="rw-more"><input class="rw-in" data-keep="rw-reason:${it.id}" data-rw-reason="${it.id}" maxlength="300" aria-label="Why not" placeholder="Why not? Optional, but a reason teaches it the most (like: too formal for Erik)" value="${esc(it.reason || '')}">
         <div class="row"><button type="button" class="btn" data-fb="rejected" data-rw-id="${it.id}"${off}>Done</button></div></div>`
        : '';
    return `<div class="row rw-fb"><span class="hub-meta">What happened?</span>
        <button type="button" class="btn" data-fb="approved" data-rw-id="${it.id}"${off}>Sent as is</button>
        <button type="button" class="btn${it.more === 'edited' ? ' on' : ''}" data-fb="edited-open" data-rw-id="${it.id}"${off}>I changed it</button>
        <button type="button" class="btn ghost${it.more === 'rejected' ? ' on' : ''}" data-fb="rejected-open" data-rw-id="${it.id}"${off}>Didn't use</button></div>${more}`;
  }
  function itemHtml(it, last) {
    const reader = personOf(it.reader);
    const label = `For ${audName(it.audience)}${reader ? ` · ${reader.name}` : ''}`;
    let out = `<div class="turn you rw-you"><span class="who">You</span><div class="tx">${esc(it.input)}</div><span class="you-agent">${esc(label)}</span></div>`;
    if (!it.text && !it.error) return out + (last && busy === 'rewrite' ? '<div class="turn tandem writing"><span class="who">Rewrite</span><div class="tx"><span class="spin" aria-hidden="true"></span> Rewriting...</div></div>' : '');
    if (it.error) return out + `<p class="hub-error">${esc(it.error)}</p>`;
    return out + `<div class="turn tandem rw-turn"><span class="who">Rewrite</span><div class="tx">
        <div class="rw-out">${esc(it.text)}</div>
        ${it.warnings.length ? `<ul class="rw-warn">${it.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        <div class="row rw-acts"><button type="button" class="btn" data-rw-copy="${it.id}">Copy</button></div>
        ${feedbackHtml(it)}</div></div>`;
  }

  function paint() {
    const ready = V.totalSamples(val) > 0;
    const empty = !items.length;
    const note = !loaded ? '<p class="hub-meta">Loading your voice...</p>'
      : ready ? '' : '<p class="rw-note">Add a few samples in Settings, Writing, first, so it knows how you write. <button type="button" class="lnk" data-rw-settings>Open Writing</button></p>';
    const intro = empty
      ? `<h3 class="chat-hello">What do you want to rewrite?</h3><p class="hub-meta">Paste it the way it came out. You get one version in your voice. Nothing is posted.</p>`
      : '';
    const turns = items.map((it, i) => itemHtml(it, i === items.length - 1)).join('');
    const hint = busy === 'rewrite' ? 'Rewriting...' : busy === 'learn' ? 'Looking at what you changed...' : 'Enter rewrites · Shift+Enter new line · Tab agent';
    const html = `<div class="chat-scroll" data-rw-follow><div class="chat-col${empty ? ' chat-start' : ''}">${intro}${note}<div class="turns">${turns}</div></div></div>
      <div class="chat-compose"><div class="chat-col pop-anchor">${bar.pop()}<div class="chat-box">
        <textarea rows="1" data-keep="rw-input" data-rw-input placeholder="Paste your draft" aria-label="Your draft">${esc(typed.input)}</textarea>
        <div class="chat-bar">${bar.picks()}
          <label class="rw-sel">For <select data-aud aria-label="Audience">${audOptions(audId())}</select></label>
          <label class="rw-sel">Reader <select data-reader aria-label="Reader">${readerOptions(typed.reader)}</select></label>
          <span class="grow"></span>
          <button type="button" class="chat-send" data-rw-go title="Rewrite" aria-label="Rewrite"${busy || !typed.input.trim() ? ' disabled' : ''}>${UP}</button>
        </div></div>
        <p class="chat-hint" aria-live="polite">${hint}</p></div></div>`;
    const scroller = el.querySelector('[data-rw-follow]');
    const atEnd = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    const keepTop = scroller && !atEnd ? scroller.scrollTop : null;
    const back = keepFocus(el);
    el.innerHTML = html;
    back();
    grow(el.querySelector('[data-rw-input]'));
    const s = el.querySelector('[data-rw-follow]');
    if (s) s.scrollTop = atEnd ? s.scrollHeight : keepTop;
  }
  function grow(t) { if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 260) + 'px'; }

  async function rewrite() {
    const input = typed.input.trim();
    if (busy) return;
    if (!input) { ws.toast('Paste a draft first.'); return; }
    if (input.length > V.MAX_TEXT) { ws.toast('That draft is too long. Rewrite a shorter part.', { kind: 'error' }); return; }
    const audience = audId(), readerId = typed.reader;
    const it = { id: nextId++, audience, reader: readerId, input, text: '', warnings: [], answered: '', more: '', error: '' };
    items.push(it);
    typed = { ...typed, input: '' };
    try {
      it.text = (await ai('rewrite', V.rewritePrompt(val, { audience, draft: input, reader: V.readerOf(personOf(readerId)) }))).trim();
      it.warnings = V.check(val, audience, it.text);
    } catch (err) { it.error = aiError(err); }
    paint();
  }

  el.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('[data-rw-input]')) {
      const was = !!typed.input.trim();
      typed.input = t.value; grow(t);
      if (was !== !!t.value.trim()) { const b = el.querySelector('[data-rw-go]'); if (b) b.disabled = !!busy || !t.value.trim(); }
    } else if (t.matches('[data-rw-final]')) { const it = items.find(x => x.id === +t.dataset.rwFinal); if (it) it.final = t.value; }
    else if (t.matches('[data-rw-reason]')) { const it = items.find(x => x.id === +t.dataset.rwReason); if (it) it.reason = t.value; }
  });
  el.addEventListener('change', e => {
    if (e.target.matches('[data-aud]')) typed.audience = e.target.value;
    if (e.target.matches('[data-reader]')) typed.reader = e.target.value;
  });
  el.addEventListener('keydown', e => {
    if (!e.target.matches('[data-rw-input]') || e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); rewrite(); }
  });
  el.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-rw-go]')) { rewrite(); return; }
    if (t.matches('[data-rw-settings]')) { ws.open({ app: 'settings', path: 'writing' }).catch(() => {}); return; }
    if (t.dataset.rwCopy != null) {
      const it = items.find(x => x.id === +t.dataset.rwCopy);
      if (!it) return;
      try { await navigator.clipboard.writeText(it.text); ws.toast('Copied.'); } catch { ws.toast("Couldn't copy. Select the text and press Ctrl+C.", { kind: 'warn' }); }
      return;
    }
    const fb = t.dataset.fb;
    const it = fb && items.find(x => x.id === +t.dataset.rwId);
    if (!it) return;
    const person = personOf(it.reader);
    const ctx = { audience: it.audience, reader: person ? person.name : '', draft: it.text };
    if (fb === 'edited-open' || fb === 'rejected-open') {
      const want = fb === 'edited-open' ? 'edited' : 'rejected';
      it.more = it.more === want ? '' : want; paint();
      const box = el.querySelector(`[data-rw-final="${it.id}"],[data-rw-reason="${it.id}"]`); if (box) box.focus();
      return;
    }
    if (fb === 'approved') {
      if (await saveFeedback({ verdict: 'approved', ...ctx })) { it.answered = 'Saved as a sample. Thanks.'; it.more = ''; paint(); }
      return;
    }
    if (fb === 'rejected') {
      const reason = it.reason || '';
      if (await saveFeedback({ verdict: 'rejected', reason, ...ctx })) { it.answered = reason.trim() ? 'Got it. That is a rule now (see Settings, Writing, Rules).' : 'Noted.'; it.more = ''; paint(); }
      return;
    }
    if (fb === 'edited') {
      const final = String(it.final != null ? it.final : it.text).trim();
      if (!final) { ws.toast('Paste what you sent.'); return; }
      it.more = '';
      if (final === it.text.trim()) { if (await saveFeedback({ verdict: 'approved', ...ctx })) { it.answered = 'Same as the draft, so saved as a sample.'; paint(); } return; }
      it.answered = 'Looking at what you changed...';
      paint();
      let learn = null, note = '';
      try {
        const parsed = V.parseLearn(await ai('learn', V.learnPrompt(val, { audience: ctx.audience, draft: ctx.draft, final })));
        learn = V.learnForSave(val, parsed, ctx.audience);
        note = parsed.kind === 'new' ? `Learned a proposed rule: ${parsed.text}` : learn && learn.kind === 'same' ? 'Same change as before, so that rule is active now.' : 'Saved. Nothing new to learn from that change.';
      } catch (err) { note = 'Saved what you sent. Could not look at the change: ' + aiError(err); }
      if (await saveFeedback({ verdict: 'edited', final, learn, ...ctx })) it.answered = note;
      else it.answered = '';
      paint();
    }
  });

  ws.data.subscribe(V.COLLECTION, () => { if (!busy) load(); }, { app: 'settings' });
  paint();

  return {
    el,
    /* chat.js mounted this in New chat (or moved it back): read the voice once, then draw with its picker. */
    shown() { if (!loaded) load(); else paint(); },
    /* chat.js redrew its picker (a popup opened or the agent changed). */
    paint,
    setBar(b) { bar = b; },
    focus() { const box = el.querySelector('[data-rw-input]'); if (box) box.focus(); }
  };
}
