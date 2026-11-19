/* Pictures for a message (Chat 4.0.0, docs/chat.md, Pictures): paste or drop a PNG, JPEG, GIF or WebP into the
   composer and it goes to opencode with the message. Workshop's agent takes 1 MB per request, so a big picture is
   shrunk here before it is sent: at most 2000 pixels on its long side, then smaller, or as a JPEG, until it fits.
   Up to MAX pictures in one message, BUDGET base64 characters together (the connector takes 920000).

   A picture: {id, name, mime, data (base64), url (a data: URL, for the preview)}. The page keeps previews in a Map
   by id and sets <img> sources after drawing, so the chat's HTML never carries the pictures (chat.js, paint). */
export const MAX = 4;
export const BUDGET = 880000;
export const EACH = 600000;
export const LONG_EDGE = 2000;
export const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** The picture files in a paste or a drop. A paste that also has text is text (copying from a document can carry both). */
export function picturesIn(dt, { paste = false } = {}) {
  if (!dt) return [];
  if (paste && typeof dt.getData === 'function' && String(dt.getData('text/plain') || '').trim()) return [];
  const out = [];
  for (const f of Array.from(dt.files || [])) if (f && /^image\//.test(f.type)) out.push(f);
  if (!out.length) for (const it of Array.from(dt.items || [])) if (it && it.kind === 'file' && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) out.push(f); }
  return out;
}

/** How many base64 characters the next picture may take, given those already in the message (0: no room left). */
export function roomFor(pictures) {
  const list = pictures || [];
  if (list.length >= MAX) return 0;
  const used = list.reduce((n, p) => n + p.data.length, 0);
  const left = BUDGET - used;
  return left < 40000 ? 0 : Math.min(EACH, left);
}

/** A name for the picture, with the extension of the type it is sent as. */
export function nameFor(name, mime) {
  const base = String(name || '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^A-Za-z0-9 ._()-]/g, '').trim().slice(0, 60) || 'pasted';
  return `${base}.${EXT[mime] || 'png'}`;
}

const b64len = url => url.length - url.indexOf(',') - 1;
const make = (name, mime, url) => ({ id: 'p' + Math.random().toString(36).slice(2, 10), name: nameFor(name, mime), mime, data: url.slice(url.indexOf(',') + 1), url });
function readUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('That picture could not be read.'));
    r.readAsDataURL(file);
  });
}

/** One file as a picture to send, shrunk to fit `budget` base64 characters. Rejects with a plain-words error. */
export async function toPicture(file, budget) {
  if (!budget) throw new Error(`One message takes up to ${MAX} pictures. Send this one, then paste more.`);
  const mime = TYPES.includes(file.type) ? file.type : null;
  let bmp = null;
  try { bmp = await createImageBitmap(file); } catch (e) { if (!mime) throw new Error('That picture could not be read. Use PNG, JPEG, GIF or WebP.'); }
  const long = bmp ? Math.max(bmp.width, bmp.height) : 0;
  if (mime && file.size <= budget * 0.74 && long <= LONG_EDGE) {
    const url = await readUrl(file);
    if (url.startsWith(`data:${mime};base64,`) && b64len(url) <= budget) { if (bmp && bmp.close) bmp.close(); return make(file.name, mime, url); }
  }
  if (!bmp) throw new Error('That picture is too big to send.');
  const opaque = mime === 'image/jpeg';
  const tries = mime === 'image/png' || mime === 'image/gif' ? [['image/png'], ['image/jpeg', 0.88], ['image/jpeg', 0.75]] : [['image/jpeg', 0.88], ['image/jpeg', 0.75]];
  try {
    for (const edge of [LONG_EDGE, 1600, 1280, 1024, 800, 640]) {
      const scale = Math.min(1, edge / long);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * scale));
      c.height = Math.max(1, Math.round(bmp.height * scale));
      const g = c.getContext('2d');
      for (const [type, q] of tries) {
        // A JPEG has no transparency: paint white under it, as a screenshot tool would.
        g.clearRect(0, 0, c.width, c.height);
        if (type === 'image/jpeg' && !opaque) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); }
        g.drawImage(bmp, 0, 0, c.width, c.height);
        const url = c.toDataURL(type, q);
        if (url.startsWith(`data:${type};base64,`) && b64len(url) <= budget) return make(file.name, type, url);
      }
    }
  } finally { if (bmp.close) bmp.close(); }
  throw new Error('That picture is too big to send, even shrunk.');
}

/** Adds the files to `list` as pictures, one at a time so each knows the room left. Returns the errors, if any. */
export async function addPictures(list, files) {
  const errors = [];
  for (const f of files) {
    try { list.push(await toPicture(f, roomFor(list))); }
    catch (e) { errors.push(e.message || 'That picture could not be added.'); }
  }
  return errors;
}

/** The chips above the box: each picture's preview (filled in by paint) and a remove button. */
export function chipsHtml(list, attr) {
  if (!list || !list.length) return '';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return `<div class="pics">${list.map(p => `<span class="pic"><img alt="${esc(p.name)}" data-img-local="${esc(p.id)}"><button type="button" class="pic-x" ${attr}="${esc(p.id)}" title="Remove ${esc(p.name)}" aria-label="Remove ${esc(p.name)}">×</button></span>`).join('')}</div>`;
}
