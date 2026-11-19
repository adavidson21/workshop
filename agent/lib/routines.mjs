// Routines (docs/config.md, Routines): Tandem commands or prompts Workshop starts on a schedule, on this computer,
// through the opencode connector (a new chat each time, so each run shows in Chat).
//
//   config.json  routines                 what runs and when (days and a local time)
//   <dataDir>/routines/runs.json          the newest 200 runs: when, how, and the chat each one started
//
// A run that was due while the computer slept or Workshop was stopped runs once when Workshop is back, if it is
// at most CATCH_UP_HOURS late; older ones are skipped. A routine runs at most once per scheduled time.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const CATCH_UP_HOURS = 6;
const TICK_MS = 30 * 1000;
const KEEP = 200;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ID = /^rt-[0-9a-f]{8}$/;

/** Whether a routine runs on this local day (0 = Sunday). */
export function runsOn(days, weekday) {
  if (days === 'daily') return true;
  if (days === 'weekdays') return weekday >= 1 && weekday <= 5;
  return DAYS[weekday] === days;
}

/** The scheduled times (local) around `now`: the newest at or before it, and the next after it. */
export function slots(schedule, now) {
  const [h, m] = String(schedule.time || '00:00').split(':').map(Number);
  let last = null, next = null;
  for (let d = -7; d <= 8; d += 1) {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, h, m, 0, 0);
    if (!runsOn(schedule.days, t.getDay())) continue;
    if (t <= now) last = t; else if (!next) next = t;
  }
  return { last, next };
}

/** A slash command ("/cloudflare why workshop") as {name, args}, or null for a prompt. */
export function asCommand(text) {
  const m = /^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i.exec(String(text || '').trim());
  return m ? { name: m[1].toLowerCase(), args: (m[2] || '').trim() } : null;
}

export class Routines {
  #config; #connectors; #file; #log; #events; #now; #timer = null; #running = new Set();

  constructor({ config, connectors, dataDir, log, events, now }) {
    this.#config = config;
    this.#connectors = connectors;
    this.#file = dataDir ? path.join(dataDir, 'routines', 'runs.json') : null;
    this.#log = log;
    this.#events = events;
    this.#now = now || (() => new Date());
  }

