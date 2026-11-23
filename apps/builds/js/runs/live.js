/* Builds 6.13.0: what opencode is doing right now, in an open card's popup. main.js polls the opencode connector's
   chat.messages for the open card's session while the popup is open (every 2.5 s while it works, once when idle) and
   keeps the newest turn's gist here: its thinking, its last few tool calls and its last words. No DOM. */
import { S } from './state.js';
import { h } from './view.js';

const THINK_MAX = 600;
const TEXT_MAX = 400;
const tail = (s, n) => { const t = String(s || '').replace(/\s+\n/g, '\n').trim(); return t.length > n ? '…' + t.slice(-n).replace(/^\S*\s/, '') : t; };

/** The newest assistant work after the last thing you (or a command) sent: {busy, activity, think, tools, text}. */
export function pickLive(r) {
  if (!r || !Array.isArray(r.turns)) return null;
  const turns = r.turns;
  let i = turns.length - 1;
  while (i >= 0 && turns[i].role !== 'you') i--;
  const parts = turns.slice(i + 1).filter(t => t.role === 'tandem').flatMap(t => t.parts || []);
  let think = '', text = '';
  const tools = [];
  for (const p of parts) {
    if (p.type === 'reasoning' && p.text) think = p.text;
    else if (p.type === 'text' && p.text) text = p.text;
    else if (p.type === 'tool') tools.push({ name: String(p.title || p.tool || 'Tool'), status: p.status || 'completed' });
    else if (p.type === 'subtask') tools.push({ name: 'Handed to ' + (p.agent || 'a subagent'), status: 'running' });
  }
  return { busy: !!r.busy, activity: r.activity || '', think: tail(think, THINK_MAX), tools: tools.slice(-4), text: tail(text, TEXT_MAX), at: Date.now() };
}

/** The session's feed, or null before the first read. */
export const liveOf = sid => (sid && S.liveFeed && S.liveFeed[sid]) || null;

/** The "Right now" block for a popup. `busy`: the session works (from the live state, fresher than the feed). */
export function liveHtml(sid, busy) {
  if (!sid) return '';
  const f = liveOf(sid);
  if (!f) return busy ? '<section class="ln-live on" aria-live="polite"><p class="ln-lh"><span class="ln-ldot"></span>Right now</p><p class="dim">Looking…</p></section>' : '';
  if (!f.think && !f.tools.length && !f.text) return '';
  const on = busy || f.busy;
  const tools = f.tools.length ? `<ul class="ln-ltools" role="list">${f.tools.map(t =>
    `<li class="s-${h(t.status)}"><span class="ln-lst" aria-hidden="true"></span>${h(t.name)}</li>`).join('')}</ul>` : '';
  const think = f.think ? `<p class="ln-lthink"><span class="ln-lk">Thinking</span>${h(f.think)}</p>` : '';
  const said = f.text ? `<p class="ln-lsaid">${h(f.text)}</p>` : '';
  return `<section class="ln-live${on ? ' on' : ''}" aria-live="polite"><p class="ln-lh"><span class="ln-ldot"></span>${on ? 'Right now' : 'Last thing it did'}` +
    `${on && f.activity ? `<span class="ln-lact">${h(f.activity)}</span>` : ''}</p>${think}${tools}${on ? '' : said}</section>`;
}
