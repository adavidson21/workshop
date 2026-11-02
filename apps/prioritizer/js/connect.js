/* Docket on its own site (docket.alexisdavidson.org): Connect to Workshop on this computer, from the file menu.
   Paired, the board is files in Workshop's data folder (shared with Workshop's Home) and ADO sync can use
   Workshop's connector. The pairing itself is shared/pair.js, the same code as Workshop's Connect button.
   Not offered inside Workshop (the shell pairs) or in the Android app (no agent on a phone). */
import { PAIR_HELP, canPair, forgetPairing, isPaired, pairWith } from '../shared/pair.js';
import { closeModal, showModal, toast } from './overlays.js';
import { esc } from './util.js';
import { embedded } from './ws.js';

/** The file menu's Connect or Disconnect item for this page, or ''. */
export function connectItems(ws){
  if (embedded) return '';
  if (canPair(ws)) return `<div class="sep"></div><button data-s="pair">Use Workshop on this computer</button>`;
  if (isPaired(ws)) return `<div class="sep"></div><button data-s="unpair">Stop using Workshop on this computer</button>`;
  return '';
}

/** Handle a file menu item from connectItems. Returns true if it was one. */
export function connectAction(name){
  if (name === 'pair'){ askPair(); return true; }
  if (name === 'unpair'){ forgetPairing(); return true; }
  return false;
}

function askPair(){
  showModal(`<form class="sheet small" role="dialog" aria-modal="true" aria-label="Use Workshop on this computer"><h3>Use Workshop on this computer</h3>
    <p>${esc(PAIR_HELP)} Your board in this browser stays here; to bring it along, download a backup first, then import it once connected.</p>
    <label style="display:grid;gap:.35rem;font-size:.85rem;color:var(--muted)">Port <input type="number" min="1024" max="65535" value="4380" required aria-label="Port"></label>
    <footer><span class="grow"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Continue</button></footer></form>`,
    f => {
      const i = f.querySelector('input'); i.focus(); i.select();
      f.addEventListener('submit', e => {
        e.preventDefault();
        const port = Math.round(Number(i.value));
        if (!(port >= 1024 && port <= 65535)) return i.focus();
        closeModal();
        const r = pairWith(port, {onError: m => toast(m)});
        toast(r === 'blocked' ? 'Your browser blocked the window. Allow pop-ups for this site and try again.'
          : 'In the window that opened, allow this site. Docket reloads once it is connected.');
      });
    });
}
