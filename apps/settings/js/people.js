/* Settings, People & teams: the people directory (docs/people.md) and your team's area paths (docs/teams.md).
   These were the People app; the data never moved (it has always been Settings' folder).

   Everything goes through the SDK: ws.people for people and groups, ws.teams for area paths. Both work in
   every mode, so these pages stay editable on a paired site while the rest of Settings is read only there.
   people-forms.js turns forms into fields; people-sheet.js does the spreadsheet template and import planning;
   this file draws the two pages. */
import * as D from '../../../shared/people.js';
import { saveFile } from '../../../shared/save-file.js';
import * as PF from './people-forms.js';
import * as S from './people-sheet.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errText = e => (e && e.message) || String(e);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
// A quiet ? hint after a heading (shared/theme.js), when the theme has hints.
const qh = (id, text) => (globalThis.WorkshopTheme?.hints ? globalThis.WorkshopTheme.hints.html(id, text) : '');

/* ---------- SheetJS, loaded the first time a sheet is read or written ---------- */
let xlsx = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsx) xlsx = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '../../shared/vendor/xlsx.full.min.js';
    s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('The spreadsheet reader did not load.')));
    s.onerror = () => { xlsx = null; reject(new Error('The spreadsheet reader did not load. Reload and try again.')); };
    document.head.appendChild(s);
  });
  return xlsx;
}

/**
 * Draw the People & groups page into `peopleEl` and Team area paths into `teamEl`.
 * Returns {command(id), focusImport()} for Settings' commands and routes.
 */
