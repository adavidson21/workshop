import { wontDo } from './actions.js';
import { EFFORTS, EQ, ICON, POINTS, VALUE, VQ, WINDOW } from './constants.js';
import { ageDays, byScore, eKey, fmtScore, isStale, isTriaged, nudgeDue, score, vKey } from './model.js';
import { toast } from './overlays.js';
import { capacityCut, doneGroup, emptyHTML, main, openQuad, prevView, render, row, setView, showAllPick, tri, weekOff } from './render.js';
import { commit, findTask, inScope, initials, isDoneToday, isFocus, listById, orderedLists, scopeListIds, scopeOpen, state, triageQueue } from './state.js';
import { $, addDays, dateStr, esc, fmtDay, fmtMD, parseD, plural, todayStr } from './util.js';
/* Prioritizer: The views: Prioritize (list, matrices, and Done with the weekly recap), Today, Triage, People. */
function renderRank(){
  const open = scopeOpen();
  const done = state.tasks.filter(t => inScope(t) && isDoneToday(t)).sort((a,b) => (b.doneAt || '').localeCompare(a.doneAt || '') || a.rank - b.rank);
  if (!open.length && !done.length){ main.innerHTML = emptyHTML; return; }
  const {cut, sum} = capacityCut(open);
  const over = sum > state.capacity;
  let html = '';
  open.forEach((t, i) => {
    html += row(t, {rank: i + 1, top: i < 3, estimate: true});
    if (i === cut){
      html += `<div class="capline${over ? ' over' : ''}" role="separator"><span><b class="num">${sum}</b> of <span class="num">${state.capacity}</span> pts this week${i === open.length - 1 ? (over ? '' : '. Room for more.') : ''}</span></div>`;
      if (i < open.length - 1) html += `<div class="belowcap">Not this week</div>`;
    }
  });
  main.innerHTML = `<div class="ranklist rows dropzone" data-zone="rank">${html}</div>${doneGroup(done)}`;
}

function renderMatrix(kind){
  const Q = kind === 'eisen' ? EQ : VQ;
  const keyFn = kind === 'eisen' ? (t => eKey(t)) : vKey;
  const ax = kind === 'eisen' ? ['Urgent','Not urgent'] : ['Low effort','High effort'];
  const ay = kind === 'eisen' ? ['Important','Not important'] : ['High value','Low value'];
  const open = scopeOpen();
  const un = open.filter(t => !keyFn(t));
  main.innerHTML = `<div class="unsorted dropzone" data-zone="none">${un.length
      ? `<span><b class="num">${un.length}</b> ${un.length === 1 ? 'task needs' : 'tasks need'} ${kind === 'eisen' ? 'a value' : 'a value and effort'}.</span><button class="lnk" data-nav="triage">Triage now</button>`
      : `<span>Everything is placed. Drop a task here to unsort it.</span>`}</div>
    <div class="matrix">
      <div class="axis-x"><span>${ax[0]}</span><span>${ax[1]}</span></div>
      <div class="axis-y"><span>${ay[0]}</span><span>${ay[1]}</span></div>
      <div class="grid">${Object.entries(Q).map(([k, q]) => {
        const items = open.filter(t => keyFn(t) === k);
        return `<section class="quad dropzone" data-zone="${k}">
          <header><h3>${q.title}</h3><small>${q.sub}</small>${items.length ? `<span class="qn">${items.length}</span>` : ''}
            <button class="ibtn" data-qadd="${k}" aria-label="Add to ${q.title}" data-tip="Add to ${q.title}">${ICON.plus}</button></header>
          <div class="rows">${openQuad === k ? `<form class="qform" data-qform="${k}"><input placeholder="New task in ${q.title}" aria-label="New task in ${q.title}"></form>` : ''}${items.map(t => row(t, {compact: true})).join('')}${!items.length && openQuad !== k ? `<div class="qhint">Drop tasks here</div>` : ''}</div>
        </section>`;
      }).join('')}</div>
    </div>`;
  if (openQuad){ const i = main.querySelector('.qform input'); if (i) i.focus(); }
}

