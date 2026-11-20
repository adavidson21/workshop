/* Settings: the Add token / Replace dialog (docs/security.md, Secrets). One dialog for every kind of secret:
     token     paste it (shown as dots), with an optional expiry date
     password  type it twice (an Android keystore password)
     key-file  choose the JSON key file Google Cloud gave you; it is read here and sent once, then forgotten
   It sends the value once to Workshop on this computer (POST /api/secrets), which keeps it in this computer's
   secret store (macOS Keychain, Windows Credential Manager, Linux Secret Service). Nothing is kept in the page:
   the fields are cleared and the dialog removed when it closes. */

const NAME = /^[a-z][a-z0-9-]{0,39}$/;

/** The words for a kind: {add, replace, what}. */
export function kindWords(kind) {
  if (kind === 'password') return { add: 'Add password', replace: 'Replace password', what: 'password' };
  if (kind === 'key-file') return { add: 'Add key file', replace: 'Replace key file', what: 'key file' };
  return { add: 'Add token', replace: 'Replace token', what: 'token' };
}

/** The dialog's inner HTML. `env`: the variable a token stands for (its name is then fixed). Pure, for tests. */
export function dialogHtml({ kind = 'token', name = '', env = '', title = '', store = '', replace = false }, esc) {
  const w = kindWords(kind);
  const nameRow = env
    ? `<p class="sub">Saved as <code>${esc(env)}</code> for Workshop's connectors.</p>`
    : `<label class="sd-row"><span>Name</span><input class="cfg-input mono" data-sd-name value="${esc(name)}" placeholder="github" ${replace ? 'readonly' : ''} autocomplete="off" spellcheck="false"></label>`;
  const value = kind === 'key-file'
    ? '<label class="sd-row"><span>Key file</span><input type="file" accept=".json,application/json" data-sd-file></label><p class="sub">Delete the file after this. Workshop keeps what it needs.</p>'
    : kind === 'password'
      ? '<label class="sd-row"><span>Password</span><input type="password" class="cfg-input" data-sd-value autocomplete="new-password"></label><label class="sd-row"><span>Again</span><input type="password" class="cfg-input" data-sd-again autocomplete="new-password"></label>'
      : '<label class="sd-row"><span>Token</span><input type="password" class="cfg-input mono" data-sd-value autocomplete="off" spellcheck="false" placeholder="Paste it here"></label><label class="sd-row"><span>Expires</span><input type="date" class="cfg-input" data-sd-expires></label><p class="sub">Optional. Workshop warns you two weeks before.</p>';
  return `<form method="dialog" class="sd-form">
    <h2>${esc(title || (replace ? w.replace : w.add))}</h2>
    <p class="sub">It goes straight into ${esc(store || "this computer's secret store")}. Workshop never shows it again, and it is never saved in a file.</p>
    ${nameRow}${value}
    <div class="acts"><span class="msg" aria-live="polite"></span><button type="button" class="btn" data-sd-cancel>Cancel</button><button class="btn primary">Save</button></div>
  </form>`;
}

/**
 * Opens the dialog. Resolves {name} once saved, or null when cancelled. `save(body)` is the POST to /api/secrets.
 * opts: {kind, name, env, title, store, replace, esc}.
 */
export function openSecretDialog(opts, save) {
  const esc = opts.esc;
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sd';
    dlg.innerHTML = dialogHtml(opts, esc);
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    const msg = dlg.querySelector('.msg');
    let done = null;
    const close = r => { done = r; form.reset(); dlg.close(); };
    dlg.addEventListener('close', () => { dlg.remove(); resolve(done); });
    dlg.querySelector('[data-sd-cancel]').addEventListener('click', () => close(null));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const name = opts.env ? '' : (dlg.querySelector('[data-sd-name]').value || '').trim();
      if (!opts.env && !NAME.test(name)) { msg.textContent = 'Name: lowercase letters, digits and -, like github.'; return; }
      const body = { kind: opts.kind || 'token', ...(opts.env ? { env: opts.env } : { name }) };
      if (body.kind === 'key-file') {
        const f = dlg.querySelector('[data-sd-file]').files[0];
        if (!f) { msg.textContent = 'Choose the key file.'; return; }
        if (f.size > 64 * 1024) { msg.textContent = 'That file is too big to be a key file.'; return; }
        body.value = await f.text();
      } else {
        body.value = dlg.querySelector('[data-sd-value]').value;
        if (body.kind === 'password' && body.value !== dlg.querySelector('[data-sd-again]').value) { msg.textContent = 'The two do not match.'; return; }
        const ex = dlg.querySelector('[data-sd-expires]');
        if (ex && ex.value) body.expires = ex.value;
      }
      if (!body.value) { msg.textContent = `Paste the ${kindWords(body.kind).what} first.`; return; }
      msg.textContent = 'Saving...';
      form.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try {
        const r = await save(body);
        body.value = '';
        close({ name: r.name || name, status: r.secret || { set: true } });
      } catch (err) {
        body.value = '';
        form.querySelectorAll('button').forEach(b => { b.disabled = false; });
        msg.textContent = (err && err.message) || 'Could not save it.';
      }
    });
    dlg.showModal();
    (dlg.querySelector('[data-sd-value]') || dlg.querySelector('[data-sd-file]') || dlg.querySelector('[data-sd-name]')).focus();
  });
}
