/* Receipts: keep the receipts for your performance reviews.

   Me (self review) is the main area. Reports keeps receipts per direct report, and Upward (off until you
   turn it on in Settings) tracks support, asks and feedback for your manager. Review turns any of them into
   a draft grouped by your rubric sections.

   Everything goes through the Workshop SDK (shared/workshop-sdk.js): on its own page that is this browser's
   storage, or a folder on this computer once you pick one in Settings. Inside Workshop it is Workshop's
   storage. The page makes no other network requests (see the CSP in index.html). state.js is the logic;
   this file paints and handles input. */
import { connect } from '../../../shared/workshop-sdk.js';
import { mountBar } from '../../../shared/standalone-bar.js';
import * as R from './state.js';

const app = document.getElementById('app');
const ws = await connect({ app: R.APP });
document.documentElement.classList.toggle('embed', ws.embedded);
if (!ws.embedded) mountBar('Receipts');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------- data ---------- */
const NAMES = ['entries', 'people', 'config'];
const store = {};
const blank = name => ({ schema: `${R.APP}.${name}`, version: R.VERSION, rev: 0, items: [], deleted: {}, ...(name === 'config' ? { meta: { ...R.DEFAULT_CONFIG, updatedAt: 0 } } : {}) });

async function loadAll() {
  for (const n of NAMES) store[n] = (await ws.data.get(n)) || blank(n);
}
const entries = () => store.entries.items.map(R.cleanEntry);
const people = () => store.people.items.map(R.cleanPerson);
const cfg = () => ({ ...R.DEFAULT_CONFIG, ...(store.config.meta || {}) });

// The write loop from the data format: stamp, put, and on a conflict merge with what is stored and put again.
async function save(name, mutate) {
  const before = store[name];
  const after = structuredClone(before);
  mutate(after);
  ws.data.stamp(before, after);
  try {
    const r = await ws.data.put(name, after);
    store[name] = { ...after, rev: r.rev, updatedAt: r.updatedAt };
  } catch (err) {
    if (err.code !== 'conflict' || !err.current) throw err;
    const merged = ws.data.merge(after, err.current);
    const r = await ws.data.put(name, merged);
    store[name] = { ...merged, rev: r.rev, updatedAt: r.updatedAt };
  }
}
async function safely(fn, okText) {
  try { await fn(); if (okText) ws.toast(okText, { kind: 'success' }); }
  catch (err) { ws.toast(err.message || 'Could not save.', { kind: 'error' }); }
  paint();
}

const upsertEntry = e => save('entries', env => {
  const i = env.items.findIndex(x => x.id === e.id);
  if (i >= 0) env.items[i] = e; else env.items.push(e);
});
const removeEntry = id => save('entries', env => { env.items = env.items.filter(x => x.id !== id); });
const upsertPerson = p => save('people', env => {
  const i = env.items.findIndex(x => x.id === p.id);
  if (i >= 0) env.items[i] = p; else env.items.push(p);
});
const saveConfig = patch => save('config', env => { env.meta = { ...(env.meta || {}), ...patch }; });

/* ---------- view state ---------- */
const S = {
  route: { view: 'me', id: '' },
  filters: {},          // per area key: {period, section, kind, star, q}
  draft: {},            // per about: the composer's entry
  more: {},             // per about: composer details open
  editing: null,        // entry in the edit dialog
  addingPerson: false,
  review: { about: 'me', period: '', withDates: true, withEvidence: false },
};
const filterFor = key => (S.filters[key] ||= { period: cfg().cycleStart ? 'cycle' : 'quarter', section: '', kind: '', star: false, q: '' });
const draftFor = about => (S.draft[about] ||= R.blankEntry(about, cfg()));
const nameOf = about => about === 'me' ? 'Me' : about === 'up' ? (cfg().upLabel || 'My manager') : (people().find(p => p.id === about)?.name || 'Former report');

/* ---------- routing ----------
   On its own page the hash is #/<view>[/<id>]. Inside Workshop the shell owns the hash (#/receipts/<path>)
   and tells us the path with the route event. */