function renderToday(){
  const t0 = todayStr();
  const focus = state.tasks.filter(t => inScope(t) && isFocus(t)).sort((a,b) => a.rank - b.rank);
  const open = focus.filter(t => !t.done), done = focus.filter(t => t.done);
  const left = state.tasks.filter(t => inScope(t) && !t.done && t.focusOn && t.focusOn < t0);
  const pickAll = scopeOpen().filter(t => t.focusOn !== t0 && !t.waiting);
  pickAll.sort((a,b) => isTriaged(a) && isTriaged(b) ? byScore(a,b) : isTriaged(a) ? -1 : isTriaged(b) ? 1 : a.rank - b.rank);
  const pick = showAllPick ? pickAll : pickAll.slice(0, 6);
  const waiting = scopeOpen().filter(t => t.waiting).sort((a,b) => (nudgeDue(b) - nudgeDue(a)) || (a.nudgeOn || '9').localeCompare(b.nudgeOn || '9') || a.rank - b.rank);
  const nudges = waiting.filter(nudgeDue).length;
  main.innerHTML = `<div class="focus">
    <div class="fmain">
      ${left.length ? `<div class="banner"><span>${plural(left.length, 'unfinished task')} from an earlier day. Keep going today?</span>
        <button class="btn" data-left="clear">Back to lists</button><button class="btn primary" data-left="carry">Add to today</button></div>` : ''}
      ${focus.length ? `<div class="fhead"><span class="count"><span class="num">${done.length}</span> of <span class="num">${focus.length}</span> done</span></div>
        <div class="progress"><i style="width:${Math.round(done.length / focus.length * 100)}%"></i></div>` : ''}
      <div class="ranklist rows dropzone" data-zone="rank">${open.map((t,i) => row(t, {rank: i + 1, top: i < 3})).join('')
        || (done.length ? '' : `<div class="focus-empty"><b>What matters today?</b>Press N to add a task, or pick 3 to 5 from Up next.</div>`)}</div>
      ${open.length > 5 ? `<p class="soft">That's ${open.length} tasks. Today works best with 3 to 5.</p>` : ''}
      ${doneGroup(done)}
    </div>
    <aside>
      <section class="panel dropzone" data-zone="unfocus">
        <header><h3>Up next</h3><span class="n">by score</span>${pickAll.length > 6 ? `<button class="lnk" data-pickall>${showAllPick ? 'Show less' : `Show all ${pickAll.length}`}</button>` : ''}</header>
        <div class="rows">${pick.map(t => row(t, {compact: true, showList: true})).join('') || `<div class="pempty">Nothing else open here.</div>`}</div>
        ${pick.length ? `<p class="soft">Click Today on a task, press T, or drag it over.</p>` : ''}
      </section>
      <section class="panel">
        <header><h3>Waiting on others</h3>${waiting.length ? `<span class="n">${waiting.length}</span>` : ''}${nudges ? `<span class="chip warn" style="margin-left:auto">${plural(nudges, 'nudge')} due</span>` : ''}</header>
        <div class="rows">${waiting.map(t => row(t, {compact: true, showList: true})).join('') || `<div class="pempty">Nothing blocked. Mark a task as waiting in its details.</div>`}</div>
      </section>
    </aside>
  </div>`;
}

/* triage (Build spec: Triage) */
function triageState(){
  const q = triageQueue();
  const rest = q.filter(t => !tri.seen.has(t.id));
  return {q, rest, cur: rest[0] || null};
}
function renderTriage(){
  const {rest, cur} = triageState();
  if (!cur){
    tri.id = null; tri.draft = null;
    main.innerHTML = `<div class="tri"><div class="tri-done"><b>${tri.seen.size ? 'Triage done.' : 'Nothing to triage.'}</b>${tri.seen.size ? `You went through ${plural(tri.seen.size, 'task')}.` : 'Every task in scope has a value and an effort.'}
      <p><button class="btn" data-view="${state.lens}">Go to Prioritize</button></p></div></div>`;
    return;
  }
  if (tri.id !== cur.id){
    tri.id = cur.id;
    tri.draft = {value: cur.value, effort: cur.effort, due: cur.due, urgentFlag: cur.urgentFlag, today: cur.focusOn === todayStr(), stale: isStale(cur)};
  }
  const d = tri.draft, pos = tri.seen.size + 1, total = tri.seen.size + rest.length;
  const preview = Object.assign({}, cur, {value: d.value, effort: d.effort, due: d.due, urgentFlag: d.urgentFlag});
  const s = score(preview), ek = eKey(preview), vk = vKey(preview);
  const L = listById(cur.listId);
  main.innerHTML = `<div class="tri"><div class="tri-card" aria-live="polite">
    <div class="tri-top"><span class="num">${pos} of ${total}</span><span class="grow"></span><span>${esc(L ? L.name : '')}</span><span>·</span><span>${ageDays(cur)}d old</span></div>
    <h2>${esc(cur.title)}</h2>
    ${cur.notes ? `<div class="notes">${esc(cur.notes)}</div>` : ''}
    ${cur.people.length || cur.waiting ? `<div class="info">${cur.waiting ? '<span class="chip">Waiting</span>' : ''}${cur.people.map(p => `<span class="chip">@${esc(p)}</span>`).join('')}</div>` : ''}
    ${d.stale ? `<div class="stale">Stale: it's been ${ageDays(cur)} days. Do it, give it a due date, or mark it won't do.</div>` : ''}
    <div class="tfld"><label>Value</label><div class="opts">${[1,2,3,4].map(v => `<button class="opt${d.value === v ? ' on' : ''}" data-tv="${v}" aria-pressed="${d.value === v}"><kbd>${v}</kbd>${VALUE[v]}</button>`).join('')}</div></div>
    <div class="tfld"><label>Effort</label><div class="opts">${EFFORTS.map((e, i) => `<button class="opt${d.effort === e ? ' on' : ''}" data-te="${e}" aria-pressed="${d.effort === e}"><kbd>${'QWERT'[i]}</kbd>${e}<span class="pts">${POINTS[e]}</span></button>`).join('')}</div></div>
    <div class="tfld"><label>Due</label><div class="opts"><input type="date" id="triDue" value="${d.due || ''}" aria-label="Due date"><kbd>D</kbd>
      ${d.due ? `<button class="lnk" data-tdue-clear>Clear</button>` : `<span class="hint">${d.value ? `No date: aging pushes it up after ${fmtDay(addDays(cur.ageFrom, WINDOW[d.value]))}` : 'Optional'}</span>`}</div></div>
    <div class="tfld"><label>Flags</label><div class="opts">
      <button class="opt${d.urgentFlag ? ' on' : ''}" data-tt="urgentFlag" aria-pressed="${d.urgentFlag}"><kbd>U</kbd>Urgent</button>
      <button class="opt${d.today ? ' on' : ''}" data-tt="today" aria-pressed="${d.today}"><kbd>Space</kbd>Today</button></div></div>
    <div class="tri-foot">
      <span class="tri-score">${s != null ? `Score <span class="num">${fmtScore(s)}</span> · ` : ''}${ek ? EQ[ek].title : 'Unsorted'}${vk ? ` · ${VQ[vk].title}` : ''}</span>
      <span class="grow"></span>
      <button class="btn text-danger" data-tact="wont"><kbd>0</kbd>Won't do</button>
      <button class="btn" data-tact="skip"><kbd>S</kbd>Skip</button>
      <button class="btn primary" data-tact="save"><kbd>Enter</kbd>Save and next</button>
    </div>
  </div><p class="soft" style="text-align:center"><kbd>Esc</kbd> to leave Triage</p></div>`;
}
function triageSave(){
  const t = findTask(tri.id), d = tri.draft; if (!t || !d) return;
  t.value = d.value; t.effort = d.effort; t.due = d.due || null; t.urgentFlag = !!d.urgentFlag;
  if (d.today) t.focusOn = todayStr(); else if (t.focusOn === todayStr()) t.focusOn = null;
  // kept after triage: restart the aging clock, so a task you just placed doesn't come straight back as stale
  if (d.stale || isStale(t)) t.ageFrom = todayStr();
  tri.seen.add(t.id); tri.id = null;
  commit();
}
function triageSkip(){ if (!tri.id) return; tri.seen.add(tri.id); tri.id = null; render(); }
function triageWont(){ if (!tri.id) return; const id = tri.id; tri.seen.add(id); tri.id = null; wontDo(id); }
function exitTriage(){ setView(prevView && prevView !== 'triage' ? prevView : 'today'); }
function triageKey(e){
  if (!tri.draft) return false;
  const d = tri.draft, k = e.key;
  if (/^[1-4]$/.test(k)){ d.value = +k; }
  else if ('qwert'.includes(k.toLowerCase()) && k.length === 1){ d.effort = EFFORTS['qwert'.indexOf(k.toLowerCase())]; }
  else if (k === 'd' || k === 'D'){ e.preventDefault(); const i = $('#triDue'); if (i){ i.focus(); try { i.showPicker && i.showPicker(); } catch(_) {} } return true; }
  else if (k === 'u' || k === 'U'){ d.urgentFlag = !d.urgentFlag; }
  else if (k === ' '){ d.today = !d.today; }
  else if (k === '0'){ e.preventDefault(); triageWont(); return true; }
  else if (k === 'Enter'){ e.preventDefault(); triageSave(); return true; }
  else if (k === 's' || k === 'S'){ triageSkip(); return true; }
  else return false;
  e.preventDefault();
  renderTriage();
  return true;
}

function renderPeople(){
  const ppl = state.people;
  const tasksFor = n => state.tasks.filter(t => inScope(t) && t.people.includes(n) && (!t.done || isDoneToday(t))).sort((a,b) => a.rank - b.rank);
  if (!ppl.length){
    main.innerHTML = `<div class="empty"><b>No people yet.</b>Type @name in any task, like "Review promo doc @Brandon", or click Person.</div>`;
    return;
  }
  main.innerHTML = `<div class="people">${ppl.map(p => {
    const ts = tasksFor(p);
    const wait = ts.filter(t => t.waiting && !t.done), rest = ts.filter(t => !(t.waiting && !t.done));
    const open = ts.filter(t => !t.done).length, nud = wait.filter(nudgeDue).length;
    const rows = list => `<div class="rows">${list.map(t => row(t, {compact: true, skipPerson: p, noScore: true})).join('')}</div>`;
    return `<section class="pcard dropzone" data-zone="person" data-person="${esc(p)}">
      <header><span class="avatar">${esc(initials(p))}</span><span class="pname" data-tip="Double-click to rename">${esc(p)}</span>${open ? `<span class="n">${open} open</span>` : ''}${nud ? `<span class="chip warn">${plural(nud, 'nudge')}</span>` : ''}
        <span class="ibtn" data-pmenu="${esc(p)}" role="button" tabindex="0" aria-label="Options for ${esc(p)}">${ICON.dots}</span></header>
      ${wait.length ? `<div class="sub">Waiting on them</div>${rows(wait)}` : ''}
      ${rest.length ? `<div class="sub">${wait.length ? 'To discuss or do' : 'Open'}</div>${rows(rest)}` : ''}
      ${ts.length ? '' : `<div class="pempty">Nothing open here. Drag a task over or add one below.</div>`}
      <form class="pform" data-person="${esc(p)}" autocomplete="off"><input placeholder="Add for ${esc(p)}" aria-label="Add a task for ${esc(p)}"></form>
    </section>`;
  }).join('')}</div>`;
}

/* archive + weekly recap */
function weekRange(off){
  const s = new Date(); s.setHours(0,0,0,0);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7) + off * 7); // Monday
  const e = new Date(s); e.setDate(e.getDate() + 6);
  return [s, e];
}
function recapData(){
  const [s, e] = weekRange(weekOff), a = dateStr(s), b = dateStr(e), ids = scopeListIds();
  const done = state.tasks.filter(t => t.done && !t.wontDo && t.doneAt && t.doneAt >= a && t.doneAt <= b && ids.includes(t.listId));
  const byList = new Map();
  orderedLists().forEach(L => {
    const ts = done.filter(t => t.listId === L.id).sort((x,y) => (x.doneAt || '').localeCompare(y.doneAt || '') || x.rank - y.rank);
    if (ts.length) byList.set(L, ts);
  });
  // quadrant as of the day it was finished
  const quads = [...Object.keys(EQ), 'none'].map(k => [k, done.filter(t => (eKey(t, t.doneAt || undefined) || 'none') === k).length]);
  const waiting = state.tasks.filter(t => t.waiting && !t.done && ids.includes(t.listId)).sort((x,y) => x.rank - y.rank);
  return {s, e, done, byList, quads, waiting};
}
function recapInsight(r){
  const n = r.done.length; if (n < 3) return '';
  const q = Object.fromEntries(r.quads);
  if (q.do / n >= 0.5) return 'Mostly Do first this week. That usually means firefighting; aim to move more work into Schedule.';
  if (q.schedule && q.schedule >= q.do) return 'More Schedule than Do first. Planned work is winning.';
  return 'Aim for a growing share of work from Schedule.';
}
function recapText(r){
  const withP = t => t.people.length ? ` (${t.people.join(', ')})` : '';
  const out = [`Week of ${fmtMD(r.s)} to ${fmtMD(r.e)}: ${plural(r.done.length,'task')} done`];
  const split = r.quads.filter(x => x[1]).map(([k, c]) => `${k === 'none' ? 'Unsorted' : EQ[k].title} ${c}`).join(', ');
  if (split) out.push(`Split: ${split}`);
  r.byList.forEach((ts, L) => { out.push('', L.name); ts.forEach(t => out.push(`- ${t.title}${withP(t)}`)); });
  if (r.waiting.length){ out.push('', 'Waiting on'); r.waiting.forEach(t => out.push(`- ${t.title}${withP(t)}`)); }
  return out.join('\n');
}
function copyText(text){
  const ok = () => toast('Recap copied. Paste it anywhere.');
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(ok, () => fallback());
  fallback();
  function fallback(){
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); ok(); } catch(e){ toast("Couldn't copy. Select the text and copy it manually."); }
    ta.remove();
  }
}
function dayLabel(d){
  if (!d) return 'Earlier';
  if (d === todayStr()) return 'Today';
  if (d === addDays(todayStr(), -1)) return 'Yesterday';
  const o = {weekday: 'short', month: 'short', day: 'numeric'};
  if (parseD(d).getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return parseD(d).toLocaleDateString(undefined, o);
}
function renderArchive(){
  const ids = scopeListIds();
  const all = state.tasks.filter(t => t.done && ids.includes(t.listId)).sort((a,b) => (b.doneAt || '').localeCompare(a.doneAt || '') || a.rank - b.rank);
  const done = all.filter(t => !t.wontDo), wont = all.filter(t => t.wontDo);
  const r = recapData(), n = r.done.length;
  const when = weekOff === 0 ? 'This week' : weekOff === -1 ? 'Last week' : '';
  const split = n ? `<div class="split"><div class="splitbar" role="img" aria-label="Quadrant split">${r.quads.filter(x => x[1]).map(([k, c]) => `<i class="q-${k}" style="flex:${c}"></i>`).join('')}</div>
      <div class="legend">${r.quads.filter(x => x[1]).map(([k, c]) => `<span><i class="q-${k}"></i>${k === 'none' ? 'Unsorted' : EQ[k].title} <span class="num">${c}</span> (${Math.round(c / n * 100)}%)</span>`).join('')}</div>
      ${recapInsight(r) ? `<p class="insight">${recapInsight(r)}</p>` : ''}</div>` : '';
  const recap = `<section class="recap">
    <header><h3>Weekly recap</h3><span class="count">${when ? `${when} · ` : ''}${fmtMD(r.s)} to ${fmtMD(r.e)}</span>
      <div class="wknav"><button class="ibtn" data-week="-1" aria-label="Previous week" data-tip="Previous week">${ICON.chevL}</button><button class="ibtn" data-week="1" aria-label="Next week"${weekOff >= 0 ? ' disabled' : ' data-tip="Next week"'}>${ICON.chevR}</button></div></header>
    <div class="big">${n}<small>${n === 1 ? 'task' : 'tasks'} done</small></div>
    ${split}
    ${n ? `<div class="recap-lists">${[...r.byList].map(([L, ts]) => `<div><h4>${esc(L.name)}</h4><ul>${ts.map(t => `<li>${esc(t.title)}</li>`).join('')}</ul></div>`).join('')}</div>`
      : `<p class="soft">Nothing finished ${weekOff === 0 ? 'yet this week' : 'that week'}.</p>`}
    <footer><button class="btn primary" data-copy-recap${n || r.waiting.length ? '' : ' disabled'}>Copy recap</button>
      ${r.waiting.length ? `<span class="soft">Also lists ${plural(r.waiting.length,'task')} you're waiting on</span>` : ''}</footer>
  </section>`;
  if (!all.length){
    main.innerHTML = `<div class="archive">${recap}<div class="empty"><b>Nothing done yet.</b>Finished tasks stay in "Done today", then move here.</div></div>`;
    return;
  }
  const groups = new Map();
  done.forEach(t => { const k = t.doneAt || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
  main.innerHTML = `<div class="archive">${recap}
    <div class="arch-head"><h3>Completed</h3><span class="count num">${done.length}</span><button class="btn" data-clear-archive>Clear</button></div>
    ${[...groups].map(([d, ts]) => `<div class="day"><h4>${dayLabel(d)}</h4><div class="rows">${ts.map(t => row(t, {compact: true, showList: true})).join('')}</div></div>`).join('')}
    ${wont.length ? `<div class="arch-head" style="margin-top:1.6rem"><h3>Won't do</h3><span class="count num">${wont.length}</span></div>
      <p class="soft" style="margin:0 0 .5rem">Decided against. Not counted as done.</p>
      <div class="rows">${wont.map(t => row(t, {compact: true, showList: true})).join('')}</div>` : ''}
  </div>`;
}

export { copyText, dayLabel, exitTriage, recapData, recapText, renderArchive, renderMatrix, renderPeople, renderRank, renderToday, renderTriage, triageKey, triageSave, triageSkip, triageWont };
