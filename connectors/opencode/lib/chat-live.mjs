// opencode connector: Chat's live answers (Chat 4.5.0, connector 1.37.0). Before this, Chat read a busy chat once a
// second and an answer showed in three or four jumps. Now, for a chat a page is looking at, opencode's stream is
// passed on as connector events:
//
//   chat.text    {session, part, text}   the whole text so far of the answer part being written (at most every 80 ms)
//   chat.changed {session}               something else moved (a tool call, a step, a prompt, busy or idle): read it
//
// Only sessions a page read with chat.messages in the last two minutes are passed on, so a hands-off build does not
// flood every open page. Events stay well under the agent's 64 KB limit (the text is cut at MAX_TEXT).

import { emit } from "./live.mjs";

export const WATCH_MS = 120000;
export const TEXT_MS = 80;
export const CHANGED_MS = 150;
export const MAX_TEXT = 20000;

const watched = new Map(); // session -> last read (ms)
const pend = new Map(); // session -> {texts: Map(part -> text), changed, timer}

export function resetChatLive() {
  for (const p of pend.values()) clearTimeout(p.timer);
  pend.clear();
  watched.clear();
}

/** A page read this chat: pass its stream on for the next two minutes. */
export function watchChat(session, now = Date.now()) {
  if (!session) return;
  watched.set(session, now);
  if (watched.size > 200) for (const [k, at] of watched) if (now - at > WATCH_MS) watched.delete(k);
}

export const isWatched = (session, now = Date.now()) => {
  const at = watched.get(session);
  return at != null && now - at <= WATCH_MS;
};

function slot(session, ms, send) {
  let p = pend.get(session);
  if (!p) { p = { texts: new Map(), changed: false, timer: null }; pend.set(session, p); }
  if (!p.timer) p.timer = setTimeout(() => flush(session, send), ms);
  return p;
}

function flush(session, send) {
  const p = pend.get(session);
  if (!p) return;
  pend.delete(session);
  for (const [part, text] of p.texts) send("chat.text", { session, part, text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text });
  if (p.changed) send("chat.changed", { session });
}

/** opencode streamed more of an answer part. `send` is for tests. */
export function chatText(session, part, text, { send = emit, now = Date.now() } = {}) {
  if (!session || !part || !isWatched(session, now)) return false;
  slot(session, TEXT_MS, send).texts.set(part, String(text || ""));
  return true;
}

/** Something other than answer text moved in a chat. */
export function chatChanged(session, { send = emit, now = Date.now() } = {}) {
  if (!session || !isWatched(session, now)) return false;
  slot(session, CHANGED_MS, send).changed = true;
  return true;
}
