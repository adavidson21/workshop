/* Prioritizer: the Android app (mobile/). Only runs inside it (shared/device-fs.js, deviceAvailable).

   - The Back button closes what is on top (events.js, backStep). With nothing open on Today, the app goes
     to the background instead of closing, like other Android apps on their first screen.
   - The status bar and gesture bar icons follow Docket's theme: dark icons on the light theme, light icons
     on the dark one, including when the theme follows the phone's setting.

   Both go through Capacitor's native bridge (window.Capacitor): the App plugin for Back, and the
   SystemBars plugin that is part of Capacitor. */
import { deviceAvailable } from '../shared/device-fs.js';
import { backStep } from './events.js';

const quiet = (p) => { if (p && p.catch) p.catch(() => {}); };

/** The theme's scheme as the page shows it: 'dark' or 'light'. */
export function scheme(doc = document){
  return /dark/.test(getComputedStyle(doc.documentElement).colorScheme || '') ? 'dark' : 'light';
}

export function startNative({ win = window, doc = document, back = backStep } = {}){
  if (!deviceAvailable(win)) return false;
  const cap = win.Capacitor;
  if (typeof cap.addListener === 'function'){
    cap.addListener('App', 'backButton', () => { if (!back()) quiet(cap.nativePromise('App', 'minimizeApp', {})); });
  }
  let last = null;
  const bars = () => {
    const s = scheme(doc);
    if (s === last) return;
    last = s;
    // SystemBars' DARK style means light icons, for a dark background.
    quiet(cap.nativePromise('SystemBars', 'setStyle', { style: s === 'dark' ? 'DARK' : 'LIGHT' }));
  };
  bars();
  new MutationObserver(bars).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  if (typeof win.matchMedia === 'function'){
    const mq = win.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', bars);
  }
  return true;
}