function parse(path) {
  const [view, id] = String(path || '').replace(/^#?\/?/, '').split('/');
  const views = ['me', 'team', 'up', 'review', 'settings'];
  return { view: views.includes(view) ? view : 'me', id: id ? decodeURIComponent(id) : '' };
}
function go(path) {
  if (ws.embedded) ws.open({ app: R.APP, path });
  else if (location.hash !== '#/' + path) location.hash = '#/' + path;
  else { S.route = parse(path); paint(); }
}
if (ws.embedded) ws.on('route', ({ path }) => { S.route = parse(path); paint(); });
else window.addEventListener('hashchange', () => { S.route = parse(location.hash); paint(); window.scrollTo(0, 0); });
S.route = parse(ws.embedded ? '' : location.hash);

/* ---------- icons ---------- */
const I = {
  star: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/></svg>',
  starOn: '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/></svg>',
  edit: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5l3 3L7 16H4v-3z"/></svg>',
  lock: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="4" y="9" width="12" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 016 0V9"/></svg>',
  copy: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M13 7V4.5A1.5 1.5 0 0011.5 3h-7A1.5 1.5 0 003 4.5v7A1.5 1.5 0 004.5 13H7"/></svg>',
  down: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v10M6 9l4 4 4-4M4 16h12"/></svg>',
  back: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l-6 6 6 6"/></svg>',
};

/* ---------- pieces ---------- */
const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;

function composerHtml(about, placeholder) {
  const d = draftFor(about);
  const open = !!S.more[about];
  const c = cfg();
  return `<form class="composer" data-about="${esc(about)}" autocomplete="off">
    <label class="vh" for="txt-${esc(about)}">New receipt</label>
    <textarea id="txt-${esc(about)}" name="text" rows="2" placeholder="${esc(placeholder)}">${esc(d.text)}</textarea>
    <div class="crow">
      <select name="kind" aria-label="Kind">${R.kindOptions(about).map(([k, l]) => opt(k, l, d.kind)).join('')}</select>
      <input type="date" name="date" value="${esc(d.date)}" aria-label="Date">
      <button type="button" id="star-${esc(about)}" class="ibtn star${d.star ? ' on' : ''}" data-act="draft-star" aria-pressed="${d.star}" aria-label="Star for the review" title="Star for the review">${d.star ? I.starOn : I.star}</button>
      <button type="button" id="more-${esc(about)}" class="lnk" data-act="more" aria-expanded="${open}">${open ? 'Fewer details' : 'More details'}</button>
      <span class="grow"></span>
      <span class="hint"><kbd>Ctrl</kbd> <kbd>Enter</kbd></span>
      <button class="btn primary" type="submit">Save</button>
    </div>
    <div class="chips" role="group" aria-label="Review sections">${c.sections.map(s => `<button type="button" class="chip${d.sections.includes(s) ? ' on' : ''}" data-act="draft-sec" data-sec="${esc(s)}" aria-pressed="${d.sections.includes(s)}">${esc(s)}</button>`).join('')}</div>
    <div class="details"${open ? '' : ' hidden'}>
      ${detailFields(d)}
    </div>
  </form>`;
}
function detailFields(d) {
  return `<label>Impact<select name="impact">${opt(0, 'Not set', d.impact)}${[1, 2, 3].map(n => opt(n, R.IMPACT[n], d.impact)).join('')}</select></label>
      <label>Metric<input name="metric" value="${esc(d.metric)}" placeholder="-35% deploy time"></label>
      <label class="wide">Evidence<input name="evidence" value="${esc(d.evidence)}" placeholder="Link, ticket, doc, or where to find it"></label>
      <label class="wide">People involved<input name="people" value="${esc(d.people)}" placeholder="Teams or roles"></label>`;
}

function filtersHtml(key, { showKind = true } = {}) {
  const f = filterFor(key);
  const c = cfg();
  return `<div class="filters" data-key="${esc(key)}">
    <input type="search" name="q" value="${esc(f.q)}" placeholder="Search" aria-label="Search receipts" id="q-${esc(key)}">
    <select name="period" aria-label="Period">${R.periods(c).map(p => opt(p.key, p.label, f.period)).join('')}</select>
    <select name="section" aria-label="Section">${opt('', 'All sections', f.section)}${c.sections.map(s => opt(s, s, f.section)).join('')}</select>
    ${showKind ? `<select name="kind" aria-label="Kind">${opt('', 'All kinds', f.kind)}${R.KINDS.map(k => opt(k, R.kindLabel(k, key === 'me' || key === 'up' ? key : 'p'), f.kind)).join('')}</select>` : ''}
    <label class="tog"><input type="checkbox" name="star"${f.star ? ' checked' : ''}> Starred</label>
  </div>`;
}

function entryHtml(e, { showAbout = false } = {}) {
  const tags = [
    `<span class="kind k-${e.kind}">${esc(R.kindLabel(e.kind, e.about))}</span>`,
    ...e.sections.map(s => `<span class="tag">${esc(s)}</span>`),
    e.impact ? `<span class="tag imp">${esc(R.IMPACT[e.impact])} impact</span>` : '',
    showAbout ? `<span class="tag">${esc(nameOf(e.about))}</span>` : '',
  ].join('');
  const extra = [
    e.metric ? `<span><b>Metric</b> ${esc(e.metric)}</span>` : '',
    e.evidence ? `<span><b>Evidence</b> ${esc(e.evidence)}</span>` : '',
    e.people ? `<span><b>With</b> ${esc(e.people)}</span>` : '',
  ].filter(Boolean).join('');
  return `<li class="entry" data-id="${esc(e.id)}">
    <div class="edate mono">${esc(R.shortDate(e.date))}</div>
    <div class="ebody">
      <p class="etext">${esc(e.text)}</p>
      ${extra ? `<div class="extra">${extra}</div>` : ''}
      <div class="etags">${tags}</div>
    </div>
    <div class="eacts">
      <button class="ibtn star${e.star ? ' on' : ''}" data-act="star" aria-pressed="${e.star}" aria-label="${e.star ? 'Unstar' : 'Star'}">${e.star ? I.starOn : I.star}</button>
      <button class="ibtn" data-act="edit" aria-label="Edit">${I.edit}</button>
    </div>
  </li>`;
}

function feedHtml(list, emptyText, opts) {
  if (!list.length) return `<p class="empty">${esc(emptyText)}</p>`;
  return R.groupByMonth(list).map(g => `<section class="month"><h3 class="section-label">${esc(g.label)}<span class="n mono">${g.items.length}</span></h3><ul class="feed">${g.items.map(e => entryHtml(e, opts)).join('')}</ul></section>`).join('');
}

function stat(n, label, cls = '') { return `<div class="stat ${cls}"><b class="mono">${n}</b><span>${esc(label)}</span></div>`; }

/* ---------- views ---------- */
function meView() {
  const f = filterFor('me');
  const period = R.findPeriod(cfg(), f.period);
  const all = entries();
  const list = R.filterEntries(all, { about: 'me', period, section: f.section, kind: f.kind, star: f.star, q: f.q });
  const rev = R.buildReview(all, { about: 'me', period, sections: cfg().sections });
  return `<div class="stats">
      ${stat(rev.total, period.label)}
      ${stat(rev.kinds.win, 'Wins')}
      ${stat(rev.starred, 'Starred')}
      <button class="stat link${rev.gaps.length ? ' warn' : ''}" data-act="go" data-path="review">${`<b class="mono">${rev.gaps.length}</b><span>Sections with no receipts</span>`}</button>
    </div>
    ${composerHtml('me', 'What did you do? Shipped, fixed, unblocked, led, learned...')}
    ${filtersHtml('me')}
    <div class="list">${feedHtml(list, all.some(e => e.about === 'me') ? 'Nothing matches these filters.' : 'No receipts yet. Write down one thing you did this week, even if it felt small.')}</div>`;
}

function teamView() {
  const ps = people();
  const f = filterFor('team');
  const period = R.findPeriod(cfg(), f.period);
  const rows = R.rosterRows(ps, entries(), period, cfg());
  const archived = ps.filter(p => p.archived);
  return `<div class="bar">
      <select name="period" data-key="team" aria-label="Period" class="solo">${R.periods(cfg()).map(p => opt(p.key, p.label, f.period)).join('')}</select>
      <span class="grow"></span>
      <button class="btn" data-act="add-person">Add a report</button>
    </div>
    ${S.addingPerson ? personForm({ id: '', name: '', role: '', since: '' }) : ''}
    ${rows.length ? `<ul class="roster">${rows.map(r => `<li><button class="prow" data-act="go" data-path="team/${esc(r.person.id)}">
        <span class="pname"><b>${esc(r.person.name || 'Unnamed')}</b><span>${esc(r.person.role)}</span></span>
        <span class="pnums mono"><span title="Receipts in period">${r.total}</span><span title="Wins">${r.wins} W</span><span title="Feedback given">${r.feedback} F</span><span title="Growth areas">${r.growth} G</span>${r.concerns ? `<span class="cn" title="Concerns">${r.concerns} C</span>` : ''}</span>
        <span class="plast${r.stale ? ' stale' : ''}">${r.lastDate ? (r.daysSince === 0 ? 'Today' : `${r.daysSince}d ago`) : 'No receipts'}</span>
      </button></li>`).join('')}</ul>
      <p class="legend mono">W wins &middot; F feedback given &middot; G growth areas &middot; C concerns &middot; Highlighted: nothing in ${cfg().staleDays} days</p>`
    : (S.addingPerson ? '' : `<div class="engcard"><h2>Your reports</h2><p>Add each direct report to keep receipts for their review: wins, feedback you gave, growth areas, and concerns. Names stay on this device.</p><div class="acts"><button class="btn primary" data-act="add-person">Add a report</button></div></div>`)}
    ${archived.length ? `<details class="archived"><summary>Archived (${archived.length})</summary><ul>${archived.map(p => `<li><button class="lnk" data-act="go" data-path="team/${esc(p.id)}">${esc(p.name)}</button></li>`).join('')}</ul></details>` : ''}`;
}

function personForm(p) {
  return `<form class="pform" data-id="${esc(p.id)}" autocomplete="off">
    <label>Name<input name="name" value="${esc(p.name)}" required></label>
    <label>Role<input name="role" value="${esc(p.role)}" placeholder="Senior Engineer"></label>
    <label>Reporting since<input type="date" name="since" value="${esc(p.since)}"></label>
    <div class="acts"><button class="btn primary" type="submit">${p.id ? 'Save' : 'Add'}</button><button class="btn ghost" type="button" data-act="cancel-person">Cancel</button></div>
  </form>`;
}

function personView(id) {
  const p = people().find(x => x.id === id);
  if (!p) return `<div class="engcard"><h2>Not found</h2><p>This report isn't in your list anymore.</p><div class="acts"><button class="btn" data-act="go" data-path="team">Back to reports</button></div></div>`;
  const key = 'p';
  const f = filterFor(key);
  const period = R.findPeriod(cfg(), f.period);
  const all = entries();
  const list = R.filterEntries(all, { about: id, period, section: f.section, kind: f.kind, star: f.star, q: f.q });
  const inP = R.filterEntries(all, { about: id, period });
  const n = k => inP.filter(e => e.kind === k).length;
  return `<div class="bar"><button class="btn ghost" data-act="go" data-path="team">${I.back} Reports</button><span class="grow"></span>
      <button class="btn" data-act="go" data-path="review" data-about="${esc(id)}">Build review</button>
      <button class="btn ghost" data-act="edit-person">Edit</button>
      <button class="btn ghost" data-act="archive-person">${p.archived ? 'Restore' : 'Archive'}</button></div>
    ${S.addingPerson === id ? personForm(p) : `<div class="phead"><h2>${esc(p.name)}</h2><p>${esc([p.role, p.since && `since ${R.shortDate(p.since)} ${p.since.slice(0, 4)}`].filter(Boolean).join(', '))}</p></div>`}
    <div class="stats">${stat(inP.length, period.label)}${stat(n('win'), 'Wins')}${stat(n('feedback'), 'Feedback given')}${stat(n('growth'), 'Growth areas')}${stat(n('concern'), 'Concerns', n('concern') ? 'warn' : '')}</div>
    ${composerHtml(id, `What did ${p.name.split(' ')[0] || 'they'} do, or what feedback did you give?`)}
    ${filtersHtml(key)}
    <div class="list">${feedHtml(list, inP.length || all.some(e => e.about === id) ? 'Nothing matches these filters.' : 'No receipts yet. Note a win or a piece of feedback right after your next 1:1.')}</div>`;
}

function upView() {
  const c = cfg();
  if (!c.upward) return `<div class="engcard"><h2>Upward tracker</h2><p>Optional. Keep notes on the support you got from your manager, what you asked for, and feedback you want to share, so an upward review or skip-level is easy to write.</p><div class="acts"><button class="btn primary" data-act="upward-on">Turn it on</button></div></div>`;
  const f = filterFor('up');
  const period = R.findPeriod(c, f.period);
  const all = entries();
  const list = R.filterEntries(all, { about: 'up', period, section: f.section, kind: f.kind, star: f.star, q: f.q });
  return `${composerHtml('up', 'Support you got, something you asked for, or feedback to share...')}
    ${filtersHtml('up')}
    <div class="list">${feedHtml(list, all.some(e => e.about === 'up') ? 'Nothing matches these filters.' : 'No notes yet.')}</div>`;
}

function reviewView() {
  const c = cfg();
  const rv = S.review;
  const subjects = [['me', 'Me (self review)'], ...people().filter(p => !p.archived || p.id === rv.about).map(p => [p.id, p.name]), ...(c.upward ? [['up', c.upLabel || 'My manager']] : [])];
  if (!subjects.some(([v]) => v === rv.about)) rv.about = 'me';
  if (!rv.period) rv.period = c.cycleStart ? 'cycle' : 'quarter';
  const period = R.findPeriod(c, rv.period);
  const review = R.buildReview(entries(), { about: rv.about, period, sections: c.sections });
  const title = rv.about === 'me' ? 'Self review' : `Review: ${nameOf(rv.about)}`;
  const text = R.reviewText(review, { title, period, withDates: rv.withDates, withEvidence: rv.withEvidence });
  return `<div class="filters review-ctl">
      <select name="about" aria-label="Who">${subjects.map(([v, l]) => opt(v, l, rv.about)).join('')}</select>
      <select name="period" aria-label="Period">${R.periods(c).map(p => opt(p.key, p.label, rv.period)).join('')}</select>
      <label class="tog"><input type="checkbox" name="withDates"${rv.withDates ? ' checked' : ''}> Dates</label>
      <label class="tog"><input type="checkbox" name="withEvidence"${rv.withEvidence ? ' checked' : ''}> Evidence</label>
    </div>
    <h3 class="section-label">Coverage<span class="n mono">${review.total} receipts</span></h3>
    <div class="coverage">${review.coverage.map(x => `<span class="cov${x.count ? '' : ' gap'}"><b class="mono">${x.count}</b>${esc(x.section)}</span>`).join('')}</div>
    ${review.gaps.length ? `<p class="note">No receipts yet for ${esc(review.gaps.join(', '))}. If those matter for this review, now is the time to remember what happened.</p>` : review.total ? `<p class="note ok">Every section has at least one receipt.</p>` : ''}
    <div class="rgrid">
      <div class="rgroups">${review.groups.filter(g => g.items.length).map(g => `<section><h3 class="section-label">${esc(g.section)}<span class="n mono">${g.items.length}</span></h3><ul class="feed">${g.items.map(e => entryHtml(e)).join('')}</ul></section>`).join('') || `<p class="empty">No receipts in this period.</p>`}</div>
      <div class="draft">
        <h3 class="section-label">Draft</h3>
        <textarea readonly aria-label="Review draft" id="draft">${esc(text)}</textarea>
        <div class="acts">
          <button class="btn primary" data-act="copy-draft">${I.copy} Copy</button>
          <button class="btn" data-act="dl-draft">${I.down} .txt</button>
          <button class="btn" data-act="dl-csv-review">${I.down} .csv</button>
        </div>
        <p class="fine">Starred and big-impact receipts come first in each section. Edit the wording wherever you paste it.</p>
      </div>
    </div>`;
}

function settingsView(fs) {
  const c = cfg();
  const where = ws.embedded ? 'Workshop' : ws.storage === 'folder' ? `the folder ${fs && fs.name ? `"${fs.name}"` : 'you picked'}` : ws.storage === 'agent' ? 'Workshop on this computer' : 'this browser';
  return `<section class="set">
      <h3 class="section-label">Privacy and storage</h3>
      <p class="lede">${I.lock} Receipts are saved in ${esc(where)}. There are no accounts and no server, and this page makes no requests anywhere else.</p>
      ${ws.embedded ? `<p class="fine">Inside Workshop, storage and backups are managed in Workshop's Settings.</p>`
      : ws.storage === 'indexeddb' ? `<p class="fine">Browser storage can be cleared with your browsing data. To keep receipts as files you can back up, save them to a folder on this computer (Chrome or Edge).</p>
        <div class="acts"><button class="btn" data-act="folder">Save to a folder</button></div>`
      : ws.storage === 'folder' && fs && fs.permission !== 'granted' ? `<div class="acts"><button class="btn primary" data-act="allow">Allow access to the folder</button></div>` : ''}
      <div class="acts">
        <button class="btn" data-act="export">${I.down} Back up (.json)</button>
        <label class="btn">Restore from a backup<input type="file" accept=".json,application/json" data-act="import" hidden></label>
        <button class="btn" data-act="dl-csv-all">${I.down} All receipts (.csv)</button>
      </div>
      <p class="fine">Restoring merges a backup into what is here; it never deletes receipts.</p>
    </section>
    <form class="set" data-form="cycle">
      <h3 class="section-label">Review cycle</h3>
      <p class="fine">Set the dates your next review covers. It becomes the default period everywhere.</p>
      <div class="row"><label>Starts<input type="date" name="cycleStart" value="${esc(c.cycleStart)}"></label><label>Ends<input type="date" name="cycleEnd" value="${esc(c.cycleEnd)}"></label></div>
      <div class="acts"><button class="btn primary" type="submit">Save cycle</button>${c.cycleStart ? '<button class="btn ghost" type="button" data-act="clear-cycle">Clear</button>' : ''}</div>
    </form>
    <form class="set" data-form="sections">
      <h3 class="section-label">Review sections</h3>
      <p class="fine">Match your company's review form, one per line. Renaming a section here does not retag old receipts.</p>
      <textarea name="sections" rows="9">${esc(c.sections.join('\n'))}</textarea>
      <div class="acts"><button class="btn primary" type="submit">Save sections</button><button class="btn ghost" type="button" data-act="reset-sections">Reset to defaults</button></div>
    </form>
    <form class="set" data-form="more">
      <h3 class="section-label">Reports and upward</h3>
      <div class="row">
        <label>Flag a report after<span class="inl"><input type="number" name="staleDays" min="1" max="365" value="${esc(c.staleDays)}"> days with no receipts</span></label>
      </div>
      <label class="tog"><input type="checkbox" name="upward"${c.upward ? ' checked' : ''}> Show the Upward tracker</label>
      <label>Upward label<input name="upLabel" value="${esc(c.upLabel || '')}" placeholder="My manager"></label>
      <div class="acts"><button class="btn primary" type="submit">Save</button></div>
    </form>`;
}

/* ---------- paint ---------- */
const TABS = () => [['me', 'Me'], ['team', 'Reports'], ...(cfg().upward ? [['up', 'Upward']] : []), ['review', 'Review'], ['settings', 'Settings']];
const TITLES = { me: 'My receipts', team: 'Reports', up: 'Upward', review: 'Review', settings: 'Settings' };
let folderStatus = null;

function paint() {
  const { view, id } = S.route;
  // Keep focus and caret across repaints (search boxes repaint as you type).
  const a = document.activeElement;
  const keep = a && a.id ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
  const title = view === 'team' && id ? 'Reports' : TITLES[view];
  let body;
  if (view === 'team') body = id ? personView(id) : teamView();
  else if (view === 'up') body = upView();
  else if (view === 'review') body = reviewView();
  else if (view === 'settings') body = settingsView(folderStatus);
  else body = meView();
  app.innerHTML = `<header class="head">
      <p class="eyebrow">Receipts</p>
      <h1 class="page-title dot">${esc(title)}</h1>
      <p class="sub">${I.lock} Stays on this device</p>
    </header>
    <nav class="tabs" aria-label="Sections">${TABS().map(([k, l]) => `<button data-act="go" data-path="${k}"${k === view ? ' class="on" aria-current="page"' : ''}>${esc(l)}</button>`).join('')}</nav>
    <main class="v-${view}">${body}</main>`;
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* not a text field */ } }
  }
  document.title = ws.embedded ? 'Receipts' : `${title} · Receipts`;
}

/* ---------- edit dialog ---------- */
const dlg = document.createElement('dialog');
dlg.className = 'edit';
document.body.appendChild(dlg);
function openEdit(e) {
  S.editing = structuredClone(e);
  const d = S.editing;
  dlg.innerHTML = `<form method="dialog" class="eform" autocomplete="off">
    <h2>Edit receipt <span class="mono">${esc(nameOf(d.about))}</span></h2>
    <label class="wide">Receipt<textarea name="text" rows="4" required>${esc(d.text)}</textarea></label>
    <label>Kind<select name="kind">${R.kindOptions(d.about).map(([k, l]) => opt(k, l, d.kind)).join('')}</select></label>
    <label>Date<input type="date" name="date" value="${esc(d.date)}" required></label>
    ${detailFields(d)}
    <div class="wide chips" role="group" aria-label="Review sections">${cfg().sections.concat(d.sections.filter(s => !cfg().sections.includes(s))).map(s => `<button type="button" class="chip${d.sections.includes(s) ? ' on' : ''}" data-sec="${esc(s)}" aria-pressed="${d.sections.includes(s)}">${esc(s)}</button>`).join('')}</div>
    <label class="tog wide"><input type="checkbox" name="star"${d.star ? ' checked' : ''}> Starred for the review</label>
    <div class="acts wide"><button class="btn text-danger" type="button" data-act="delete">Delete</button><span class="grow"></span><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn primary" type="submit">Save</button></div>
  </form>`;
  dlg.showModal();
  dlg.querySelector('textarea').focus();
}
dlg.addEventListener('click', ev => {
  if (ev.target === dlg) return dlg.close();
  const chip = ev.target.closest('.chip');
  if (chip) {
    const s = chip.dataset.sec, list = S.editing.sections;
    S.editing.sections = list.includes(s) ? list.filter(x => x !== s) : [...list, s];
    chip.classList.toggle('on'); chip.setAttribute('aria-pressed', chip.classList.contains('on'));
    return;
  }
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'close') dlg.close();
  if (act === 'delete') {
    const gone = S.editing;
    dlg.close();
    safely(() => removeEntry(gone.id)).then(() => ws.toast('Receipt deleted.', { action: { label: 'Undo', command: 'undo-delete' } }));
    lastDeleted = gone;
  }
});
dlg.addEventListener('submit', ev => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const e = R.cleanEntry({ ...S.editing, text: fd.get('text'), kind: fd.get('kind'), date: fd.get('date'), impact: fd.get('impact'), metric: fd.get('metric'), evidence: fd.get('evidence'), people: fd.get('people'), star: fd.get('star') === 'on' });
  if (!e.text) return;
  dlg.close();
  safely(() => upsertEntry(e));
});
let lastDeleted = null;

/* ---------- input ---------- */
async function saveDraft(form) {
  const about = form.dataset.about;
  const d = draftFor(about);
  const fd = new FormData(form);
  Object.assign(d, { text: fd.get('text') || '', kind: fd.get('kind'), date: fd.get('date') });
  if (fd.has('impact')) Object.assign(d, { impact: fd.get('impact'), metric: fd.get('metric'), evidence: fd.get('evidence'), people: fd.get('people') });
  const e = R.cleanEntry({ ...d, createdAt: new Date().toISOString() });
  if (!e.text) { form.querySelector('textarea').focus(); return; }
  await safely(() => upsertEntry(e));
  // Keep the kind and date for the next one; clear the rest.
  S.draft[about] = { ...R.blankEntry(about, cfg()), kind: e.kind, date: e.date };
  paint();
  document.getElementById(`txt-${about}`)?.focus();
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

app.addEventListener('click', async ev => {
  const chip = ev.target.closest('.composer .chip');
  if (chip) {
    const about = chip.closest('form').dataset.about, d = draftFor(about), s = chip.dataset.sec;
    d.sections = d.sections.includes(s) ? d.sections.filter(x => x !== s) : [...d.sections, s];
    chip.classList.toggle('on'); chip.setAttribute('aria-pressed', chip.classList.contains('on'));
    return;
  }
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const entryId = el.closest('.entry')?.dataset.id;
  const c = cfg();
  switch (act) {
    case 'go':
      if (el.dataset.about) S.review.about = el.dataset.about;
      S.addingPerson = false;
      go(el.dataset.path); break;
    case 'more': { const about = el.closest('form').dataset.about; syncDraft(el.closest('form')); S.more[about] = !S.more[about]; paint(); break; }
    case 'draft-star': { const f = el.closest('form'); syncDraft(f); const d = draftFor(f.dataset.about); d.star = !d.star; paint(); break; }
    case 'star': { const e = entries().find(x => x.id === entryId); if (e) await safely(() => upsertEntry({ ...e, star: !e.star })); break; }
    case 'edit': { const e = entries().find(x => x.id === entryId); if (e) openEdit(e); break; }
    case 'add-person': S.addingPerson = true; paint(); document.querySelector('.pform input')?.focus(); break;
    case 'edit-person': S.addingPerson = S.route.id; paint(); break;
    case 'cancel-person': S.addingPerson = false; paint(); break;
    case 'archive-person': { const p = people().find(x => x.id === S.route.id); if (p) await safely(() => upsertPerson({ ...p, archived: !p.archived }), p.archived ? 'Restored.' : 'Archived. Their receipts are kept.'); break; }
    case 'upward-on': await safely(() => saveConfig({ upward: true })); break;
    case 'copy-draft':
      try { await navigator.clipboard.writeText(document.getElementById('draft').value); ws.toast('Draft copied.', { kind: 'success' }); }
      catch (e) { document.getElementById('draft').select(); ws.toast('Select all and copy.', { kind: 'warn' }); }
      break;
    case 'dl-draft': download(`receipts-${R.slug(nameOf(S.review.about))}-${R.today()}.txt`, document.getElementById('draft').value, 'text/plain;charset=utf-8'); break;
    case 'dl-csv-review': {
      const period = R.findPeriod(c, S.review.period);
      download(`receipts-${R.slug(nameOf(S.review.about))}-${R.today()}.csv`, R.toCsv(R.filterEntries(entries(), { about: S.review.about, period }), nameOf), 'text/csv;charset=utf-8');
      break;
    }
    case 'dl-csv-all': download(`receipts-all-${R.today()}.csv`, R.toCsv(entries(), nameOf), 'text/csv;charset=utf-8'); break;
    case 'export': {
      const bundle = await ws.data.export({ apps: [R.APP] });
      download(`receipts-backup-${R.today()}.json`, JSON.stringify(bundle, null, 2), 'application/json');
      break;
    }
    case 'folder': try { await ws.folder.choose(); } catch (e) { if (e.code !== 'bad_request') ws.toast(e.message, { kind: 'error' }); } break;
    case 'allow': try { folderStatus = await ws.folder.allow(); await loadAll(); paint(); } catch (e) { ws.toast(e.message, { kind: 'error' }); } break;
    case 'clear-cycle': await safely(() => saveConfig({ cycleStart: '', cycleEnd: '' })); break;
    case 'reset-sections': await safely(() => saveConfig({ sections: R.DEFAULT_SECTIONS }), 'Sections reset.'); break;
  }
});

// Copy the composer's fields into its draft before a repaint, so nothing typed is lost.
function syncDraft(form) {
  const d = draftFor(form.dataset.about), fd = new FormData(form);
  d.text = fd.get('text') || ''; d.kind = fd.get('kind'); d.date = fd.get('date');
  if (fd.has('impact')) Object.assign(d, { impact: fd.get('impact'), metric: fd.get('metric'), evidence: fd.get('evidence'), people: fd.get('people') });
}

app.addEventListener('input', ev => {
  const t = ev.target;
  const comp = t.closest('.composer');
  if (comp) { syncDraft(comp); return; }
  const filt = t.closest('.filters:not(.review-ctl)');
  if (filt && t.name === 'q') { filterFor(filt.dataset.key).q = t.value; paint(); }
});
app.addEventListener('change', async ev => {
  const t = ev.target;
  if (t.closest('.composer')) return;
  if (t.dataset.act === 'import') {
    const file = t.files && t.files[0];
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      const r = await ws.data.import(bundle);
      await loadAll();
      ws.toast(`Restored: ${r.created} new, ${r.merged} merged.`, { kind: 'success' });
    } catch (e) { ws.toast(e instanceof SyntaxError ? 'That file is not a Receipts backup.' : e.message, { kind: 'error' }); }
    paint();
    return;
  }
  if (t.closest('.review-ctl')) {
    S.review[t.name] = t.type === 'checkbox' ? t.checked : t.value;
    paint(); return;
  }
  const key = t.closest('.filters')?.dataset.key || t.dataset.key;
  if (key && t.name !== 'q') {
    filterFor(key)[t.name] = t.type === 'checkbox' ? t.checked : t.value;
    paint();
  }
});
app.addEventListener('submit', async ev => {
  ev.preventDefault();
  const form = ev.target;
  if (form.classList.contains('composer')) return saveDraft(form);
  const fd = new FormData(form);
  if (form.classList.contains('pform')) {
    const old = people().find(p => p.id === form.dataset.id);
    const p = R.cleanPerson({ ...(old || {}), id: form.dataset.id || R.newId('p'), name: fd.get('name'), role: fd.get('role'), since: fd.get('since') });
    if (!p.name) return;
    S.addingPerson = false;
    return safely(() => upsertPerson(p), old ? 'Saved.' : `Added ${p.name}.`);
  }
  switch (form.dataset.form) {
    case 'cycle': {
      const s = fd.get('cycleStart'), e = fd.get('cycleEnd');
      if (s && e && e < s) return ws.toast('The cycle ends before it starts.', { kind: 'warn' });
      for (const k of Object.keys(S.filters)) if (s) S.filters[k].period = 'cycle';
      if (s) S.review.period = 'cycle';
      return safely(() => saveConfig({ cycleStart: s, cycleEnd: e }), 'Review cycle saved.');
    }
    case 'sections': {
      const list = [...new Set(String(fd.get('sections')).split('\n').map(s => s.trim()).filter(Boolean))].slice(0, 30);
      if (!list.length) return ws.toast('Keep at least one section.', { kind: 'warn' });
      return safely(() => saveConfig({ sections: list }), 'Sections saved.');
    }
    case 'more': {
      const days = Math.min(365, Math.max(1, parseInt(fd.get('staleDays'), 10) || 30));
      return safely(() => saveConfig({ staleDays: days, upward: fd.get('upward') === 'on', upLabel: String(fd.get('upLabel') || '').trim() }), 'Saved.');
    }
  }
});
app.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && ev.target.closest('.composer')) {
    ev.preventDefault();
    saveDraft(ev.target.closest('.composer'));
  }
});
// N jumps to the composer from anywhere on the page.
document.addEventListener('keydown', ev => {
  if (ev.key !== 'n' || ev.ctrlKey || ev.metaKey || ev.altKey || dlg.open) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  const ta = document.querySelector('.composer textarea');
  if (ta) { ev.preventDefault(); ta.focus(); }
});

/* ---------- commands and live updates ---------- */
ws.commands.register({ id: 'new', title: 'Add a receipt' });
ws.commands.register({ id: 'review', title: 'Build a review' });
ws.on('command', async ({ id }) => {
  if (id === 'new') { if (!['me', 'team', 'up'].includes(S.route.view)) go('me'); setTimeout(() => document.querySelector('.composer textarea')?.focus(), 50); }
  if (id === 'review') go('review');
  if (id === 'undo-delete' && lastDeleted) { const e = lastDeleted; lastDeleted = null; await safely(() => upsertEntry(e), 'Restored.'); }
});
// Another window (or a change to the folder outside the browser) wrote: re-read and repaint.
for (const n of NAMES) ws.data.subscribe(n, async () => { store[n] = (await ws.data.get(n)) || blank(n); paint(); });
ws.on('online', async () => { await loadAll(); paint(); });

/* ---------- start ---------- */
await loadAll();
if (!ws.embedded && ws.storage === 'folder') { try { folderStatus = await ws.folder.status(); } catch (e) { folderStatus = null; } }
const moved = !ws.embedded && ws.folder.lastMove ? ws.folder.lastMove() : null;
if (moved) ws.toast(`Now saving to the folder "${moved.folder}".`, { kind: 'success' });
paint();
// On its own page, this site's service worker makes Receipts installable and open offline.
let swReload = null;
ws.on('command', ({ id }) => { if (id === 'sw-reload' && swReload) swReload(); });
if (!ws.embedded && window.WorkshopSw) window.WorkshopSw.register((msg, label, fn) => { swReload = fn; ws.toast(msg, { action: { label, command: 'sw-reload' } }); });