  list() { return Array.isArray(this.#config().routines) ? this.#config().routines : []; }

  /** Checks a new list from Settings and fills in ids and dates. Throws bad_request in plain words. */
  check(list) {
    const bad = msg => { throw Object.assign(new Error(msg), { code: 'bad_request', status: 400 }); };
    if (!Array.isArray(list)) bad('Send {"routines": [...]}.');
    if (list.length > 50) bad('At most 50 routines.');
    const seen = new Set();
    return list.map((r, i) => {
      if (!r || typeof r !== 'object') bad(`Routine ${i + 1} is not an object.`);
      const name = String(r.name || '').trim();
      const run = String(r.run || '').trim();
      if (!name || name.length > 80) bad(`Routine ${i + 1} needs a name (at most 80 characters).`);
      if (run.length < 2 || run.length > 4000) bad(`"${name}" needs something to run: a slash command like /cloudflare why workshop, or a prompt.`);
      const s = r.schedule || {};
      if (!['daily', 'weekdays', ...DAYS].includes(s.days)) bad(`"${name}": days is daily, weekdays, or one of ${DAYS.join(', ')}.`);
      if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(String(s.time))) bad(`"${name}": time is HH:MM, 24-hour, like 07:30.`);
      const id = ID.test(String(r.id || '')) && !seen.has(r.id) ? r.id : `rt-${crypto.randomBytes(4).toString('hex')}`;
      seen.add(id);
      const old = this.list().find(x => x.id === id);
      return {
        id, name, run, ...(r.agent ? { agent: String(r.agent).slice(0, 64) } : {}),
        schedule: { days: s.days, time: s.time }, enabled: r.enabled !== false,
        created: old && old.created ? old.created : this.#now().toISOString()
      };
    });
  }

  #runs() {
    if (!this.#file) return [];
    try { const j = JSON.parse(fs.readFileSync(this.#file, 'utf8')); return Array.isArray(j.runs) ? j.runs : []; } catch { return []; }
  }

  #save(runs) {
    if (!this.#file) return;
    fs.mkdirSync(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    const tmp = `${this.#file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ note: 'Routine runs, newest first. Written by Workshop.', runs: runs.slice(0, KEEP) }, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.#file);
  }

  /** Routines with their last and next run, and the newest runs. */
  view() {
    const now = this.#now();
    const runs = this.#runs();
    return {
      routines: this.list().map(r => {
        const last = runs.find(x => x.routine === r.id) || null;
        const { next } = slots(r.schedule, now);
        return { ...r, lastRun: last, next: r.enabled === false ? null : next ? next.toISOString() : null };
      }),
      runs: runs.slice(0, 50),
      catchUpHours: CATCH_UP_HOURS
    };
  }

  /** Routines due now: enabled, a scheduled time passed at most CATCH_UP_HOURS ago, not yet run for it. */
  due(now = this.#now()) {
    const runs = this.#runs();
    return this.list().filter(r => {
      if (r.enabled === false) return false;
      const { last } = slots(r.schedule, now);
      if (!last || now - last > CATCH_UP_HOURS * 3600e3) return false;
      if (r.created && Date.parse(r.created) > last.getTime()) return false;
      const prev = runs.find(x => x.routine === r.id && x.how === 'schedule');
      return !prev || Date.parse(prev.slot || prev.at) < last.getTime();
    }).map(r => ({ routine: r, slot: slots(r.schedule, now).last }));
  }

  /** Starts one run through the opencode connector. Records it either way; never throws. */
  async run(r, { how = 'schedule', slot = null } = {}) {
    if (this.#running.has(r.id)) return { ok: false, error: 'It is already starting.' };
    this.#running.add(r.id);
    const cmd = asCommand(r.run);
    const at = this.#now().toISOString();
    let out;
    try {
      const result = cmd
        ? await this.#connectors.call('opencode', 'chat.command', { args: { name: cmd.name, args: cmd.args, ...(r.agent ? { agent: r.agent } : {}) }, confirm: true }, { caller: 'routine' })
        : await this.#connectors.call('opencode', 'chat.start', { args: { text: r.run, ...(r.agent ? { agent: r.agent } : {}) }, confirm: true }, { caller: 'routine' });
      const session = result && (result.session || result.id || (result.chat && result.chat.session)) || null;
      out = { routine: r.id, name: r.name, at, how, ...(slot ? { slot: slot.toISOString() } : {}), ok: true, ...(session ? { session: String(session) } : {}) };
      this.#log?.info(`Routine "${r.name}" started (${how}).`);
    } catch (e) {
      out = { routine: r.id, name: r.name, at, how, ...(slot ? { slot: slot.toISOString() } : {}), ok: false, error: String(e && e.message || 'It did not start.').slice(0, 300) };
      this.#log?.warn(`Routine "${r.name}" did not start: ${out.error}`);
    } finally { this.#running.delete(r.id); }
    try { this.#save([out, ...this.#runs()]); } catch { /* the run still happened */ }
    this.#events?.send('config', { changed: ['routines'] });
    return out;
  }

  async runNow(id) {
    const r = this.list().find(x => x.id === id);
    if (!r) throw Object.assign(new Error(`There is no routine ${id}.`), { code: 'not_found', status: 404 });
    return this.run(r, { how: 'now' });
  }

  async tick() {
    for (const { routine, slot } of this.due()) await this.run(routine, { how: 'schedule', slot });
  }

  start() {
    if (this.#timer) return;
    this.#timer = setInterval(() => { this.tick().catch(() => {}); }, TICK_MS);
    this.#timer.unref?.();
    setTimeout(() => { this.tick().catch(() => {}); }, 5000).unref?.();
  }

  stop() { if (this.#timer) clearInterval(this.#timer); this.#timer = null; }
}
