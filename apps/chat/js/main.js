/* Chat (docs/chat.md): conversations with Tandem and the hub's ask-or-capture box, as their own app since
   Loom 4.8.0. chat.js draws the sidebar and the chat in view; hub.js the New chat box, which captures with
   rules or asks Tandem. Everything goes through the SDK: the opencode connector's chat.* and hub.* actions,
   and this app's own `handoffs` for captures (docs/handoffs.md).

   Routes: #/chat (New chat), #/chat/hub/<text> asks or captures <text>, #/chat/<session> or
   #/chat/chat/<session> opens one chat. When Tandem asks you something in a chat, Loom's Inbox has it. */
import { connect } from '../../../shared/workshop-sdk.js';
import { mountBar } from '../../../shared/standalone-bar.js';
import { useApps } from '../../../shared/capture.js';
import { startHub } from './hub.js';
import { startChat } from './chat.js';

const ws = await connect({ app: 'chat' });
if (!ws.embedded) mountBar('Chat');
document.documentElement.classList.toggle('embed', ws.embedded);

const app = document.getElementById('app');
const hubEl = document.getElementById('hub');
const asksHtml = () => '<p class="chat-asks">Tandem is asking you something. <button type="button" class="lnk" data-open-inbox>Answer it in Loom\'s Inbox</button></p>';

// Capture targets and places follow the apps on this site (their manifests).
ws.apps.list().then(useApps).catch(() => {});

let chat = null;
const hub = startHub(ws, hubEl, {
  onThread: card => { if (chat) chat.opened(card); },
  onChange: () => { if (chat) chat.redraw(); },
  onStatus: () => { if (chat) chat.refresh(); },
  asksHtml
});
chat = startChat(ws, { hub, hubEl, asksHtml, noteOf: (t, a) => hub.noteOf(t, a), aiReady: () => hub.status() });
app.appendChild(chat.el);
chat.mountHub();
chat.show(true);

app.addEventListener('click', e => {
  if (e.target.closest('[data-open-inbox]')) ws.open({ app: 'slate', path: 'inbox' });
});

function route(path) {
  const p = String(path || '').replace(/^\/+/, '');
  if (/^hub(\/|$)/.test(p)) { const text = decodeURIComponent(p.replace(/^hub\/?/, '')).trim(); chat.open(null); if (text) hub.ask(text); else hub.focus(); return; }
  const sid = p.replace(/^chat\/?/, '').trim();
  chat.open(sid || null);
  if (!sid) hub.focus();
}
ws.on('route', r => route(r && r.path));
ws.commands.register({ id: 'new', title: 'New chat' });
ws.on('command', ({ id }) => { if (id === 'new') { chat.open(null); hub.focus(); } });
