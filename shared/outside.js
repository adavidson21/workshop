/* Outside writes: the one look for any action that changes something outside this computer, today Azure DevOps
   (the ADO connector's workitem.update and workitem.create) and a git remote (the opencode connector's push).
   Everything else in Workshop stays on this computer, so it gets no mark.

   The rule for apps:
   - A button whose action changes something outside carries outsideMark(system) in its label, before the click.
   - The action never runs from that click alone: it shows outsideConfirmHtml (in the app's own dialog) or
     confirmOutside (its own dialog), which names the system, what changes, and carries the mark on the button that
     sends it. Only that confirm's click sends `confirm: true` to the connector.
   - Anything opt-in inside another dialog (a checkbox such as "also assign in ADO") starts unchecked and carries
     the mark, and the dialog shows outsideBanner while it is checked.

   HTML strings, every text escaped. The styles are added to the page once, on import (no DOM in Node tests).
   shared/test/outside.test.mjs. */

export const SYSTEMS = Object.freeze({
  ado: Object.freeze({ short: 'ADO', name: 'Azure DevOps' }),
  git: Object.freeze({ short: 'git', name: 'the git remote' })
});

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sys = (system) => SYSTEMS[system] || SYSTEMS.ado;
const key = (system) => SYSTEMS[system] ? system : 'ado';

// An arrow leaving a box: this goes out.
const ICON = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5h4.5V7"/><path d="M13.5 2.5 7.5 8.5"/><path d="M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/></svg>';

/** The mark for a button or label: "changes ADO". Screen readers hear "(changes Azure DevOps)". */
export function outsideMark(system = 'ado') {
  const s = sys(system);
  return `<span class="out-mark" data-out="${key(system)}" title="Changes ${esc(s.name)}">${ICON}<span aria-hidden="true">${esc(s.short)}</span><span class="out-sr"> (changes ${esc(s.name)})</span></span>`;
}

/** The line at the top of every outside confirm: what system this changes. `text` follows it (plain text). */
export function outsideBanner(system = 'ado', text = 'Nothing is sent until you confirm.', { cls = '' } = {}) {
  const s = sys(system);
  return `<p class="out-banner${cls ? ' ' + esc(cls) : ''}" data-out="${key(system)}" role="note">${ICON}<span><strong>Changes ${esc(s.name)}.</strong>${text ? ' ' + esc(text) : ''}</span></p>`;
}

/**
 * The confirm, as a <form method="dialog"> for an app's own <dialog>.
 *   system  'ado' or 'git'
 *   title   the question, e.g. "Resolve #123 in Azure DevOps?"
 *   body    plain text under it (new lines kept)
 *   items   plain text lines listed under the body, e.g. "#123 Fix login"
 *   ok      the send button's label; it gets the mark
 *   cls     extra classes for the form (an app's dialog class, e.g. 'dlg')
 * The Cancel button is type="button" with data-act="cancel"; the send button is type="submit" value="ok".
 */
export function outsideConfirmHtml({ system = 'ado', title, body = '', items = [], ok = 'Send', cls = '' } = {}) {
  const list = (items || []).filter(x => x != null && String(x) !== '');
  return `<form method="dialog" class="out-confirm${cls ? ' ' + esc(cls) : ''}" data-form="outside" data-out="${key(system)}">
    <h2>${esc(title || `Change ${sys(system).name}?`)}</h2>
    ${outsideBanner(system)}
    ${body ? `<p class="out-body">${esc(body)}</p>` : ''}
    ${list.length ? `<ul class="out-items">${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <div class="acts out-acts"><button type="button" class="btn" data-act="cancel" value="cancel">Cancel</button><button type="submit" class="btn primary" value="ok" data-out-ok>${esc(ok)} ${outsideMark(system)}</button></div>
  </form>`;
}

/**
 * The confirm in its own modal dialog, for apps with none of their own. Resolves true only when the send button
 * is clicked; Cancel, Escape and closing resolve false. Same options as outsideConfirmHtml.
 */
export function confirmOutside(opts = {}, doc = globalThis.document) {
  return new Promise((resolve) => {
    if (!doc || !doc.body) return resolve(false);
    const dlg = doc.createElement('dialog');
    dlg.className = 'out-dialog';
    dlg.innerHTML = outsideConfirmHtml(opts);
    let yes = false;
    const form = dlg.querySelector('form');
    form.addEventListener('submit', (e) => { e.preventDefault(); yes = true; dlg.close(); });
    form.addEventListener('click', (e) => { if (e.target.closest('[data-act=cancel]')) dlg.close(); });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(yes); }, { once: true });
    doc.body.appendChild(dlg);
    dlg.showModal();
    // Focus Cancel, so Enter alone never sends.
    const cancel = form.querySelector('[data-act=cancel]');
    if (cancel) cancel.focus();
  });
}

/* Styles. Theme variables only (shared/themes.css), so every theme and app looks the same. */
export const CSS = `
.out-mark{display:inline-flex;align-items:center;gap:.22rem;margin-left:.15rem;padding:0 .38rem;border-radius:999px;font-family:var(--mono);font-size:.68rem;font-weight:500;line-height:1.3rem;letter-spacing:.02em;white-space:nowrap;vertical-align:middle;color:var(--ink);background:var(--warn-soft);border:1px solid color-mix(in srgb,var(--warn) 50%,transparent)}
.out-mark svg{width:11px;height:11px;flex:none;color:var(--warn)}
.btn.primary .out-mark,.btn.danger .out-mark{color:var(--on-accent);background:color-mix(in srgb,var(--on-accent) 16%,transparent);border-color:color-mix(in srgb,var(--on-accent) 50%,transparent)}
.btn.primary .out-mark svg,.btn.danger .out-mark svg{color:inherit}
.out-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.out-banner{display:flex;gap:.5rem;align-items:flex-start;margin:.6rem 0;padding:.55rem .7rem;border-radius:var(--r-sm,6px);background:var(--warn-soft);border:1px solid color-mix(in srgb,var(--warn) 40%,transparent);color:var(--ink);font-size:.86rem;line-height:1.45}
.out-banner svg{flex:none;width:15px;height:15px;margin-top:.15rem;color:var(--warn)}
.out-confirm .out-body{white-space:pre-line;margin:.5rem 0}
.out-confirm .out-items{margin:.4rem 0;padding-left:1.2rem;max-height:14rem;overflow:auto}
.out-confirm .out-acts{display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem}
dialog.out-dialog{border:1px solid var(--line);border-radius:var(--r-md,8px);background:var(--surface);color:var(--ink);padding:1.1rem 1.25rem;box-shadow:var(--shadow-lg);max-width:min(34rem,92vw)}
dialog.out-dialog::backdrop{background:color-mix(in srgb,#000 30%,transparent)}
dialog.out-dialog h2{font-family:var(--serif);font-size:1.15rem;font-weight:600;margin:0 0 .3rem}
`;

/** Adds the styles to a document once. Runs on import in a page; safe to call again. */
export function addOutsideStyles(doc = globalThis.document) {
  if (!doc || !doc.head || doc.querySelector('style[data-outside]')) return;
  const st = doc.createElement('style');
  st.dataset.outside = '';
  st.textContent = CSS;
  doc.head.appendChild(st);
}

addOutsideStyles();