export async function mountPeople({ ws, toast, peopleEl, teamEl }) {
  let dir = D.EMPTY;
  let editing = null;          // id being edited, 'new-person', 'new-group', or null
  let preset = null;           // fields for the new person form (Home's Add your name: relation You and the name)
  let query = '', filter = 'all';
  let pending = null;          // {name, plan} while an import waits for Import or Cancel
  let team = { name: 'My team', areas: [], connection: '' };
  const q = s => peopleEl.querySelector(s);

  /* ---------- forms ---------- */
  const relOptions = cur => D.RELATIONS.map(r => `<option value="${r}"${cur === r ? ' selected' : ''}>${esc(D.RELATION_LABEL[r])}</option>`).join('');

  function personForm(p) {
    const isNew = !p.id;
    return `<form class="cfg person-form" data-person-form="${esc(p.id || 'new')}">
      <div class="cfg-row"><label for="pName">Name</label><input id="pName" name="name" class="cfg-input" maxlength="200" value="${esc(p.name || '')}" required></div>
      <div class="cfg-row"><label for="pHandle">Handle</label><input id="pHandle" name="handle" class="cfg-input mono" maxlength="41" value="${esc(p.handle || '')}" placeholder="${isNew ? 'first name, filled in for you' : ''}">
        <p class="cfg-help">What you type after @ in Docket and quick capture.</p></div>
      <div class="cfg-row"><label for="pRel">Relation</label><select id="pRel" name="relation" class="cfg-input">${relOptions(p.relation)}</select>
        <p class="cfg-help">Contact is anyone outside your working circle: another team, a vendor.</p></div>
      <div class="cfg-row cfg-check"><input id="pTeam" name="team" type="checkbox"${D.onTeam(p) ? ' checked' : ''}><label for="pTeam">On my team</label>
        <p class="cfg-help">Shows in team reports.</p></div>
      <div class="cfg-row"><label for="pAdo">Azure DevOps</label><input id="pAdo" name="adoIdentity" class="cfg-input" maxlength="200" value="${esc(p.adoIdentity || '')}" placeholder="name@example.com or display name">
        <p class="cfg-help">Optional. Used once Azure DevOps is connected.</p></div>
      <div class="cfg-row"><label for="pRole">Role</label><input id="pRole" name="role" class="cfg-input" maxlength="200" value="${esc(p.role || '')}"></div>
      <div class="cfg-row"><label for="pOwns">Owns</label><input id="pOwns" name="owns" class="cfg-input" maxlength="2000" value="${esc((p.owns || []).join(', '))}" placeholder="Products, repos or area paths, separated by commas">
        <p class="cfg-help">Slate uses this to suggest who to delegate to, from what a request touches. Facts only: what they own.</p></div>
      ${formActs(p)}
    </form>`;
  }

  function groupForm(g) {
    const members = new Set(g.members || []);
    const people = D.active(dir, { kind: 'person' });
    // Archived members stay listed (checked) so saving the form does not drop them by surprise.
    const shown = [...people, ...(g.members || []).map(id => dir.byId.get(id)).filter(p => p && p.archived)];
    const boxes = shown.map(p => `<label class="member"><input type="checkbox" name="member" value="${esc(p.id)}"${members.has(p.id) ? ' checked' : ''}> ${esc(p.name)}${p.archived ? ' <span class="state">Archived</span>' : ''}</label>`).join('');
    return `<form class="cfg person-form" data-group-form="${esc(g.id || 'new')}">
      <div class="cfg-row"><label for="gName">Name</label><input id="gName" name="name" class="cfg-input" maxlength="200" value="${esc(g.name || '')}" required></div>
      <div class="cfg-row"><label for="gHandle">Handle</label><input id="gHandle" name="handle" class="cfg-input mono" maxlength="41" value="${esc(g.handle || '')}" placeholder="${g.id ? '' : 'from the name, filled in for you'}"></div>
      <fieldset class="cfg-row members"><legend>Members</legend>${boxes || '<p class="cfg-help">Add people first. A group can also stay empty, for a team whose people you do not track.</p>'}</fieldset>
      ${formActs(g)}
    </form>`;
  }

  function formActs(it) {
    return `<div class="acts"><span class="msg" aria-live="polite"></span>
        ${it.id ? `<button type="button" class="btn" data-item-archive="${esc(it.id)}">${it.archived ? 'Restore' : 'Archive'}</button>` : ''}
        <button type="button" class="btn" data-item-cancel>Cancel</button><button class="btn primary">Save</button></div>`;
  }

  function itemRow(it) {
    if (editing === it.id) return `<li class="person editing">${it.kind === 'group' ? groupForm(it) : personForm(it)}</li>`;
    const bits = it.kind === 'group'
      ? [D.membersOf(dir, it.id).map(p => esc(p.name)).join(', ') || 'No members']
      : [esc(D.RELATION_LABEL[it.relation]), D.onTeam(it) ? 'on my team' : '', it.role ? esc(it.role) : '', it.adoIdentity ? `<span class="mono">${esc(it.adoIdentity)}</span>` : '',
         Array.isArray(it.owns) && it.owns.length ? `owns ${esc(it.owns.join(', '))}` : '',
         D.groupsOf(dir, it.id).map(g => `@${esc(g.handle)}`).join(' ')].filter(Boolean);
    return `<li class="person${it.archived ? ' archived' : ''}"><div><b>${esc(it.name)}</b> <span class="mono handle">@${esc(it.handle)}</span>${it.archived ? ' <span class="state">Archived</span>' : ''}<p class="person-meta">${bits.join(' · ')}</p></div>
      <button class="btn" data-item-edit="${esc(it.id)}">Edit</button></li>`;
  }

  /* ---------- the people list ---------- */
  const matches = it => {
    if (filter === 'team' && !(it.kind === 'person' && D.onTeam(it))) return false;
    if (filter !== 'all' && filter !== 'team' && it.relation !== filter) return false;
    if (!query) return true;
    const ql = query.toLowerCase();
    return [it.name, it.handle, it.role, it.adoIdentity, (it.owns || []).join(' ')].some(v => String(v || '').toLowerCase().includes(ql));
  };

  let peopleHtml = null, peopleFirst = null;
  function paintPeople() {
    const body = q('.people-body');
    if (!body) return;
    if (dir.unreadable) { body.innerHTML = `<p class="err">The people list was saved by another Workshop version (version ${esc(dir.version)}). Update Workshop to change it.</p>`; return; }
    const all = D.sorted(dir.people.filter(p => !p.archived));
    const people = all.filter(matches);
    const groups = D.sorted(dir.groups.filter(g => !g.archived)).filter(g => !query || [g.name, g.handle].some(v => v.toLowerCase().includes(query.toLowerCase())));
    const archived = D.sorted(dir.items.filter(it => it.archived));
    const hasSelf = !!D.self(dir);
    const filtered = query || filter !== 'all';
    const html = `
      <p class="count">${plural(all.length, 'person', 'people')}${filtered ? ` · ${people.length} shown` : ''}</p>
      ${people.length ? `<ul class="people">${people.map(itemRow).join('')}</ul>` : `<p class="sub">${all.length ? 'No one matches.' : 'No one yet. Add yourself, your manager and your reports, or import a spreadsheet.'}</p>`}
      ${editing === 'new-person' ? `<div class="person editing">${personForm(preset || { relation: hasSelf ? 'report' : 'self' })}</div>` : ''}
      ${filter === 'all' || filter === 'groups' ? `<h3 class="people-sub">Groups${qh('people.groups', 'Groups are assigned like a person, for example @leadership. Tasks on a group show for each of its members.')}</h3>
      ${groups.length ? `<ul class="people">${groups.map(itemRow).join('')}</ul>` : '<p class="sub">No groups yet. A group like @leadership is assigned like a person.</p>'}` : ''}
      ${editing === 'new-group' ? `<div class="person editing">${groupForm({})}</div>` : ''}
      <div class="acts left">${editing && editing.startsWith('new') ? '' : '<button class="btn primary" data-person-new>Add a person</button><button class="btn" data-group-new>Add a group</button>'}</div>
      ${archived.length ? `<details class="archived-list"><summary>Archived (${archived.length})</summary><ul class="people">${archived.map(itemRow).join('')}</ul></details>` : ''}`;
    // Same markup: leave it, so the row under the pointer keeps its hover (no flicker on a save echo).
    if (html === peopleHtml && body.firstChild === peopleFirst && body.firstChild) return;
    body.innerHTML = html;
    peopleHtml = html; peopleFirst = body.firstChild;
    const first = body.querySelector('.editing input[name=name]');
    if (first) first.focus();
  }

  /* ---------- import ---------- */
  const ACT_LABEL = { new: 'Add', update: 'Update', same: 'No change', skip: 'Skipped' };

  function paintImport() {
    const body = q('.import-body');
    if (!body) return;
    if (!pending) { body.innerHTML = ''; return; }
    const { plan, name } = pending;
    const c = plan.counts;
    const todo = c.new + c.update + (plan.groups.length ? 1 : 0);
    const rows = plan.rows.map(r => `<tr data-act="${r.action}"><td class="mono">${r.line}</td><td>${esc(r.name || '(no name)')}</td><td class="act">${ACT_LABEL[r.action]}</td>
        <td class="why">${esc(r.why || (r.action === 'update' ? r.changes.join(', ') : r.action === 'new' ? `@${r.fields.handle}${r.groups.length ? ', ' + r.groups.map(h => '@' + h).join(' ') : ''}` : ''))}</td></tr>`).join('');
    body.innerHTML = `<div class="preview">
      <h3>${esc(name)}</h3>
      <p class="tallies"><span class="tally"><b>${c.new}</b> to add</span><span class="tally"><b>${c.update}</b> to update</span><span class="tally"><b>${c.same}</b> unchanged</span>${c.skip ? `<span class="tally"><b>${c.skip}</b> skipped</span>` : ''}${plan.groups.length ? `<span class="tally">new groups: ${plan.groups.map(h => '@' + esc(h)).join(' ')}</span>` : ''}</p>
      <div class="rows-wrap"><table class="rows"><thead><tr><th>Row</th><th>Name</th><th>Does</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="acts"><span class="msg" aria-live="polite"></span><button class="btn" data-import-cancel>Cancel</button>
        <button class="btn primary" data-import-go${todo ? '' : ' disabled'}>${todo ? `Import ${plural(c.new + c.update, 'person', 'people')}` : 'Nothing to import'}</button></div></div>`;
  }

  async function readSheet(file) {
    const X = await loadXlsx();
    const wb = /\.csv$/i.test(file.name) ? X.read(await file.text(), { type: 'string' }) : X.read(await file.arrayBuffer(), { type: 'array' });
    const name = wb.SheetNames.includes(S.SHEET) ? S.SHEET : wb.SheetNames[0];
    if (!name) throw new Error('That file has no sheets.');
    return X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
  }

  async function downloadSheet(filled) {
    const X = await loadXlsx();
    const wb = X.utils.book_new();
    const ws1 = X.utils.aoa_to_sheet(S.rows(filled ? dir : D.EMPTY));
    ws1['!cols'] = [{ wch: 24 }, { wch: 14 }, { wch: 15 }, { wch: 11 }, { wch: 28 }, { wch: 22 }, { wch: 26 }];
    X.utils.book_append_sheet(wb, ws1, S.SHEET);
    const ws2 = X.utils.aoa_to_sheet(S.HELP);
    ws2['!cols'] = [{ wch: 14 }, { wch: 100 }];
    X.utils.book_append_sheet(wb, ws2, 'How to fill in');
    const bytes = X.write(wb, { type: 'array', bookType: 'xlsx' });
    const name = filled ? `people-${new Date().toISOString().slice(0, 10)}.xlsx` : 'people-template.xlsx';
    await saveFile(name, new Uint8Array(bytes), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  async function runImport() {
    const { plan } = pending;
    const people = S.peopleChanges(plan);
    const saved = people.length ? await ws.people.saveMany(people) : [];
    // New people get their real ids from the save, in the same order as the plan's new and updated rows.
    const ids = new Map();
    plan.rows.filter(r => r.action === 'new' || (r.action === 'update' && r.fields)).forEach((r, i) => ids.set(r.id, saved[i].id));
    dir = await ws.people.get();
    const groups = S.groupChanges(dir, plan, ids);
    if (groups.length) await ws.people.saveMany(groups);
    return { people: plan.counts.new + plan.counts.update, groups: plan.groups.length };
  }

  /* ---------- team area paths ---------- */
  function paintTeam() {
    const body = teamEl.querySelector('.team-body');
    if (!body || body.contains(document.activeElement) && document.activeElement.matches('textarea, input')) return;
    body.innerHTML = `<form class="cfg" data-team-form>
      <div class="cfg-row"><label for="tAreas">Area paths</label><textarea id="tAreas" name="areas" class="cfg-input mono" rows="3" placeholder="Project\\Team" spellcheck="false">${esc(team.areas.join('\n'))}</textarea>
        <p class="cfg-help">One per line. Includes everything under each.</p>
        <p class="acts left"><button type="button" class="btn" data-areas-suggest>Suggest from Azure DevOps</button><span class="msg" aria-live="polite" data-areas-msg></span></p>
        <div class="areas-suggest" data-areas-list></div></div>
      <div class="cfg-row"><label for="tConn">Connection</label><input id="tConn" name="connection" class="cfg-input" maxlength="120" value="${esc(team.connection)}" placeholder="Default">
        <p class="cfg-help">The Azure DevOps connection to use, by its name in Connections. Empty uses the default.</p></div>
      <div class="acts"><span class="msg" aria-live="polite"></span><button class="btn primary">Save</button></div></form>`;
  }

  /* ---------- the pages ---------- */
  peopleEl.insertAdjacentHTML('beforeend', `
    <section class="card" id="people-list">
      <h2>People and groups${qh('people', 'Everyone you assign work to: you, your manager, reports, peers, contacts on other teams, and groups of them. Docket, Runway, Rapport and Home all use this list.')}</h2>
      <div class="bar"><label class="sr" for="q">Search people</label><input id="q" class="cfg-input" type="search" placeholder="Search by name, handle, role or email" autocomplete="off">
        <label class="sr" for="f">Show</label><select id="f" class="cfg-input">
          <option value="all">Everyone</option><option value="team">On my team</option><option value="report">Direct reports</option>
          <option value="peer">Peers</option><option value="contact">Contacts</option><option value="groups">Groups only</option></select></div>
      <div class="people-body"><p class="sub">Loading...</p></div>
    </section>
    <section class="card" id="import">
      <h2>Import from a spreadsheet${qh('people.import', 'Download the template, fill in one person per row, then import it. A row with the handle or name of someone already here updates them. You see every change before anything is saved.')}</h2>
      <div class="acts left"><button class="btn" data-template>Download template</button><button class="btn" data-people-export>Download current list</button>
        <label class="btn primary"><input type="file" accept=".xlsx,.xls,.csv" data-sheet hidden>Import a spreadsheet</label><span class="msg" aria-live="polite"></span></div>
      <div class="import-body"></div>
    </section>`);
  teamEl.insertAdjacentHTML('beforeend', `
    <section class="card" id="team">
      <h2>Team area paths${qh('people.areas', 'The Azure DevOps area paths your team works in. Slate lists your team\'s backlog from them; Runway\'s ADO roadmaps and the Dispatch hub use them too.')}</h2>
      <p class="sub">Plain text, so you can fill them in before Azure DevOps is connected.</p>
      <div class="team-body"><p class="sub">Loading...</p></div>
    </section>`);

  const done = text => { editing = null; preset = null; toast(text, 'success'); paintPeople(); };

  peopleEl.addEventListener('input', e => {
    if (e.target.id === 'q') { query = e.target.value.trim(); if (!editing) paintPeople(); }
  });

  peopleEl.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-person-new]')) { editing = 'new-person'; preset = null; return paintPeople(); }
    if (t.matches('[data-group-new]')) { editing = 'new-group'; return paintPeople(); }
    if (t.matches('[data-item-edit]')) { editing = t.dataset.itemEdit; return paintPeople(); }
    if (t.matches('[data-item-cancel]')) { editing = null; preset = null; return paintPeople(); }
    if (t.matches('[data-item-archive]')) {
      const it = dir.byId.get(t.dataset.itemArchive);
      if (!it) return;
      try {
        if (it.archived) await ws.people.restore(it.id); else await ws.people.archive(it.id);
        done(it.archived ? `${it.name} restored.` : `${it.name} archived. Records about them are kept.`);
      } catch (err) { t.closest('form').querySelector('.msg').textContent = errText(err); }
      return;
    }
    const msg = q('#import .acts .msg');
    if (t.matches('[data-template], [data-people-export]')) {
      try { await downloadSheet(t.matches('[data-people-export]')); msg.textContent = ''; } catch (err) { msg.textContent = errText(err); }
      return;
    }
    if (t.matches('[data-import-cancel]')) { pending = null; return paintImport(); }
    if (t.matches('[data-import-go]')) {
      t.disabled = true;
      const out = t.closest('.acts').querySelector('.msg');
      try {
        const r = await runImport();
        pending = null;
        paintImport();
        editing = null;
        dir = await ws.people.get();
        paintPeople();
        toast(`Imported ${plural(r.people, 'person', 'people')}${r.groups ? ` and made ${plural(r.groups, 'group')}` : ''}.`, 'success');
      } catch (err) {
        t.disabled = false;
        out.textContent = err.index != null ? `Nothing was saved: ${errText(err)}` : errText(err);
      }
    }
  });

  peopleEl.addEventListener('change', async e => {
    if (e.target.id === 'f') { filter = e.target.value; if (!editing) paintPeople(); return; }
    if (e.target.matches('[data-sheet]')) {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const msg = q('#import .acts .msg');
      msg.textContent = 'Reading...';
      try {
        const parsed = S.parse(await readSheet(file));
        if (!parsed.length) throw new Error('That sheet has no people in it.');
        dir = await ws.people.get();
        pending = { name: file.name, plan: S.plan(dir, parsed) };
        msg.textContent = '';
      } catch (err) { pending = null; msg.textContent = errText(err); }
      paintImport();
      return;
    }
    // "On my team" follows the relation's default until it is clicked.
    const form = e.target.closest('[data-person-form]');
    if (!form) return;
    if (e.target.name === 'team') form.dataset.teamTouched = '1';
    if (e.target.name === 'relation' && !form.dataset.teamTouched) form.querySelector('[name=team]').checked = D.onTeam({ relation: e.target.value });
  });

  peopleEl.addEventListener('submit', async e => {
    const form = e.target.closest('[data-person-form], [data-group-form]');
    if (!form) return;
    e.preventDefault();
    const isGroup = form.hasAttribute('data-group-form');
    const id = isGroup ? form.dataset.groupForm : form.dataset.personForm;
    const fields = isGroup ? PF.groupFields(new FormData(form)) : PF.personFields(new FormData(form));
    const old = dir.byId.get(id);
    if (old && !fields.handle) fields.handle = old.handle; // an emptied handle keeps the old one
    try {
      const saved = old ? await ws.people.update(old.id, fields) : await ws.people.add({ ...fields, kind: isGroup ? 'group' : 'person' });
      done(`${saved.name} saved as @${saved.handle}.`);
    } catch (err) { form.querySelector('.msg').textContent = errText(err); }
  });

  /* Suggest from Azure DevOps: the area paths of your open work items (the ADO connector's read-only areas.mine),
     as checkboxes that add to the box. Nothing is saved until Save. */
  teamEl.addEventListener('click', async e => {
    const b = e.target.closest('[data-areas-suggest]');
    if (b) {
      const msg = teamEl.querySelector('[data-areas-msg]'), list = teamEl.querySelector('[data-areas-list]');
      msg.textContent = 'Reading your work items...'; b.disabled = true;
      try {
        const r = await ws.connectors.call('ado', 'areas.mine', {});
        const areas = (r && r.areas) || [];
        const box = teamEl.querySelector('#tAreas');
        const have = new Set(String(box.value).split('\n').map(x => x.trim()).filter(Boolean));
        msg.textContent = areas.length ? 'Your open work items sit in these area paths. Tick the ones that are your team\'s, then Save.' : 'None of your open work items has an area path.';
        list.innerHTML = areas.map(a => `<label class="member"><input type="checkbox" data-area="${esc(a.path)}"${have.has(a.path) ? ' checked' : ''}> <span class="mono">${esc(a.path)}</span> <span class="state">${plural(a.count, 'item')}</span></label>`).join('');
      } catch (err) {
        msg.textContent = /not (on|enabled)|disabled|not ready|connector/i.test(errText(err)) ? 'Connect Azure DevOps first (Azure DevOps, Connections), or type the paths in.' : errText(err);
      } finally { b.disabled = false; }
      return;
    }
  });
  teamEl.addEventListener('change', e => {
    const c = e.target.closest('[data-area]');
    if (!c) return;
    const box = teamEl.querySelector('#tAreas');
    const lines = String(box.value).split('\n').map(x => x.trim()).filter(Boolean);
    const next = c.checked ? [...new Set([...lines, c.dataset.area])] : lines.filter(x => x !== c.dataset.area);
    box.value = next.join('\n');
  });

  teamEl.addEventListener('submit', async e => {
    const tf = e.target.closest('[data-team-form]');
    if (!tf) return;
    e.preventDefault();
    const fd = new FormData(tf);
    try {
      team = await ws.teams.setMine({ areas: fd.get('areas'), connection: fd.get('connection') });
      document.activeElement.blur();
      toast('Team area paths saved.', 'success');
      paintTeam();
    } catch (err) { tf.querySelector('.msg').textContent = errText(err); }
  });

  try { dir = await ws.people.get(); } catch (e) { q('.people-body').innerHTML = `<p class="err">${esc(errText(e))}</p>`; }
  paintPeople();
  ws.people.subscribe(next => { dir = next; if (!editing) paintPeople(); }); // don't redraw under an open form
  try { team = await ws.teams.get(); paintTeam(); } catch (e) { teamEl.querySelector('.team-body').innerHTML = `<p class="err">${esc(errText(e))}</p>`; }
  ws.teams.subscribe(next => { team = next; paintTeam(); });

  return {
    command(id, arg) {
      // add-you (Home's Add your name): your own person, to edit if there is one, else a new one set to You.
      if (id === 'add-you') {
        const me = (dir.people || []).find(p => p.relation === 'self' && !p.archived);
        if (me) { editing = me.id; preset = null; }
        else { editing = 'new-person'; preset = { relation: 'self', name: String(arg || '').slice(0, 200) }; }
      } else if (id === 'add-person') { editing = 'new-person'; preset = null; }
      else if (id === 'add-group') editing = 'new-group';
      else return false;
      paintPeople();
      return true;
    },
    focusImport() { const el = q('#import'); if (el) el.scrollIntoView({ block: 'start' }); }
  };
}
