import { orderedLists } from './state.js';
import { addDays, dateStr, isDate, parseD, today } from './util.js';
import { activeProducts, matchProduct } from './products-link.js';
/* Prioritizer: Quick add syntax: @person >@person (delegated: waiting on them) !value !! ~effort ^due #list +product. */
/* ---------- quick add syntax (Build spec: Command bar syntax) ---------- */
const DOW = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
function parseDue(x){
  x = x.toLowerCase();
  if (x === 'today' || x === 'tod') return today();
  if (x === 'tomorrow' || x === 'tom' || x === 'tmr') return addDays(today(), 1);
  let m = x.match(/^\+(\d{1,3})([dw])$/);
  if (m) return addDays(today(), +m[1] * (m[2] === 'w' ? 7 : 1));
  if (x.length >= 3){
    const i = DOW.findIndex(d => d.startsWith(x));
    if (i >= 0){ const diff = ((i - new Date().getDay()) + 7) % 7 || 7; return addDays(today(), diff); }
  }
  if (isDate(x) && !isNaN(parseD(x)) && dateStr(parseD(x)) === x) return x;
  return null;
}
function findListPrefix(x){
  x = x.toLowerCase().replace(/[-_]/g, ' ');
  return orderedLists().find(l => l.name.toLowerCase().startsWith(x) || l.name.toLowerCase().replace(/\s+/g, '').startsWith(x.replace(/\s+/g, ''))) || null;
}
function parseQuick(text){
  const out = {people: [], delegate: false, value: null, effort: null, due: null, urgentFlag: false, listId: null, product: null};
  const keep = [];
  String(text || '').split(/\s+/).filter(Boolean).forEach(tok => {
    let m;
    if (tok === '!!'){ out.urgentFlag = true; return; }
    if ((m = tok.match(/^!([1-4])$/))){ out.value = 5 - +m[1]; return; }
    if ((m = tok.match(/^~(xs|s|m|l|xl)$/i))){ out.effort = m[1].toUpperCase(); return; }
    if ((m = tok.match(/^\^(.+)$/))){ const d = parseDue(m[1]); if (d){ out.due = d; return; } }
    if ((m = tok.match(/^#(.+)$/))){ const L = findListPrefix(m[1]); if (L){ out.listId = L.id; return; } }
    if ((m = tok.match(/^\+(.+)$/))){ const P = matchProduct(m[1], activeProducts()); if (P){ out.product = P.id; return; } }
    if ((m = tok.match(/^(>)?@([\p{L}\p{N}_'-]+(?:\.[\p{L}\p{N}_'-]+)*)$/u))){ out.people.push(m[2]); if (m[1]) out.delegate = true; return; }
    keep.push(tok);
  });
  out.title = keep.join(' ').trim();
  return out;
}

export { parseQuick };
