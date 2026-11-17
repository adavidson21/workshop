/* Settings, Knowledge (docs/knowledge.md): the Glossary, Repo map and Checks tabs. Products is products-page.js.

   Settings writes its own collections only: `glossary` (settings.glossary, shared/glossary.js) and `repos`
   (settings.repos, shared/knowledge.js: what each repo is, Keep it up to date, sections kept from an imported map).
   The repo map itself is a file in the workspace, so it goes through the opencode connector (knowledge.map.read,
   knowledge.map.write, knowledge.repos). Product notes are read from Folio's folder, read only. */
import * as P from '../../../shared/products.js';
import * as G from '../../../shared/glossary.js';
import * as K from '../../../shared/knowledge.js';
import * as D from '../../../shared/people.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errText = e => (e && e.message) || String(e);
const OC = 'opencode';
const qh = (id, text) => (globalThis.WorkshopTheme?.hints ? globalThis.WorkshopTheme.hints.html(id, text) : '');
const when = ms => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Draws the three tabs. pageEl(id) gives a page's element. Returns {afterSave(), refresh()}: Products calls
 * afterSave after a save, so the repo map is written when Keep it up to date is on.
 */
export async function mountKnowledge({ ws, toast, pageEl }) {
  const glEl = pageEl('glossary'), mapEl = pageEl('repo-map'), ckEl = pageEl('checks');
  let products = [], productsAll = [], people = [];
  let glEnv = null, glRows = null, glDirty = false;
  let repEnv = null;
  let oc = { ok: false, why: '' };     // can the connector read and write the workspace?
  let info = null, map = null, notes = new Map();
  let plan = null;                     // an import being previewed
  let preview = false, busy = '';

  /* ---------- reading ---------- */
  async function readProducts() {
    try { const e = await ws.data.get(P.COLLECTION); productsAll = P.readable(e) ? P.list(e) : []; } catch { productsAll = []; }
    products = productsAll.filter(p => !p.archived);
  }
  async function readGlossary() {
    try { glEnv = await ws.data.get(G.COLLECTION); } catch { glEnv = null; }
    if (!G.readable(glEnv)) glEnv = { unreadable: glEnv.version };
  }
  async function readRepos() {
    try { repEnv = await ws.data.get(K.REPOS); } catch { repEnv = null; }
    if (!K.reposReadable(repEnv)) repEnv = null;
  }
  async function readPeople() { try { people = D.active(await ws.people.get(), { kind: 'person' }); } catch { people = []; } }
  async function readWorkspace() {
    info = null; map = null;
    if (ws.backend !== 'agent') { oc = { ok: false, why: 'agent' }; return; }
    try {
      info = (await ws.connectors.call(OC, 'knowledge.repos')).repos || [];
      map = await ws.connectors.call(OC, 'knowledge.map.read');
      oc = { ok: true, why: '' };
    } catch (e) { oc = { ok: false, why: errText(e) }; }
  }
  async function readNotes() {
    notes = new Map();
    await Promise.all(products.map(async p => {
      try { const f = await ws.files.read(P.notePath(p), { app: 'notes' }); if (f && typeof f.content === 'string') notes.set(p.slug, f.content); } catch { /* no note */ }
    }));
  }
  const words = () => (glEnv && !glEnv.unreadable ? G.list(glEnv) : []);
  const repoRows = () => K.reposList(repEnv);
  const meta = () => K.reposMeta(repEnv);

  /* ---------- writing Settings' own collections: read, change, stamp, put; again on a conflict ---------- */
  async function saveEnv(collection, blank, readable, change) {
    for (let attempt = 0; ; attempt++) {
      const stored = await ws.data.get(collection);
      if (!readable(stored)) throw new Error('Saved by a newer Workshop. Update Workshop to change it.');
      const before = stored || blank();
      const next = change(JSON.parse(JSON.stringify(before)));
      const after = ws.data.stamp(before, next);
      try { await ws.data.put(collection, after); return after; }
      catch (e) { if (!(e && e.code === 'conflict') || attempt >= 4) throw e; }
    }
  }
  const saveRepos = change => saveEnv(K.REPOS, K.reposBlank, K.reposReadable, change).then(e => { repEnv = e; return e; });

  /* ---------- the repo map ---------- */
  function mapText() {
    return K.buildRepoMap({ products, glossary: words(), repos: repoRows(), info: info || [], previous: map && map.exists ? map.text : '', people, extra: meta().extra });
  }
  async function writeMap({ quiet = false } = {}) {
    if (!oc.ok) throw new Error('Set up opencode (workspace folder) to write the repo map.');
    const r = await ws.connectors.call(OC, 'knowledge.map.write', { text: mapText() }, { confirm: true });
    await saveRepos(env => ({ ...env, meta: { ...(env.meta || {}), writtenAt: Date.now() } }));
    map = await ws.connectors.call(OC, 'knowledge.map.read');
    if (!quiet || r.kept) toast(r.kept ? `Repo map written. Your hand-written file is kept beside it as ${K.KEPT_FILE}.` : 'Repo map written.', 'success');
    return r;
  }
  // After a save on Products, Glossary or Repo map: keep the map up to date when it is missing or already Workshop's.
  async function afterSave() {
    try {
      await Promise.all([readProducts(), readGlossary(), readRepos(), readPeople()]);
      if (!meta().autoWrite) return paintAll();
      if (!oc.ok) await readWorkspace();
      if (oc.ok && map && (!map.exists || map.generated)) await writeMap({ quiet: true });
    } catch (e) { toast(`Repo map not updated: ${errText(e)}`, 'error'); }
    paintAll();
  }

  /* ---------- Glossary ---------- */
  glEl.insertAdjacentHTML('beforeend', `<section class="card" id="glossary-card"><h2 class="dup">Glossary${qh('glossary', 'Words people use in work items and what the code calls them. Workshop writes them into the repo map, and Tandem looks them up for the product it works on.')}</h2>
    <p class="sub">Words people use, and what the code calls them.</p><div class="gl-body"></div></section>`);
  const productOptions = sel => `<option value="">Any product</option>${products.map(p => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  const glRow = (r, i) => `<tr data-gl-row="${i}"><td><input class="cfg-input" name="term" value="${esc(r.term)}" aria-label="Word people use" maxlength="120"></td>
    <td><input class="cfg-input mono" name="code" value="${esc(r.code)}" aria-label="In the code" maxlength="200" spellcheck="false"></td>
    <td><input class="cfg-input mono" name="where" value="${esc(r.where || '')}" aria-label="Where it shows up" placeholder="optional" maxlength="300" spellcheck="false"></td>
    <td><select class="cfg-input" name="productId" aria-label="Product">${productOptions(r.productId || '')}</select></td>
    <td><button type="button" class="btn ghost icon" data-gl-remove="${i}" aria-label="Remove ${esc(r.term || 'this word')}" title="Remove">&times;</button></td></tr>`;
  function readGlForm() {
    return [...glEl.querySelectorAll('[data-gl-row]')].map(tr => ({ id: (glRows[+tr.dataset.glRow] || {}).id || '', term: tr.querySelector('[name=term]').value, code: tr.querySelector('[name=code]').value, where: tr.querySelector('[name=where]').value, productId: tr.querySelector('[name=productId]').value }));
  }
  function paintGlossary() {
    const b = glEl.querySelector('.gl-body');
    if (glEnv && glEnv.unreadable) { b.innerHTML = `<p class="err">The glossary was saved by a newer Workshop (version ${esc(glEnv.unreadable)}). Update Workshop to change it.</p>`; return; }
    if (!glDirty || !glRows) glRows = words().map(w => ({ ...w }));
    const rows = glRows.length ? glRows : [{ term: '', code: '', where: '', productId: '' }];
    b.innerHTML = `<form data-gl-form><table class="gl-table"><thead><tr><th>Word people use</th><th>In the code</th><th>Where it shows up</th><th>Product</th><th><span class="sr-only">Remove</span></th></tr></thead>
      <tbody>${rows.map(glRow).join('')}</tbody></table>
      <div class="acts left"><button type="button" class="btn" data-gl-add>Add a word</button><span class="msg" aria-live="polite"></span><span class="grow"></span><button class="btn primary"${glDirty ? '' : ' disabled'}>Save</button></div></form>`;
  }
  glEl.addEventListener('input', e => { if (e.target.closest('[data-gl-form]')) { glRows = readGlForm(); if (!glDirty) { glDirty = true; const s = glEl.querySelector('[data-gl-form] .btn.primary'); if (s) s.disabled = false; } } });
  glEl.addEventListener('change', e => { if (e.target.closest('[data-gl-form]')) { glRows = readGlForm(); glDirty = true; const s = glEl.querySelector('[data-gl-form] .btn.primary'); if (s) s.disabled = false; } });
  glEl.addEventListener('keydown', e => {
    // Enter in the last row adds a row; Enter elsewhere moves to the next row.
    if (e.key !== 'Enter' || !e.target.matches('[data-gl-row] input')) return;
    e.preventDefault();
    const tr = e.target.closest('[data-gl-row]');
    const next = tr.nextElementSibling;
    if (next) { next.querySelector(`[name=${e.target.name}]`).focus(); return; }
    glRows = [...readGlForm(), { term: '', code: '', where: '', productId: '' }]; glDirty = true; paintGlossary();
    glEl.querySelector('[data-gl-row]:last-child [name=term]').focus();
  });
  glEl.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-gl-add]')) { glRows = [...readGlForm(), { term: '', code: '', where: '', productId: '' }]; glDirty = true; paintGlossary(); glEl.querySelector('[data-gl-row]:last-child [name=term]').focus(); }
    if (t.matches('[data-gl-remove]')) { const r = readGlForm(); r.splice(+t.dataset.glRemove, 1); glRows = r; glDirty = true; paintGlossary(); }
  });
  glEl.addEventListener('submit', async e => {
    if (!e.target.matches('[data-gl-form]')) return;
    e.preventDefault();
    const msg = e.target.querySelector('.msg');
    const rows = readGlForm();
    const why = G.problem(rows);
    if (why) { msg.textContent = why; return; }
    try {
      const items = G.replaceAll(rows);
      glEnv = await saveEnv(G.COLLECTION, G.blank, G.readable, env => {
        const old = new Map((env.items || []).map(i => [i.id, i]));
        const deleted = { ...(env.deleted || {}) };
        for (const id of old.keys()) if (!items.some(i => i.id === id)) deleted[id] = Date.now();
        // Unchanged words keep their updatedAt, so stamp only marks the ones that changed.
        return { ...env, deleted, items: items.map(i => { const o = old.get(i.id); return o && o.term === i.term && o.code === i.code && (o.where || '') === (i.where || '') && (o.productId || '') === (i.productId || '') ? o : i; }) };
      });
      glDirty = false; glRows = null;
      toast(`Glossary saved (${items.length} ${items.length === 1 ? 'word' : 'words'}).`, 'success');
      await afterSave();
    } catch (err) { msg.textContent = errText(err); }
  });

  /* ---------- Repo map ---------- */
  mapEl.insertAdjacentHTML('beforeend', `<section class="card" id="repo-map-card"><h2 class="dup">Repo map${qh('repo-map', 'The workspace AGENTS.md every Tandem session loads. Workshop writes it from your products, glossary and repos, so it is never typed by hand.')}</h2><div class="rm-body"></div></section>
    <section class="card" id="repo-about-card"><h2>What each repo is</h2><p class="sub">One line each. Tandem reads it to pick repos for a work item.</p><div class="ra-body"></div></section>`);
  function mapStatus() {
    if (!map) return '';
    if (!map.exists) return 'Not written yet.';
    if (map.generated) return meta().writtenAt ? `Written by Workshop, ${esc(when(meta().writtenAt))}.` : 'Written by Workshop.';
    const parsed = K.parseRepoMap(map.text);
    return `Written by hand (${parsed.repos.length} repos, ${parsed.products.length} products, ${parsed.glossary.length} glossary words). Import it once, then Workshop keeps it.`;
  }
  function planHtml() {
    if (!plan) return '';
    const bits = [
      plan.newProducts.length && `${plan.newProducts.length} new ${plan.newProducts.length === 1 ? 'product' : 'products'} (${esc(plan.newProducts.map(p => p.name).join(', '))})`,
      plan.updates.length && `more detail on ${esc(plan.updates.map(u => u.name).join(', '))}`,
      plan.wordsNew.length && `${plan.wordsNew.length} glossary ${plan.wordsNew.length === 1 ? 'word' : 'words'}`,
      plan.abouts.length && `${plan.abouts.length} repo ${plan.abouts.length === 1 ? 'description' : 'descriptions'}`,
      plan.extra && 'the other sections (kept as they are)'
    ].filter(Boolean);
    return `<div class="rm-plan" role="region" aria-label="Import preview"><p><b>Import adds:</b> ${bits.length ? bits.join('; ') : 'nothing new; everything in it is already in Settings'}.</p>
      <p class="cfg-help">Nothing already in Settings changes. Then <b>Write it now</b> keeps your file beside the new one as <span class="mono">${esc(K.KEPT_FILE)}</span>.</p>
      <div class="acts left"><button class="btn primary" data-rm-import-go${bits.length ? '' : ' disabled'}>Add these</button><button class="btn" data-rm-import-cancel>Cancel</button></div></div>`;
  }
  function paintMap() {
    const b = mapEl.querySelector('.rm-body'), a = mapEl.querySelector('.ra-body');
    if (!oc.ok) {
      const why = oc.why === 'agent' ? 'The repo map is a file in your workspace, so it needs Workshop on this computer.' : `Set the workspace folder in <a href="#" class="lnk" data-goto-page="agents">opencode settings</a> to write the repo map.${oc.why ? ` <span class="dim">(${esc(oc.why)})</span>` : ''}`;
      b.innerHTML = `<p class="sub">${why}</p>`;
      a.innerHTML = '<p class="sub">Shown once the workspace can be read.</p>';
      return;
    }
    const hand = map && map.exists && !map.generated;
    b.innerHTML = `<div class="pc-rows"><div class="pc-row"><span class="pc-k">File</span><span class="pc-v mono">${esc(map ? map.path : '')}</span></div>
      <div class="pc-row"><span class="pc-k">Status</span><span class="pc-v">${mapStatus()}</span></div></div>
      <label class="check"><input type="checkbox" data-rm-auto${meta().autoWrite ? ' checked' : ''}> Keep it up to date when products, the glossary or repos change</label>
      <div class="acts left">${hand ? `<button class="btn primary" data-rm-import${busy ? ' disabled' : ''}>Import into Workshop</button>` : ''}
        <button class="btn${hand ? '' : ' primary'}" data-rm-write${busy ? ' disabled' : ''}>${busy === 'write' ? 'Writing...' : 'Write it now'}</button>
        <button class="btn ghost" data-rm-preview aria-expanded="${preview}">${preview ? 'Hide preview' : 'Preview'}</button></div>
      ${planHtml()}
      ${preview ? `<pre class="rm-preview mono" tabindex="0" aria-label="Repo map preview">${esc(mapText())}</pre>` : ''}
      <details class="rm-extra"${meta().extra ? '' : ''}><summary>Other sections${meta().extra ? '' : ' (none)'}</summary>
        <p class="cfg-help">Markdown added after the glossary, such as Do not touch or how the repos depend on each other. Kept from an import, or typed here.</p>
        <form data-rm-extra><textarea class="cfg-input mono" rows="8" name="extra" spellcheck="false" aria-label="Other sections">${esc(meta().extra)}</textarea>
        <div class="acts left"><span class="msg" aria-live="polite"></span><button class="btn">Save sections</button></div></form></details>`;
    const purposes = new Map((info || []).map(r => [r.folder.toLowerCase(), r]));
    const saved = new Map(repoRows().map(r => [r.folder.toLowerCase(), r.about]));
    const prev = map && map.exists ? new Map(K.parseRepoMap(map.text).repos.map(r => [r.folder.toLowerCase(), r.about])) : new Map();
    const folders = [...new Set([...(info || []).map(r => r.folder), ...repoRows().map(r => r.folder)])].sort((x, y) => x.localeCompare(y));
    a.innerHTML = folders.length ? `<form data-ra-form><table class="gl-table ra-table"><thead><tr><th>Repo</th><th>What it is</th><th>Stack</th></tr></thead><tbody>
      ${folders.map(f => { const k = f.toLowerCase(), i = purposes.get(k) || {}; return `<tr><td class="mono">${esc(f)}${i.guide ? '' : ' <span class="state" title="No repo guide yet. Draft one in Repos.">no guide</span>'}</td>
        <td><input class="cfg-input" name="about" data-folder="${esc(f)}" value="${esc(saved.get(k) || prev.get(k) || '')}" placeholder="${esc(i.purpose || 'One line')}" maxlength="200" aria-label="What ${esc(f)} is"></td><td class="mono dim">${esc(i.stack || '')}</td></tr>`; }).join('')}
      </tbody></table><div class="acts left"><span class="msg" aria-live="polite"></span><button class="btn primary">Save</button></div></form>` : '<p class="sub">No repos in the workspace yet. Add them in <a href="#" class="lnk" data-goto-page="repos">Repos</a>.</p>';
  }
  mapEl.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-rm-preview]')) { preview = !preview; return paintMap(); }
    if (t.matches('[data-rm-write]')) {
      busy = 'write'; paintMap();
      try { await writeMap(); } catch (err) { toast(errText(err), 'error'); }
      busy = ''; plan = null; paintAll(); return;
    }
    if (t.matches('[data-rm-import]')) {
      const parsed = K.parseRepoMap(map.text);
      plan = K.importPlan(parsed, { products: productsAll, repos: repoRows() });
      plan.wordsNew = G.toAdd(plan.words, words(), productsAll, plan.renamed);
      if (meta().extra) plan.extra = '';
      return paintMap();
    }
    if (t.matches('[data-rm-import-cancel]')) { plan = null; return paintMap(); }
    if (t.matches('[data-rm-import-go]') && plan) {
      t.disabled = true;
      try {
        await saveEnv(P.COLLECTION, P.blank, P.readable, env => {
          let items = env.items || [];
          for (const input of plan.newProducts) items = P.upsert(items, input).items;
          for (const u of plan.updates) items = P.upsert(items, u.input, u.id).items;
          return { ...env, items };
        });
        await readProducts();
        if (plan.wordsNew.length) {
          const add = G.toAdd(plan.words, words(), productsAll, plan.renamed);
          glEnv = await saveEnv(G.COLLECTION, G.blank, G.readable, env => {
            // New ids are made around the stored ones; stored words are kept as they are.
            const kept = G.list(env);
            const all = G.replaceAll([...kept, ...add]);
            const old = new Map((env.items || []).map(i => [i.id, i]));
            return { ...env, items: all.map(i => old.get(i.id) || i) };
          });
        }
        await saveRepos(env => ({ ...env, items: K.setAbouts(env.items, plan.abouts), meta: { ...(env.meta || {}), ...(plan.extra ? { extra: plan.extra } : {}) } }));
        toast('Imported. Check Products and Glossary, then Write it now.', 'success');
        plan = null;
      } catch (err) { toast(errText(err), 'error'); }
      return paintAll();
    }
  });
  mapEl.addEventListener('change', async e => {
    if (!e.target.matches('[data-rm-auto]')) return;
    try { await saveRepos(env => ({ ...env, meta: { ...(env.meta || {}), autoWrite: e.target.checked } })); toast(e.target.checked ? 'The repo map will be kept up to date.' : 'The repo map is written only when you click Write it now.', 'success'); }
    catch (err) { toast(errText(err), 'error'); e.target.checked = !e.target.checked; }
  });
  mapEl.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = e.target.querySelector('.msg');
    try {
      if (e.target.matches('[data-rm-extra]')) {
        const extra = String(new FormData(e.target).get('extra') || '').replace(/\s+$/, '');
        if (/^#\s/m.test(extra)) { msg.textContent = 'Start sections with ## (the map has one # title already).'; return; }
        await saveRepos(env => ({ ...env, meta: { ...(env.meta || {}), extra } }));
        toast('Sections saved.', 'success');
      } else if (e.target.matches('[data-ra-form]')) {
        const abouts = [...e.target.querySelectorAll('[name=about]')].map(i => ({ folder: i.dataset.folder, about: i.value }));
        await saveRepos(env => ({ ...env, items: K.setAbouts(env.items, abouts) }));
        toast('Saved.', 'success');
      } else return;
      await afterSave();
    } catch (err) { if (msg) msg.textContent = errText(err); }
  });

  /* ---------- Checks ---------- */
  ckEl.insertAdjacentHTML('beforeend', `<section class="card" id="checks-card"><h2 class="dup">Checks${qh('knowledge-checks', 'Facts kept in two places drift apart. This lists what is kept twice or missing, with where to fix it.')}</h2><div class="ck-body"></div></section>`);
  function paintChecks() {
    const b = ckEl.querySelector('.ck-body');
    const found = K.checks({ products, glossary: words(), info: oc.ok ? info : null, notes, people, map: oc.ok ? map : null });
    b.innerHTML = `<div class="acts left"><p class="sub grow">${found.length ? `${found.length} ${found.length === 1 ? 'thing' : 'things'} to fix.` : 'Nothing kept twice or missing.'}${oc.ok ? '' : ' Repo checks need the workspace (opencode settings).'}</p><button class="btn" data-ck-again>Check again</button></div>
      ${found.length ? `<ul class="ck-list">${found.map(f => `<li><span class="ck-mark" aria-hidden="true">!</span><span class="grow">${esc(f.text)}</span>${f.fix.note ? `<button class="btn" data-ck-note="${esc(f.fix.note)}">Open note</button>` : `<button class="btn" data-goto-page="${esc(f.fix.page)}">${esc({ products: 'Edit products', glossary: 'Edit glossary', 'repo-map': 'Repo map' }[f.fix.page] || 'Open')}</button>`}</li>`).join('')}</ul>` : ''}`;
  }
  ckEl.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-ck-again]')) { t.disabled = true; await refresh(); return; }
    if (t.matches('[data-ck-note]')) ws.open({ app: 'notes', path: t.dataset.ckNote });
  });

  function paintAll() { paintGlossary(); paintMap(); paintChecks(); }
  async function refresh() {
    await Promise.all([readProducts(), readGlossary(), readRepos(), readPeople(), readWorkspace()]);
    await readNotes();
    paintAll();
  }

  for (const el of [glEl, mapEl, ckEl]) for (const b of el.querySelectorAll('.card > div')) b.innerHTML = '<p class="sub">Loading...</p>';
  await refresh();
  ws.data.subscribe(G.COLLECTION, async () => { if (glDirty) return; await readGlossary(); paintGlossary(); paintChecks(); });
  ws.data.subscribe(P.COLLECTION, async () => { await readProducts(); if (!glDirty) paintGlossary(); paintChecks(); });
  window.addEventListener('focus', async () => { if (busy || plan) return; await refresh(); });
  return { afterSave, refresh, ready: () => oc.ok };
}
