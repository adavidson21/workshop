/* The workbench (Chat 4.0.0, docs/chat.md, Workbench): a panel beside the chat with what Claude's desktop app keeps
   next to a conversation, so you never leave Chat for them: a Terminal (terminal.js), Files to browse and edit the
   workspace (files.js), and a Side chat for questions that should not land in the chat (side.js). Since Chat 4.1.0
   also Changes, what the chat changed with line comments (changes.js), and a Second chat beside it (split.js).

   It is an element of its own that chat.js never redraws, so a running terminal or a file being edited keeps its
   state while the chat updates. One tab shows at a time. Whether it is open, which tab, and its width (drag its
   left edge) are kept in this browser. On a narrow window it lies over the chat instead of beside it (chat.css). */
const KEY = 'chat.bench';
export const TABS = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'files', label: 'Files' },
  { id: 'changes', label: 'Changes' },
  { id: 'side', label: 'Side chat' },
  { id: 'split', label: 'Second chat' }
];
export const MIN_W = 320;
export const MAX_W = 1200;
export const clampWidth = (w, room = Infinity) => Math.round(Math.max(MIN_W, Math.min(MAX_W, room - 360, Number(w) || 520)));
const X = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/></svg>';

function readState() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* blocked or bad */ }
  const tab = s && TABS.some(t => t.id === s.tab) ? s.tab : 'terminal';
  return { open: !!(s && s.open), tab, width: clampWidth(s && s.width) };
}

export function startBench({ tools, onChange = () => {} }) {
  const el = document.createElement('aside');
  el.className = 'bench';
  el.setAttribute('aria-label', 'Workbench');
  const state = readState();
  el.innerHTML = '<div class="bench-grip" role="separator" aria-orientation="vertical" aria-label="Resize the panel" tabindex="0"></div>' +
    `<header class="bench-top"><div class="bench-tabs" role="tablist">${TABS.map(t => `<button type="button" role="tab" class="bench-tab" data-bench-tab="${t.id}" aria-controls="bench-${t.id}">${t.label}</button>`).join('')}</div>` +
    `<button type="button" class="chat-icon" data-bench-close title="Close the panel" aria-label="Close the panel">${X}</button></header>` +
    `<div class="bench-body">${TABS.map(t => `<section class="bench-pane" id="bench-${t.id}" role="tabpanel" data-bench-pane="${t.id}" aria-label="${t.label}"></section>`).join('')}</div>`;
  for (const t of TABS) if (tools[t.id]) el.querySelector(`[data-bench-pane="${t.id}"]`).appendChild(tools[t.id].el);

  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* blocked */ } }
  function apply(focus = false) {
    el.hidden = !state.open;
    for (const b of el.querySelectorAll('[data-bench-tab]')) { const on = b.dataset.benchTab === state.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    for (const p of el.querySelectorAll('[data-bench-pane]')) p.hidden = p.dataset.benchPane !== state.tab;
    onChange({ ...state });
    for (const t of TABS) if (tools[t.id]) tools[t.id].show(state.open && state.tab === t.id);
    if (focus && state.open && tools[state.tab]) setTimeout(() => tools[state.tab].focus(), 0);
  }
  function open(tab, { focus = true } = {}) {
    if (tab && TABS.some(t => t.id === tab)) state.tab = tab;
    state.open = true; save(); apply(focus);
  }
  function close() { state.open = false; save(); apply(); }
  function toggle(tab) { if (state.open && (!tab || tab === state.tab)) close(); else open(tab); }

  el.addEventListener('click', e => {
    const b = e.target.closest('[data-bench-tab],[data-bench-close]');
    if (!b) return;
    if (b.dataset.benchClose != null) close(); else open(b.dataset.benchTab);
  });
  el.querySelector('.bench-tabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex(t => t.id === state.tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length].id;
    open(next, { focus: false });
    el.querySelector(`[data-bench-tab="${next}"]`).focus();
  });

  /* Resizing: drag the left edge, or use the arrow keys on it. */
  const grip = el.querySelector('.bench-grip');
  const room = () => (el.parentElement ? el.parentElement.getBoundingClientRect().width : window.innerWidth);
  function setWidth(w, keep = false) { state.width = clampWidth(w, room()); if (keep) save(); onChange({ ...state }); }
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const right = el.getBoundingClientRect().right;
    el.classList.add('sizing');
    const move = ev => setWidth(right - ev.clientX);
    const up = () => { el.classList.remove('sizing'); grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); setWidth(state.width, true); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(state.width + 32, true); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(state.width - 32, true); }
  });

  return {
    el,
    open,
    close,
    toggle,
    /** Shows the saved state once the chat is on the page. */
    start() { apply(); },
    state: () => ({ ...state })
  };
}
