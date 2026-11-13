/* Docket: meetings into a day's plan, with no calendar connection. Two ways in, both read in the browser only:
   quick lines you type or paste ("10:00 1:1 Brandon 30m", "2pm-3pm Planning") and an .ics file exported from a
   calendar. Each meeting becomes a "meetings" block placed in time order. Pure functions; the Day view calls them. */
import { addSection, editDay, parseTime, toMin } from './dayplan-model.js';

const pad = n => String(n).padStart(2, '0');
const fromMin = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const TIME = String.raw`\d{1,2}(?::?\d{2})?\s*(?:a|am|p|pm)?`;
const LINE = new RegExp(String.raw`^(${TIME})(?:\s*(?:-|to)\s*(${TIME}))?\s+(.+)$`, 'i');
const DUR = /\s+(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours)$/i;

/* "10:00 1:1 Brandon 30m" -> {name, around, minutes}. An end time wins over a length; no length means 30 minutes. */
function parseQuickLine(line){
  let s = String(line || '').trim().replace(/^[-*•]\s*/, '');
  if (!s) return null;
  let minutes = null;
  const d = s.match(DUR);
  if (d){ minutes = Math.round(+d[1] * (/^h/i.test(d[2]) ? 60 : 1)); s = s.slice(0, d.index).trim(); }
  const m = s.match(LINE);
  if (!m) return null;
  let start = parseTime(m[1]);
  if (!start) return null;
  if (m[2]){
    let end = parseTime(m[2]);
    // "2-3pm": the start borrows the end's am or pm.
    if (end && !/[ap]/i.test(m[1]) && /p/i.test(m[2]) && toMin(start) < 12 * 60 && toMin(end) >= 12 * 60) start = parseTime(m[1] + 'pm') || start;
    if (end){ let len = toMin(end) - toMin(start); if (len <= 0) len += 1440; minutes = len; }
  }
  const name = m[3].trim().slice(0, 80);
  if (!name) return null;
  return {name, around: start, minutes: minutes && minutes > 0 ? Math.min(minutes, 1440) : 30};
}
function parseQuick(text){
  return String(text || '').split(/\r?\n/).map(parseQuickLine).filter(Boolean);
}

/* ---------- .ics ---------- */
const unfold = t => String(t || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
const unescape = v => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
/* "20261112T143000Z" or "20261112T143000" (local) or "20261112" (all day) -> a local Date, or null. */
function icsDate(v, params){
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  if (!m[4] || /VALUE=DATE(?!-)/i.test(params)) return {allDay: true};
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] || '0'].map(Number);
  return {date: m[7] ? new Date(Date.UTC(y, mo - 1, d, h, mi, s)) : new Date(y, mo - 1, d, h, mi, s)};
}
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAYS = {SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6};
/* Weekly or daily repeats are common for standing meetings; other rules are skipped rather than guessed. */
function repeatsOn(rule, start, date){
  if (!rule) return dstr(start) === date;
  const r = Object.fromEntries(rule.split(';').map(p => p.split('=')));
  const [y, mo, d] = date.split('-').map(Number), day = new Date(y, mo - 1, d, 12);
  const s0 = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12);
  if (day < s0) return false;
  if (r.UNTIL){ const u = icsDate(r.UNTIL, ''); if (u && u.date && dstr(u.date) < date) return false; }
  const days = Math.round((day - s0) / 864e5), iv = Math.max(1, +r.INTERVAL || 1);
  if (r.FREQ === 'DAILY') return days % iv === 0;
  if (r.FREQ === 'WEEKLY'){
    const by = r.BYDAY ? r.BYDAY.split(',').map(x => DAYS[x.slice(-2)]) : [start.getDay()];
    if (!by.includes(day.getDay())) return false;
    const wk = Math.floor((days + s0.getDay()) / 7);
    return wk % iv === 0;
  }
  return false;
}
/* Meetings in an .ics file that fall on `date` (yyyy-mm-dd), in the browser's time zone. All-day and cancelled
   events are left out. */
function parseIcs(text, date){
  const out = [];
  const events = unfold(text).split('BEGIN:VEVENT').slice(1).map(b => b.split('END:VEVENT')[0]);
  for (const b of events){
    const f = {};
    for (const line of b.split('\n')){
      const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
      if (m && !(m[1] in f)) f[m[1]] = {params: m[2], value: m[3]};
    }
    if (!f.DTSTART || (f.STATUS && /CANCELLED/i.test(f.STATUS.value))) continue;
    const st = icsDate(f.DTSTART.value, f.DTSTART.params);
    if (!st || st.allDay) continue;
    if (!repeatsOn(f.RRULE && f.RRULE.value, st.date, date)) continue;
    if (f.EXDATE && f.EXDATE.value.split(',').some(x => { const e = icsDate(x, f.EXDATE.params); return e && e.date && dstr(e.date) === date; })) continue;
    let minutes = 30;
    const en = f.DTEND && icsDate(f.DTEND.value, f.DTEND.params);
    if (en && en.date) minutes = Math.round((en.date - st.date) / 6e4);
    else if (f.DURATION){ const d = f.DURATION.value.match(/PT(?:(\d+)H)?(?:(\d+)M)?/); if (d) minutes = (+d[1] || 0) * 60 + (+d[2] || 0); }
    const around = fromMin(st.date.getHours() * 60 + st.date.getMinutes());
    const name = unescape(f.SUMMARY ? f.SUMMARY.value : 'Meeting').slice(0, 80) || 'Meeting';
    out.push({name, around, minutes: Math.max(5, Math.min(minutes || 30, 1440))});
  }
  return out.sort((a, b) => toMin(a.around) - toMin(b.around));
}

/* Add meetings to a day as "meetings" blocks, each placed before the first timed block that starts later.
   A meeting already there (same name and time) is skipped, so importing the same file twice adds nothing. */
function addMeetings(dp, date, list){
  const rec = editDay(dp, date);
  let added = 0;
  for (const m of list){
    if (rec.sections.some(s => s.name === m.name && s.around === m.around)) continue;
    const s = addSection(dp, date, {name: m.name, kind: 'meetings', color: 'lavender', around: m.around, minutes: m.minutes});
    rec.sections.pop();
    const at = rec.sections.findIndex(x => x.around && toMin(x.around) > toMin(m.around));
    rec.sections.splice(at < 0 ? rec.sections.length : at, 0, s);
    added++;
  }
  return added;
}

export { addMeetings, parseIcs, parseQuick, parseQuickLine };
