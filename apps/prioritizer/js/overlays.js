import { EMBEDDED } from './constants.js';
import { applyOrder } from './actions.js';
import { hideTip } from './events.js';
import { byScore, fmtScore, isTriaged, score } from './model.js';
import { setScope } from './render.js';
import { childrenOf, commit, listById, orderedLists, scopeOpen, state, topLists } from './state.js';
import { $, esc, plural, uid } from './util.js';
/* Prioritizer: Modal, menus, list and scope menus, theme menu, toast, and the Suggest order preview. */
/* ---------- modal, menu, toast ---------- */
const modal = $('#modal');
let modalReturn = null;
function showModal(html, init){
  if (!modal.classList.contains('open')) modalReturn = document.activeElement;
  modal.innerHTML = `<div class="backdrop" data-close></div>${html}`;
  modal.classList.add('open');
  const sheet = modal.querySelector('.sheet');
  if (init) init(sheet);
  if (!sheet.contains(document.activeElement)){ const f = focusables(sheet)[0]; if (f) f.focus(); }
}
function closeModal(){
  modal.classList.remove('open'); modal.innerHTML = '';
  if (modalReturn && modalReturn.isConnected) modalReturn.focus({preventScroll: true});
  modalReturn = null;
}
modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
function focusables(root){
  return [...root.querySelectorAll('button:not([disabled]),[href],input:not([type=hidden]):not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null || el === document.activeElement);
}
function trapTab(e, root){
  const f = focusables(root); if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (!root.contains(document.activeElement)){ e.preventDefault(); first.focus(); return; }
  if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
}
function askText(title, initial, cb, okLabel = 'Save'){
  showModal(`<form class="sheet small" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>
    <input value="${esc(initial)}" maxlength="60" autocomplete="off" aria-label="Name">
    <footer><span class="grow"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${okLabel}</button></footer></form>`,
    f => {
      const i = f.querySelector('input'); i.focus(); i.select();
      f.addEventListener('submit', e => { e.preventDefault(); const v = i.value.trim(); if (!v) return i.focus(); closeModal(); cb(v); });
    });
}
function confirmBox(title, msg, okLabel, cb){
  showModal(`<div class="sheet small" role="alertdialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3><p>${esc(msg)}</p>
    <footer><span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn danger" data-ok>${okLabel}</button></footer></div>`,
    s => { const b = s.querySelector('[data-ok]'); b.onclick = () => { closeModal(); cb(); }; b.focus(); });
}
function showHelp(){
  const r = (k, d) => `<tr><td>${k}</td><td>${d}</td></tr>`;
  showModal(`<div class="sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"><h3>Keyboard shortcuts</h3>
    <table class="keys"><tbody>
      ${r(EMBEDDED ? '<kbd>N</kbd> <kbd>/</kbd>' : '<kbd>N</kbd> <kbd>/</kbd> <kbd>Ctrl</kbd>+<kbd>K</kbd>', 'Add a task')}
      ${EMBEDDED ? r('<kbd>Ctrl</kbd>+<kbd>K</kbd>', 'Workshop commands') : ''}
      ${r('<kbd>1</kbd> to <kbd>6</kbd>', 'Today, Triage, Prioritize, People, Archive, Reports')}
      ${r('<kbd>J</kbd> <kbd>K</kbd>', 'Next, previous task')}
      ${r('<kbd>Enter</kbd>', 'Open the selected task')}
      ${r('<kbd>X</kbd>', 'Complete or reopen')}
      ${r('<kbd>T</kbd>', 'Toggle Today')}
      ${r('<kbd>Alt</kbd>+<kbd>↑</kbd> <kbd>Alt</kbd>+<kbd>↓</kbd>', 'Move the selected task')}
      ${r('<kbd>Esc</kbd>', 'Close the drawer, dialog or menu')}
    </tbody></table>
    <table class="keys"><tbody><tr><td colspan="2"><h4>In Triage</h4></td></tr>
      ${r('<kbd>1</kbd> to <kbd>4</kbd>', 'Value: Trivial, Low, Medium, High')}
      ${r('<kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> <kbd>T</kbd>', 'Effort: XS, S, M, L, XL')}
      ${r('<kbd>D</kbd> / <kbd>U</kbd> / <kbd>Space</kbd>', 'Due date / Urgent / Today')}
      ${r('<kbd>Enter</kbd> / <kbd>S</kbd> / <kbd>0</kbd>', "Save and next / Skip / Won't do")}
    </tbody></table>
    <footer><span class="grow"></span><button class="btn" data-close>Close</button></footer></div>`);
}

let menuEl = null, menuReturn = null;
function closeMenu(restore){ if (menuEl){ menuEl.remove(); menuEl = null; if (restore && menuReturn && menuReturn.isConnected) menuReturn.focus(); } }
function popMenu(html, anchor, align = 'left'){
  closeMenu(); hideTip();
  menuReturn = anchor;
  menuEl = document.createElement('div'); menuEl.className = 'menu'; menuEl.setAttribute('role', 'menu');
  menuEl.innerHTML = html;
  document.body.appendChild(menuEl);
  const r = anchor.getBoundingClientRect(), w = menuEl.offsetWidth, h = menuEl.offsetHeight;
  const left = align === 'right' ? r.right - w : r.left;
  menuEl.style.left = Math.max(8, Math.min(left, innerWidth - w - 8)) + 'px';
  let top = r.bottom + 6; if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  menuEl.style.top = top + 'px';
  const first = menuEl.querySelector('button'); if (first) first.focus({preventScroll: true});
  return menuEl;
}
function openListMenu(listId, anchor){
  const L = listById(listId); if (!L) return;
  popMenu(`<button data-m="rename">Rename</button>${L.parentId ? '' : '<button data-m="sub">Add section</button>'}<div class="sep"></div><button data-m="delete" class="danger">Delete ${L.parentId ? 'section' : 'list'}</button>`, anchor)
    .addEventListener('click', e => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      closeMenu();
      if (b.dataset.m === 'rename') askText(`Rename ${L.parentId ? 'section' : 'list'}`, L.name, v => { L.name = v; commit(); });
      if (b.dataset.m === 'sub') newSubList(L.id);
      if (b.dataset.m === 'delete') deleteList(L);
    });
}
function openScopeMenu(anchor){
  popMenu(`<button data-sc="all"${state.scope === 'all' ? ' class="on"' : ''}>All lists</button>` + orderedLists().map(l =>
    `<button data-sc="${l.id}"${state.scope === l.id ? ' class="on"' : ''}>${l.parentId ? '   ↳ ' : ''}${esc(l.name)}</button>`).join(''), anchor)
    .addEventListener('click', e => { const b = e.target.closest('[data-sc]'); if (!b) return; closeMenu(); setScope(b.dataset.sc); });
}
function newSubList(parentId){
  askText(`New section in ${listById(parentId).name}`, '', v => {
    const n = {id: uid(), name: v, parentId}; state.lists.push(n); state.scope = n.id; commit();
  }, 'Create');
}
function deleteList(L){
  if (!L.parentId && topLists().length === 1){ toast('You need at least one list. Rename this one instead.'); return; }
  const ids = [L.id, ...childrenOf(L.id).map(c => c.id)];
  const n = state.tasks.filter(t => ids.includes(t.listId)).length, kids = ids.length - 1;
  confirmBox(`Delete "${L.name}"?`,
    `This removes ${plural(n,'task')}${kids ? ` and ${plural(kids,'section')}` : ''}. Download a copy first if you want a backup.`,
    'Delete', () => {
      state.lists = state.lists.filter(l => !ids.includes(l.id));
      state.tasks = state.tasks.filter(t => !ids.includes(t.listId));
      if (ids.includes(state.scope)) state.scope = L.parentId || 'all';
      commit();
    });
}
/* theme: shared with the shell (shared/theme.js); this menu is only shown when Prioritizer runs on its own */
WorkshopTheme.onChange(() => { if (menuEl && menuEl.querySelector('[data-th]')) closeMenu(); });
function openThemeMenu(anchor){
  popMenu(WorkshopTheme.menuHtml(), anchor, 'right').addEventListener('click', e => {
    const b = e.target.closest('[data-th]'); if (!b) return;
    closeMenu(true);
    WorkshopTheme.set(b.dataset.th);
  });
}

const toastEl = $('#toast');
let toastTimer;
// toast(msg) | toast(msg, label, fn, ms) | toast(msg, [[label, fn], ...], ms)
function toast(msg, a, b, c){
  const actions = Array.isArray(a) ? a : a ? [[a, b]] : [];
  const ms = Array.isArray(a) ? b : c;
  toastEl.innerHTML = `<span>${esc(msg)}</span>` + actions.map((x, i) => `<button data-ti="${i}">${esc(x[0])}</button>`).join('');
  toastEl.querySelectorAll('[data-ti]').forEach(btn => btn.onclick = () => { hideToast(); actions[+btn.dataset.ti][1](); });
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms || (actions.length ? 6000 : 3200));
}
function hideToast(){ toastEl.classList.remove('show'); }

