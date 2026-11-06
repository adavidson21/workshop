/* Slate: the Roadmap tab. Runway runs in a frame inside Slate, and Slate stands in for the shell for it.

   Runway's SDK sees a same-origin parent and talks to it with the shell messages (docs/sdk.md, Shell messages).
   That parent is Slate's page, not the shell, so Slate answers them:
     ready              theme, route and visible, like the shell does
     open               to runway: the frame's own route (a `route` event back); to slate: Slate opens the item
                        (onOpenSlate); to any other app: passed on to the shell with Slate's own ws.open
     toast, notify      passed on to the shell with Slate's ws
     badge, status.*,
     commands.*         accepted and dropped: Runway is a tab here, its badge and top bar line are Slate's
   Theme changes are sent on as `theme` events. Data and connector calls never come here: Runway's SDK calls the
   agent (or the browser store) itself, as every app does. */

const SKIP = new Set(['badge', 'status.set', 'status.clear', 'commands.register', 'commands.unregister']);

/**
 * Host the frame `frame` (an <iframe>) for app `child` ('runway'). `ws` is Slate's own SDK. Returns
 * {route(path), theme(payload), stop()}. `win` is the window to listen on (tests pass a fake).
 */
export function hostFrame(frame, { ws, child = 'runway', onOpenSlate = () => {}, getRoute = () => '', win = window } = {}) {
  const origin = win.location.origin;
  let ready = false;
  const send = (m) => { try { frame.contentWindow && frame.contentWindow.postMessage({ workshop: 1, ...m }, origin); } catch { /* the frame is gone */ } };
  const event = (name, payload) => { if (ready) send({ kind: 'event', event: name, payload }); };

  async function answer(method, params = {}) {
    switch (method) {
      case 'ready':
        if (params.app !== child) throw Object.assign(new Error(`This frame is ${child}, not ${params.app}.`), { code: 'bad_request' });
        ready = true;
        return { theme: ws.theme.current(), route: getRoute() || '', visible: true };
      case 'open':
        if (params.app === child) { setTimeout(() => event('route', { path: params.path || '' })); return null; }
        if (params.app === 'slate') { onOpenSlate(params.path || ''); return null; }
        return ws.open({ app: params.app, path: params.path || '' });
      case 'toast': return ws.toast(params.text, { kind: params.kind });
      case 'notify': return ws.notify({ title: params.title, body: params.body });
      default:
        if (SKIP.has(method)) return null;
        throw Object.assign(new Error(`Slate does not handle ${method} for ${child}.`), { code: 'not_found' });
    }
  }

  function onMessage(e) {
    if (e.origin !== origin || !frame.contentWindow || e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || m.workshop !== 1 || m.kind !== 'request' || typeof m.id !== 'string') return;
    Promise.resolve().then(() => answer(m.method, m.params)).then(
      (result) => send({ kind: 'response', id: m.id, ok: true, result: result ?? null }),
      (err) => send({ kind: 'response', id: m.id, ok: false, error: { code: err && err.code || 'internal', message: err && err.message || 'Something went wrong.' } })
    );
  }
  win.addEventListener('message', onMessage);
  const offTheme = ws.on('theme', (p) => event('theme', p));
  return {
    route(path) { event('route', { path: path || '' }); },
    stop() { win.removeEventListener('message', onMessage); if (offTheme) offTheme(); ready = false; },
    get ready() { return ready; }
  };
}
