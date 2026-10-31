/* Docket: the "Get the Android app" banner, on Docket's own page in a browser on an Android phone.

   The app (mobile/) keeps the board in its own storage on the phone, where the browser can't clear it. The
   banner links to the APK the Android workflow publishes (.github/workflows/android.yml). It shows until it
   is dismissed, never in the app itself, inside the Workshop shell, or on a computer. The app starts with an
   empty board: a backup downloaded here (the folder icon) and imported there moves it across. */
import { deviceAvailable } from '../../../shared/device-fs.js';

// The asset on the repo's docket-android release, replaced by every build of main.
export const APK_URL = 'https://github.com/adavidson21/workshop/releases/download/docket-android/docket.apk';
const DISMISSED = 'docket.appBanner.dismissed';

const CSS = `
.app-banner{display:flex;align-items:center;gap:.75rem;flex:none;padding:.7rem 16px;background:var(--panel);border-bottom:1px solid var(--line);color:var(--ink);font-size:.88rem;line-height:1.35}
.app-banner p{margin:0;flex:1;min-width:0}
.app-banner b{font-weight:600}
.app-banner span{color:var(--muted)}
.app-banner .btn{text-decoration:none;flex:none}
.app-banner .x{flex:none;width:2.1rem;height:2.1rem;display:grid;place-items:center;padding:0;border:0;border-radius:var(--r-sm);background:transparent;color:var(--muted);cursor:pointer}
.app-banner .x:hover{background:var(--hover);color:var(--ink)}
.app-banner .x svg{width:14px;height:14px}`;

/** Should this page offer the app? Exported for tests. */
export function wantsBanner({ ua = navigator.userAgent, native = deviceAvailable(), embedded = false, dismissed = null } = {}) {
  if (native || embedded || !/Android/i.test(ua)) return false;
  if (dismissed === null) { try { dismissed = !!localStorage.getItem(DISMISSED); } catch (e) { dismissed = false; } }
  return !dismissed;
}

export function mountAppBanner({ embedded = false } = {}) {
  if (!wantsBanner({ embedded }) || document.querySelector('.app-banner')) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('aside');
  el.className = 'app-banner';
  el.setAttribute('aria-label', 'Docket for Android');
  el.innerHTML = `<p><b>Docket is an Android app too.</b> <span>Your board stays on your phone, never on a server.</span></p>`
    + `<a class="btn primary" href="${APK_URL}" rel="noopener">Get the app</a>`
    + `<button class="x" type="button" aria-label="Dismiss"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>`;
  el.querySelector('.x').addEventListener('click', () => {
    try { localStorage.setItem(DISMISSED, new Date().toISOString()); } catch (e) { /* no storage: gone until reload */ }
    el.remove();
  });
  const bar = document.querySelector('.ws-bar');
  if (bar) bar.after(el); else document.body.prepend(el);
}