/* ---------- suggest order preview (Build spec: Suggest order) ---------- */
function suggestPreview(){
  const open = scopeOpen();
  const next = [...open.filter(isTriaged).sort(byScore), ...open.filter(t => !isTriaged(t))];
  const pos = new Map(open.map((t, i) => [t.id, i]));
  const moved = next.filter((t, i) => pos.get(t.id) !== i).length;
  showModal(`<div class="sheet" role="dialog" aria-modal="true" aria-label="Suggested order"><h3>Suggested order</h3>
    <p>${moved ? `By score, highest first. ${plural(moved, 'task')} would move.` : 'Your order already matches the scores.'} Untriaged tasks stay at the bottom in their current order.</p>
    <div class="plist">${next.map((t, i) => {
      const d = pos.get(t.id) - i;
      return `<div><span class="num" style="width:1.6rem;text-align:right;color:var(--muted)">${i + 1}</span><span class="t">${esc(t.title)}</span><span class="num" style="color:var(--muted)">${fmtScore(score(t)) || 'no est.'}</span><span class="mv${d > 0 ? ' up' : ''}">${d > 0 ? `up ${d}` : d < 0 ? `down ${-d}` : 'same'}</span></div>`;
    }).join('')}</div>
    <footer><span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-accept${moved ? '' : ' disabled'}>Accept</button></footer></div>`,
    s => {
      const acc = s.querySelector('[data-accept]');
      if (!acc.disabled) acc.focus();
      acc.onclick = () => {
        const before = new Map(state.tasks.map(t => [t.id, t.rank]));
        closeModal();
        applyOrder(next.map(t => t.id));
        toast('Reordered by score', 'Undo', () => { state.tasks.forEach(t => { if (before.has(t.id)) t.rank = before.get(t.id); }); commit(); });
      };
    });
}

export { askText, closeMenu, closeModal, confirmBox, menuEl, modal, openListMenu, openScopeMenu, openThemeMenu, popMenu, showHelp, showModal, suggestPreview, toast, trapTab };
