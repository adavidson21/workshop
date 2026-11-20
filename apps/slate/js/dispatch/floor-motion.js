/* Loom floor motion (Loom 6.12.0). floor.js draws the floor as a string; this is the DOM half main.js calls around
   each paint:
   - captureFloor before the page is replaced, playFloor after: a card that changed station slides along the line to
     its new spot with a little hop (FLIP), and a card that just arrived drops onto the belt. Nothing moves on the
     first paint of the floor.
   - The looping animations (belt, bobbing, gate bumps) would restart on every repaint, so playFloor sets --ph, a
     negative delay from the clock, on the stage: every loop picks up where it was.
   - placePop puts the open card's popup beside the card and grows it out of the card (transform-origin on the card).
   Reduced motion: no FLIP, and the CSS drops the loops (loom.css). */
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const cards = root => root.querySelectorAll('.fl-floor .fl-card[data-lane-open]');

/** Where every card on the floor is now (null when the floor is not on screen). */
export function captureFloor(root) {
  if (!root || !root.querySelector('.fl-stage')) return null;
  const at = new Map();
  cards(root).forEach(el => { if (!at.has(el.getAttribute('data-lane-open'))) at.set(el.getAttribute('data-lane-open'), el.getBoundingClientRect()); });
  return at;
}

/** After a paint: keep the loops in phase, then move cards from where they were. */
export function playFloor(root, before) {
  const stage = root && root.querySelector('.fl-stage');
  if (!stage) return;
  const ph = (typeof performance !== 'undefined' ? performance.now() : Date.now()) % 2400;
  root.querySelector('.fl-floor').style.setProperty('--ph', `-${Math.round(ph)}ms`);
  if (!before || reduce() || typeof Element === 'undefined' || !Element.prototype.animate) return;
  const seen = new Set();
  cards(root).forEach(el => {
    const k = el.getAttribute('data-lane-open');
    if (seen.has(k)) return;
    seen.add(k);
    const a = before.get(k);
    const b = el.getBoundingClientRect();
    if (!a) {
      el.animate([{ transform: 'translateY(-22px) scale(.86)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 460, easing: 'cubic-bezier(.34,1.56,.64,1)' });
      return;
    }
    const dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    el.animate([
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: `translate(${dx / 2}px, ${dy / 2 - 12}px) rotate(${dx > 0 ? -2 : 2}deg)`, offset: 0.5 },
      { transform: 'none' }
    ], { duration: Math.min(1000, 420 + Math.hypot(dx, dy) * 0.6), easing: 'ease-in-out' });
  });
}

/** Put the popup beside its card, inside the window, with its tail pointing at the card. */
export function placePop(root, focusNew) {
  const pop = root && root.querySelector('.fl-pop');
  if (!pop) return;
  const k = pop.getAttribute('data-pop-for');
  const card = [...cards(root)].find(el => el.getAttribute('data-lane-open') === k);
  const vw = window.innerWidth, vh = window.innerHeight, gap = 14, pad = 12;
  const W = Math.min(460, vw - pad * 2);
  pop.style.width = W + 'px';
  const H = Math.min(pop.offsetHeight, vh - pad * 2);
  const r = card && card.getBoundingClientRect();
  const visible = r && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let left, top, side;
  if (!visible) {
    left = (vw - W) / 2; top = (vh - H) / 2; side = 'none';
  } else if (r.right + gap + W <= vw - pad) {
    left = r.right + gap; top = clamp(r.top - 24, pad, vh - H - pad); side = 'left';
  } else if (r.left - gap - W >= pad) {
    left = r.left - gap - W; top = clamp(r.top - 24, pad, vh - H - pad); side = 'right';
  } else {
    left = clamp(r.left + r.width / 2 - W / 2, pad, vw - W - pad);
    top = r.bottom + gap + H <= vh - pad ? r.bottom + gap : Math.max(pad, r.top - gap - H);
    side = top > r.top ? 'top' : 'bottom';
  }
  pop.style.left = Math.round(left) + 'px';
  pop.style.top = Math.round(top) + 'px';
  pop.setAttribute('data-side', side);
  if (visible) {
    const cx = r.left + r.width / 2 - left, cy = r.top + r.height / 2 - top;
    pop.style.transformOrigin = `${Math.round(cx)}px ${Math.round(cy)}px`;
    pop.style.setProperty('--tail', Math.round(side === 'left' || side === 'right' ? clamp(cy, 22, H - 22) : clamp(cx, 22, W - 22)) + 'px');
  } else {
    pop.style.transformOrigin = 'center';
  }
  if (focusNew && !pop.classList.contains('still')) {
    const x = pop.querySelector('[data-lane-close]');
    if (x) x.focus({ preventScroll: true });
  }
}
