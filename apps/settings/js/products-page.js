/* Settings, Products: the products you work on (docs/products.md, settings.products v1). Folio makes each one's
   note, products/<slug>.md, for you to edit there; Tandem reads and adds to it.

   Settings' own collection, written with ws.data (shared/products.js does the rules). Owners come from People's
   "Owns" (ws.people), suggestions from the workspace repos (opencode connector's state) and your team's area paths
   (ws.teams). Whether a note exists is read from Folio's folder, read only. Nothing here writes another app's data. */
import * as P from '../../../shared/products.js';
import * as D from '../../../shared/people.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errText = e => (e && e.message) || String(e);
const qh = (id, text) => (globalThis.WorkshopTheme?.hints ? globalThis.WorkshopTheme.hints.html(id, text) : '');

/** Draw the Products page into `el`. Returns {command(id)} for the palette's Add a product. */
export async function mountProducts({ ws, toast, el }) {
  let env = null;               // the stored envelope (null: none yet)
  let unreadable = false;
  let editing = null;           // product id, 'new', or null
  let people = [];              // active directory people, for owners
  let repoFolders = [];         // workspace repo folders, for suggestions
  let teamAreas = [];           // your team's area paths, for suggestions
  let notes = null;             // Set of Folio note paths under products/, or null when it cannot be read

  el.insertAdjacentHTML('beforeend', `
    <section class="card" id="products">
      <h2>Products${qh('products', 'The products you work on. Folio makes a note for each one (Products in Folio) with what is here filled in, for you to edit. Tandem reads that note before working on the product and adds what it learns.')}</h2>
      <p class="sub">Add a product once. Folio makes its note, filled in from here, the next time it opens.</p>
      <div class="products-body"><p class="sub">Loading...</p></div>
    </section>`);
  const body = () => el.querySelector('.products-body');

  const all = () => P.list(env);
  const byId = id => all().find(p => p.id === id) || null;

  /* ---------- reading ---------- */
  async function readProducts() {
    const e = await ws.data.get(P.COLLECTION);
    unreadable = !P.readable(e);
    env = unreadable ? null : e;
    if (unreadable) unreadable = e.version;
  }
  async function readNotes() {
    try { notes = new Set((await ws.files.list('products', { app: 'notes' })).map(f => f.path)); }
    catch { notes = null; }
  }
  async function readSuggestions() {
    try { people = D.active(await ws.people.get(), { kind: 'person' }); } catch { people = []; }
    try { teamAreas = (await ws.teams.get()).areas; } catch { teamAreas = []; }
    try {
      const st = await ws.connectors.call('opencode', 'state');
      repoFolders = ((st && st.repos) || []).map(r => r && r.folder).filter(Boolean).sort((a, b) => a.localeCompare(b));
    } catch { repoFolders = []; }
  }

  /* ---------- writing: read, change, stamp, put; again on a conflict ---------- */
  async function save(change) {
    for (let attempt = 0; ; attempt++) {
      const stored = await ws.data.get(P.COLLECTION);
      if (!P.readable(stored)) throw new Error(`Products were saved by a newer Workshop (version ${stored.version}). Update Workshop to change them.`);
      const before = stored || P.blank();
      const { items, result } = change(JSON.parse(JSON.stringify(before.items || [])));
      const after = ws.data.stamp(before, { ...JSON.parse(JSON.stringify(before)), items });
      try {
        await ws.data.put(P.COLLECTION, after);
        env = after;
        return result;
      } catch (e) {
        if (!(e && e.code === 'conflict') || attempt >= 4) throw e;
      }
    }
  }

  /* ---------- painting ---------- */
  const checks = (name, options, chosen) => options.length
    ? `<fieldset class="members"><legend>${name === 'repo' ? 'Your workspace repos' : 'Your team\'s area paths'}</legend>${options.map(o =>
        `<label class="member"><input type="checkbox" data-pick="${name}" value="${esc(o)}"${chosen.some(c => c.toLowerCase() === o.toLowerCase()) ? ' checked' : ''}> <span class="mono">${esc(o)}</span></label>`).join('')}</fieldset>`
    : '';

  function form(p) {
    const isNew = !p.id;
    const owners = isNew ? [] : P.ownersOf(p, people);
    return `<form class="cfg person-form" data-product-form="${esc(p.id || 'new')}">
      <div class="cfg-row"><label for="prName">Name</label><input id="prName" name="name" class="cfg-input" maxlength="120" value="${esc(p.name || '')}" required>
        <p class="cfg-help">${isNew ? 'The note is named from this when you add it.' : `The note stays <span class="mono">${esc(P.notePath(p))}</span> if you rename it.`}</p></div>
      <div class="cfg-row"><label for="prAka">Also called</label><input id="prAka" name="alsoCalled" class="cfg-input" maxlength="2000" value="${esc((p.alsoCalled || []).join(', '))}" placeholder="Other names, separated by commas">
        <p class="cfg-help">Nicknames, old names, what work items call it.</p></div>
      <div class="cfg-row"><label for="prRepos">Repos</label><textarea id="prRepos" name="repos" class="cfg-input mono" rows="2" spellcheck="false" placeholder="Category/repo">${esc((p.repos || []).join('\n'))}</textarea>
        <p class="cfg-help">One per line, as Repos lists them.</p>${checks('repo', repoFolders, p.repos || [])}</div>
      <div class="cfg-row"><label for="prAreas">Area paths</label><textarea id="prAreas" name="areas" class="cfg-input mono" rows="2" spellcheck="false" placeholder="Project\\Team\\Product">${esc((p.areas || []).join('\n'))}</textarea>
        <p class="cfg-help">One per line. Optional.</p>${checks('area', teamAreas, p.areas || [])}</div>
      ${isNew ? '' : `<div class="cfg-row"><p class="cfg-help"><b>Owners:</b> ${owners.length ? esc(owners.map(o => o.name).join(', ')) : 'no one yet.'} From what each person owns in <a href="#" class="lnk" data-goto-page="people">People</a>.</p></div>`}
      <div class="acts"><span class="msg" aria-live="polite"></span>
        ${isNew ? '' : `<button type="button" class="btn" data-product-archive="${esc(p.id)}">${p.archived ? 'Restore' : 'Archive'}</button>`}
        <button type="button" class="btn" data-product-cancel>Cancel</button><button class="btn primary">${isNew ? 'Add' : 'Save'}</button></div></form>`;
  }

  function noteBit(p) {
    if (notes && notes.has(P.notePath(p))) return `<button class="btn" data-product-open="${esc(p.slug)}">Open note</button>`;
    return `<span class="person-meta">${notes ? 'Note made the next time Folio opens' : ''}</span><button class="btn" data-product-open="${esc(p.slug)}">Open Folio</button>`;
  }

  function row(p) {
    if (editing === p.id) return `<li class="person editing">${form(p)}</li>`;
    const owners = P.ownersOf(p, people);
    const bits = [
      `<span class="mono">${esc(P.notePath(p))}</span>`,
      p.alsoCalled.length ? `also ${esc(p.alsoCalled.join(', '))}` : '',
      p.repos.length ? `${p.repos.length} repo${p.repos.length === 1 ? '' : 's'}` : '',
      p.areas.length ? `${p.areas.length} area path${p.areas.length === 1 ? '' : 's'}` : '',
      owners.length ? `owners ${esc(owners.map(o => o.name).join(', '))}` : ''
    ].filter(Boolean);
    return `<li class="person${p.archived ? ' archived' : ''}"><div><b>${esc(p.name)}</b>${p.archived ? ' <span class="state">Archived</span>' : ''}<p class="person-meta">${bits.join(' · ')}</p></div>
      <div class="acts left">${p.archived ? '' : noteBit(p)}<button class="btn" data-product-edit="${esc(p.id)}">Edit</button></div></li>`;
  }

  function paint() {
    const b = body();
    if (!b) return;
    if (unreadable) { b.innerHTML = `<p class="err">Products were saved by another Workshop version (version ${esc(unreadable)}). Update Workshop to change them.</p>`; return; }
    const live = all().filter(p => !p.archived), archived = all().filter(p => p.archived);
    b.innerHTML = `
      ${live.length ? `<ul class="people">${live.map(row).join('')}</ul>` : '<p class="sub">No products yet.</p>'}
      ${editing === 'new' ? `<div class="person editing">${form({})}</div>` : '<div class="acts left"><button class="btn primary" data-product-new>Add a product</button></div>'}
      ${archived.length ? `<details class="archived-list"><summary>Archived (${archived.length})</summary><ul class="people">${archived.map(row).join('')}</ul></details>` : ''}`;
    const first = b.querySelector('.editing input[name=name]');
    if (first) first.focus();
  }

  /* ---------- events ---------- */
  el.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-product-new]')) { editing = 'new'; return paint(); }
    if (t.matches('[data-product-edit]')) { editing = t.dataset.productEdit; return paint(); }
    if (t.matches('[data-product-cancel]')) { editing = null; return paint(); }
    if (t.matches('[data-product-open]')) { ws.open({ app: 'notes', path: P.notePath({ slug: t.dataset.productOpen }) }); return; }
    if (t.matches('[data-product-archive]')) {
      const p = byId(t.dataset.productArchive);
      if (!p) return;
      try {
        await save(items => ({ items: P.setArchived(items, p.id, !p.archived), result: null }));
        editing = null;
        toast(p.archived ? `${p.name} restored.` : `${p.name} archived. Its note stays in Folio.`, 'success');
        paint();
      } catch (err) { t.closest('form').querySelector('.msg').textContent = errText(err); }
    }
  });

  // A ticked suggestion adds its line to the box; unticking takes it out. Nothing is saved until Add or Save.
  el.addEventListener('change', e => {
    const c = e.target.closest('[data-pick]');
    if (!c) return;
    const box = c.closest('form').querySelector(c.dataset.pick === 'repo' ? '[name=repos]' : '[name=areas]');
    const lines = String(box.value).split('\n').map(x => x.trim()).filter(Boolean);
    box.value = (c.checked ? [...lines.filter(x => x.toLowerCase() !== c.value.toLowerCase()), c.value] : lines.filter(x => x.toLowerCase() !== c.value.toLowerCase())).join('\n');
  });

  el.addEventListener('submit', async e => {
    const f = e.target.closest('[data-product-form]');
    if (!f) return;
    e.preventDefault();
    const fd = new FormData(f);
    const id = f.dataset.productForm === 'new' ? null : f.dataset.productForm;
    const input = { name: fd.get('name'), alsoCalled: fd.get('alsoCalled'), repos: String(fd.get('repos') || '').split('\n'), areas: fd.get('areas') };
    try {
      const saved = await save(items => { const r = P.upsert(items, input, id); return { items: r.items, result: r.product }; });
      editing = null;
      toast(id ? `${saved.name} saved.` : `${saved.name} added. Folio makes its note, ${P.notePath(saved)}, the next time it opens.`, 'success');
      paint();
    } catch (err) { f.querySelector('.msg').textContent = errText(err); }
  });

  /* ---------- start ---------- */
  const api = { command(id) { if (id !== 'add-product' || unreadable) return false; editing = 'new'; paint(); return true; } };
  try { await readProducts(); } catch (e) { body().innerHTML = `<p class="err">${esc(errText(e))}</p>`; return api; }
  await Promise.all([readNotes(), readSuggestions()]);
  paint();
  ws.data.subscribe(P.COLLECTION, async () => { try { await readProducts(); if (!editing) paint(); } catch { /* next change */ } });
  ws.people.subscribe(d => { people = D.active(d, { kind: 'person' }); if (!editing) paint(); });
  // Folio may have made notes since: check again when the window comes back.
  window.addEventListener('focus', async () => { await readNotes(); if (!editing) paint(); });
  return api;
}
