/* Several chats at once (Chat 4.2.0, docs/chat.md, Several chats): what Claude's desktop app does for parallel
   sessions. A chat that finishes or starts waiting on you while you look elsewhere (another chat, another app, or
   the window in the background) sends a notification if you turned alerts on, and keeps a dot in the list until you
   open it. Keys move between chats without the mouse. Browsers keep Ctrl+N and Ctrl+Tab for themselves, so Chat
   uses Alt: Alt+N new chat, Alt+Up and Alt+Down the chat above or below, Alt+J the next one that needs you.
   Pure helpers here; chat.js wires them. */

export const ALERTS_KEY = 'chat.alerts';

/**
 * What changed between two reads of the chat list: {events: [{kind: 'done' | 'needs', session, title}], next}.
 * `prev` is the last read ({session: {busy, waiting}}), null on the first one (no events then). Sessions from
 * outside Chat (Tandem's runs, PR reviews: from 'opencode') are left to Builds, which alerts for those.
 */
export function chatEvents(prev, list) {
  const next = { ...(prev || {}) };
  const events = [];
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || !c.session || c.from === 'opencode') continue;
    const was = prev && prev[c.session];
    const now = { busy: !!c.busy, waiting: !!c.waiting };
    if (was) {
      if (now.waiting && !was.waiting) events.push({ kind: 'needs', session: c.session, title: c.title || 'Chat' });
      else if (was.busy && !now.busy && !now.waiting) events.push({ kind: 'done', session: c.session, title: c.title || 'Chat' });
    }
    next[c.session] = now;
  }
  return { events, next };
}

/** The notification for an event. */
export function alertText(ev) {
  return ev.kind === 'needs'
    ? { title: `${ev.title} needs you`, body: 'opencode is asking you something in Chat.' }
    : { title: `${ev.title} is done`, body: 'The agent finished its turn.' };
}

/** The chat above (dir -1) or below (dir 1) `sel` in the list's order, wrapping; the first one when none is open. */
export function stepChat(order, sel, dir) {
  const list = Array.isArray(order) ? order : [];
  if (!list.length) return null;
  const i = list.indexOf(sel);
  if (i < 0) return dir < 0 ? list[list.length - 1] : list[0];
  return list[(i + dir + list.length) % list.length];
}

/** The next chat after `sel` (wrapping) that needs you: waiting on you, or finished while you were away. */
export function nextNeedy(order, sel, needs) {
  const list = (Array.isArray(order) ? order : []).filter(s => needs(s));
  if (!list.length) return null;
  const all = Array.isArray(order) ? order : [];
  const at = all.indexOf(sel);
  return list.find(s => all.indexOf(s) > at) || list[0];
}

/** Chat's keys: 'new', 'prev', 'next', 'jump', or null. */
export function chatKey(e) {
  if (!e || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.code === 'KeyN') return 'new';
  if (e.code === 'KeyJ') return 'jump';
  if (e.key === 'ArrowUp') return 'prev';
  if (e.key === 'ArrowDown') return 'next';
  return null;
}

/** Whether alerts are wanted in this browser (on unless turned off), and the browser lets this site send them. */
export function alertsState(storage, Notif) {
  let off = false;
  try { off = storage && storage.getItem(ALERTS_KEY) === 'off'; } catch (e) { /* blocked */ }
  const perm = typeof Notif === 'function' ? Notif.permission : 'unsupported';
  return { off, perm, on: !off && perm === 'granted' };
}
