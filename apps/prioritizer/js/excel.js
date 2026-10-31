import { COLORS, EFFORTS, EQ, VALUE, VQ } from './constants.js';
import { score } from './model.js';
import { closeModal, showModal, toast } from './overlays.js';
import { commit, listById, migrateTask, orderedLists, sanitize, setState, state, topLists } from './state.js';
import { dateStr, isDate, plural, todayStr, uid } from './util.js';
import { saveFile } from '../../../shared/save-file.js';
/* Prioritizer: Excel export and import (SheetJS, vendored in shared/vendor/). */
/* ---------- excel export / import ---------- */
const HEADERS = ['Rank','Task','Notes','Status','Completed On','Value','Effort','Due','Urgent','Score','Focus On','Waiting','Nudge On','People','Age From','Created','ID','ADO ID','ADO Type','ADO State','ADO Link','PR Key','PR Link'];
const NO_XLSX = 'Excel tools did not load. Reload the page.';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// An Excel file as a download, or the share sheet in the Android app (shared/save-file.js).
async function saveWorkbook(wb, name, done){
  try {
    const how = await saveFile(name, XLSX.write(wb, {bookType: 'xlsx', type: 'array'}), XLSX_TYPE);
    if (how !== 'canceled') toast(done);
  } catch (e){ toast('Could not save the Excel file.'); }
}
function exportXlsx(){
  if (!window.XLSX){ toast(NO_XLSX); return; }
  return saveWorkbook(buildWorkbook(), `prioritizer-${todayStr()}.xlsx`, 'Exported to Excel');
}
function buildWorkbook(){
  const wb = XLSX.utils.book_new();
  const ordered = orderedLists();
  const used = new Set(['lists']), sheetOf = new Map();
  ordered.forEach(l => {
    const base = (l.name.replace(/[\\\/\?\*\[\]:]/g, ' ').trim() || 'List').slice(0, 31);
    let n = base, i = 2;
    while (used.has(n.toLowerCase())){ const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf; }
    used.add(n.toLowerCase()); sheetOf.set(l.id, n);
  });
  ordered.forEach(l => {
    const ts = state.tasks.filter(t => t.listId === l.id).sort((a,b) => (a.done - b.done) || a.rank - b.rank);
    let r = 0;
    const rows = ts.map(t => ({
      'Rank': t.done ? '' : ++r, 'Task': t.title, 'Notes': t.notes || '',
      'Status': t.wontDo ? "Won't do" : t.done ? 'Done' : 'Open', 'Completed On': t.doneAt || '',
      'Value': t.value ? VALUE[t.value] : '', 'Effort': t.effort || '', 'Due': t.due || '', 'Urgent': t.urgentFlag ? 'Yes' : '',
      'Score': score(t) == null ? '' : Math.round(score(t) * 10) / 10,
      'Focus On': t.focusOn || '', 'Waiting': t.waiting ? 'Yes' : '', 'Nudge On': t.nudgeOn || '', 'People': t.people.join(', '),
      'Age From': t.ageFrom || '', 'Created': t.createdAt || '', 'ID': t.id,
      'ADO ID': t.ado ? t.ado.id : '', 'ADO Type': t.ado ? t.ado.type : '', 'ADO State': t.ado ? t.ado.state : '', 'ADO Link': t.ado ? t.ado.url : '',
      'PR Key': t.pr ? t.pr.key : '', 'PR Link': t.pr ? t.pr.url : ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows, {header: HEADERS});
    ws['!cols'] = [6,40,40,9,13,9,7,11,8,7,11,8,11,20,11,11,12,8,10,10,30,30,30].map(w => ({wch: w}));
    XLSX.utils.book_append_sheet(wb, ws, sheetOf.get(l.id));
  });
  const meta = XLSX.utils.json_to_sheet(ordered.map(l => ({
    'Sheet': sheetOf.get(l.id), 'List Name': l.name, 'Parent List': l.parentId ? listById(l.parentId).name : '', 'ID': l.id
  })), {header: ['Sheet','List Name','Parent List','ID']});
  meta['!cols'] = [{wch: 32},{wch: 32},{wch: 32},{wch: 12}];
  XLSX.utils.book_append_sheet(wb, meta, 'Lists');
  return wb;
}
const norm = s => String(s ?? '').trim().toLowerCase();
function getter(row){
  const m = new Map(Object.keys(row).map(k => [k.trim().toLowerCase(), row[k]]));
  return k => m.has(k) ? m.get(k) : '';
}
function yn(v){
  if (v === true) return true; if (v === false) return false;
  const s = norm(v);
  if (['yes','y','true','1','x'].includes(s)) return true;
  if (['no','n','false','0'].includes(s)) return false;
  return null;
}
// Value: Trivial/Low/Medium/High or 1 to 4; v1 High/Low map through the migration (high 4, low 2)
function parseValue(v){
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 4 ? v : null;
  const s = norm(v); if (!s) return null;
  if (/^[1-4]$/.test(s)) return +s;
  const m = {trivial: 1, low: 2, lo: 2, medium: 3, med: 3, high: 4, hi: 4, h: 4};
  return m[s] || null;
}
function parseEffort(v){
  const s = norm(v); if (!s) return null;
  const up = s.toUpperCase();
  if (EFFORTS.includes(up)) return up;
  const m = {high: 'L', hi: 'L', h: 'L', low: 'S', lo: 'S', small: 'S', medium: 'M', med: 'M', large: 'L', 'extra small': 'XS', 'extra large': 'XL', '1': 'XS', '2': 'S', '3': 'M', '5': 'L', '8': 'XL'};
  return m[s] || null;
}
function findQuad(Q, v){
  const s = norm(v).replace(/s$/, ''); if (!s) return null;
  return Object.keys(Q).find(k => norm(Q[k].title).replace(/s$/, '') === s || k === s) || null;
}
function toDate(v){
  if (v instanceof Date && !isNaN(v)) return dateStr(v);
  if (typeof v === 'number' && v > 20000) return dateStr(new Date(Math.round((v - 25569) * 864e5) + new Date().getTimezoneOffset() * 6e4));
  const s = String(v ?? '').trim(); if (!s) return null;
  if (isDate(s)) return s;
  const d = new Date(s); return isNaN(d) ? null : dateStr(d);
}
function parseWorkbook(wb){
  const metaName = wb.SheetNames.find(n => norm(n) === 'lists');
  const meta = new Map();
  if (metaName){
    XLSX.utils.sheet_to_json(wb.Sheets[metaName], {defval: ''}).forEach(r => {
      const g = getter(r), sheet = String(g('sheet')).trim();
      if (sheet) meta.set(sheet.toLowerCase(), {name: String(g('list name') || sheet).trim(), parent: String(g('parent list')).trim(), id: String(g('id')).trim()});
    });
  }
  const seen = new Set();
  const keepId = v => { v = String(v ?? '').trim(); if (!v || seen.has(v)) v = uid(); seen.add(v); return v; };
  const lists = [], byName = new Map();
  wb.SheetNames.filter(n => n !== metaName).forEach(sn => {
    const m = meta.get(sn.toLowerCase()) || {name: sn, parent: '', id: ''};
    const l = {id: keepId(m.id), name: m.name, parentId: null, _parent: m.parent, _sheet: sn};
    lists.push(l);
    if (!byName.has(m.name.toLowerCase())) byName.set(m.name.toLowerCase(), l);
  });
  lists.forEach(l => {
    if (!l._parent) return;
    const p = byName.get(l._parent.toLowerCase());
    if (p && p !== l && !p._parent) l.parentId = p.id;
  });
  const tasks = []; let rank = 0, ci = 0;
  lists.forEach(l => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[l._sheet], {defval: '', raw: true});
    const parsed = [];
    rows.forEach((r, i) => {
      const g = getter(r);
      const title = String(g('task') || g('title') || g('name')).trim();
      if (!title) return;
      let urgent = yn(g('urgent')), important = yn(g('important'));
      const eq = findQuad(EQ, g('eisenhower'));
      if (urgent == null && important == null && eq){ urgent = eq === 'do' || eq === 'delegate'; important = eq === 'do' || eq === 'schedule'; }
      let value = parseValue(g('value')), effort = parseEffort(g('effort'));
      const vq = findQuad(VQ, g('value/effort') || g('value / effort'));
      if (value == null && effort == null && vq){ value = (vq === 'quick' || vq === 'big') ? 4 : 2; effort = (vq === 'quick' || vq === 'fill') ? 'S' : 'L'; }
      const st = norm(g('status')).replace(/[’`]/g, "'");
      const wont = /^won'?t( do)?$|^wont( do)?$/.test(st);
      const done = wont || ['done','complete','completed','closed','yes','true','x'].includes(st);
      const c = norm(g('color'));
      const rkRaw = g('rank'), rk = Number(rkRaw);
      parsed.push({i, rk: String(rkRaw).trim() !== '' && Number.isFinite(rk) ? rk : Infinity, t: {
        id: keepId(g('id')), title, notes: String(g('notes')).trim(), color: COLORS.includes(c) ? c : COLORS[ci++ % COLORS.length], rank: 0,
        value, effort, urgent, important, due: toDate(g('due')), listId: l.id, done, wontDo: wont,
        doneAt: done ? (toDate(g('completed on')) || todayStr()) : null,
        focusOn: toDate(g('focus on')), waiting: yn(g('waiting')) === true, nudgeOn: toDate(g('nudge on')),
        people: String(g('people')).split(',').map(x => x.trim()).filter(Boolean),
        createdAt: toDate(g('created')) || todayStr(), ageFrom: toDate(g('age from')),
        ado: g('ado id') !== '' ? {id: g('ado id'), type: String(g('ado type')), state: String(g('ado state')), url: String(g('ado link'))} : null,
        pr: g('pr key') !== '' ? {key: String(g('pr key')), url: String(g('pr link'))} : null
      }});
    });
    parsed.sort((a,b) => (a.t.done - b.t.done) || (a.rk - b.rk) || (a.i - b.i)).forEach(p => { p.t.rank = ++rank; tasks.push(p.t); });
  });
  lists.forEach(l => { delete l._parent; delete l._sheet; });
  tasks.forEach(migrateTask);
  return {lists, tasks};
}
function doImport(p, mode){
  if (mode === 'replace'){ state.lists = p.lists; state.tasks = p.tasks; }
  else {
    // fresh ids so an imported copy never collides with what's already here
    const lmap = new Map(p.lists.map(l => [l.id, uid()]));
    p.lists.forEach(l => { l.id = lmap.get(l.id); if (l.parentId) l.parentId = lmap.get(l.parentId); });
    p.tasks.forEach(t => { t.id = uid(); t.listId = lmap.get(t.listId); });
    const names = new Set(topLists().map(l => l.name.toLowerCase()));
    p.lists.filter(l => !l.parentId).forEach(l => {
      let n = l.name, i = 2;
      while (names.has(n.toLowerCase())) n = `${l.name} (${i++})`;
      l.name = n; names.add(n.toLowerCase());
    });
    const off = state.tasks.reduce((m,t) => Math.max(m, t.rank), 0);
    p.tasks.forEach(t => t.rank += off);
    state.lists.push(...p.lists); state.tasks.push(...p.tasks);
  }
  setState(sanitize(state));
  commit();
  toast(`Imported ${plural(p.tasks.length,'task')}`);
}
function importFile(file){
  if (!window.XLSX){ toast(NO_XLSX); return; }
  const reader = new FileReader();
  reader.onload = () => {
    let p;
    try { p = parseWorkbook(XLSX.read(new Uint8Array(reader.result), {type: 'array', cellDates: true})); }
    catch(e){ toast('Could not read that file.'); return; }
    if (!p.lists.length){ toast('No lists found in that file.'); return; }
    const isEmpty = !state.tasks.length && state.lists.length === 1;
    if (isEmpty) return doImport(p, 'replace');
    showModal(`<div class="sheet small" role="dialog" aria-modal="true" aria-label="Import"><h3>Import ${plural(p.tasks.length,'task')}</h3>
      <p>From ${plural(p.lists.length,'list')}. How should they come in?</p>
      <div class="choice">
        <button class="opt" data-imp="add"><b>Add as new lists</b><span>Keep everything you have.</span></button>
        <button class="opt" data-imp="replace"><b>Replace my board</b><span>Swap everything for this file. Good for restoring a backup.</span></button>
      </div>
      <footer><span class="grow"></span><button class="btn" data-close>Cancel</button></footer></div>`,
      s => s.addEventListener('click', e => {
        const b = e.target.closest('[data-imp]'); if (!b) return;
        closeModal(); doImport(p, b.dataset.imp);
      }));
  };
  reader.readAsArrayBuffer(file);
}

export { NO_XLSX, buildWorkbook, doImport, exportXlsx, importFile, parseWorkbook, saveWorkbook };
