/* Chat (docs/chat.md): opencode in Workshop, working like the opencode TUI (Chat 2.0.0), plus the hub's
   ask-or-capture box. chat.js draws the sidebar, the chat in view and the composer; hub.js the box behind the Hub
   agent, which captures with rules or asks Tandem. Everything goes through the SDK: the opencode connector's chat.*
   and hub.* actions, and this app's own `handoffs` for captures (docs/handoffs.md).

   Routes: #/chat (New chat), #/chat/hub/<text> asks or captures <text> with the Hub, #/chat/<session> or
   #/chat/chat/<session> opens one chat (any opencode session in the workspace), #/chat/rewrite opens New chat on
   Rewrite (rewrite.js, a mode of New chat since Chat 2.2.0). Permission prompts and questions are answered in the chat; Builds' Inbox lists
   them too. */
import { placeName } from '../../../shared/sent.js';
import { connect } from '../../../shared/workshop-sdk.js';
import { mountBar } from '../../../shared/standalone-bar.js';
import { useApps } from '../../../shared/capture.js';
import { startHub } from './hub.js';
import { startChat } from './chat.js';
import { startRewrite } from './rewrite.js';

const ws = await connect({ app: 'chat' });
if (!ws.embedded) mountBar('Chat');
document.documentElement.classList.toggle('embed', ws.embedded);

const app = document.getElementById('app');
const hubEl = document.getElementById('hub');
const asksHtml = () => `<p class="chat-asks">Tandem is asking you something. <button type="button" class="lnk" data-open-inbox>Answer it in ${placeName('builds')}' Inbox</button></p>`;

// Capture targets and places follow the apps on this site (their manifests).
ws.apps.list().then(useApps).catch(() => {});

let chat = null;
const hub = startHub(ws, hubEl, {
  onThread: card => { if (chat) chat.opened(card); },
  onChange: () => { if (chat) chat.redraw(); },
  onStatus: () => { if (chat) chat.refresh(); },
  onQuick: text => !!(chat && chat.quick(text)),
  asksHtml
});
const rewrite = startRewrite(ws);
chat = startChat(ws, { hub, hubEl, rewrite, asksHtml, noteOf: (t, a) => hub.noteOf(t, a), aiReady: () => hub.status() });
app.appendChild(chat.el);
chat.mountHub();
chat.show(true);

app.addEventListener('click', e => {
  if (e.target.closest('[data-open-inbox]')) ws.open({ app: 'builds', path: 'inbox' });
  if (e.target.closest('[data-chat-rewrite]')) go('rewrite');
});

function route(path) {
  const p = String(path || '').replace(/^\/+/, '');
  if (p === 'rewrite') { chat.open(null, { rewrite: true }); return; }
  if (/^hub(\/|$)/.test(p)) { const text = decodeURIComponent(p.replace(/^hub\/?/, '')).trim(); chat.open(null, { hub: true }); if (text) hub.ask(text); else hub.focus(); return; }
  const sid = p.replace(/^chat\/?/, '').trim();
  chat.open(sid || null);
}
ws.on('route', r => route(r && r.path));
// Go somewhere in Chat, so the address (and Back) follow: through the shell when embedded.
function go(path) {
  if (ws.embedded) ws.open(path ? { app: 'chat', path } : { app: 'chat' }).catch(() => route(path));
  else { history.pushState(null, '', path ? '#/' + path : '#/'); route(path); }
}
ws.commands.register({ id: 'new', title: 'New chat' });
ws.commands.register({ id: 'rewrite', title: 'Rewrite a draft' });
ws.on('command', ({ id }) => { if (id === 'new') chat.open(null); if (id === 'rewrite') go('rewrite'); });
