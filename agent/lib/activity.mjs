// The activity log (docs/security.md, Activity): every change made outside this computer through a connector,
// every call an agent made, and every approval decision, newest last, one JSON line each:
//
//   <dataDir>/connections/activity/<YYYY-MM>.jsonl
//
// A line holds who (you, an agent, a rule, a routine), which connector and action, whether it changed something
// outside, how it went, how long it took, and the approval it came from. Never arguments or results: they can
// hold anything. Plain files a person can read without Workshop; never removed by Workshop.
import fs from 'node:fs';
import path from 'node:path';

const MONTH = /^\d{4}-\d{2}\.jsonl$/;

export class Activity {
  #dir; #now;
  constructor({ dataDir, now }) {
    this.#dir = dataDir ? path.join(dataDir, 'connections', 'activity') : null;
    this.#now = now || (() => new Date());
  }

  /** Adds one line. Never throws: the log must not stop the work it records. */
  record(e) {
    if (!this.#dir) return;
    const at = this.#now();
    const line = {
      at: at.toISOString(), by: ['you', 'agent', 'rule', 'routine'].includes(e.by) ? e.by : 'you',
      connector: String(e.connector || ''), action: String(e.action || ''), kind: e.kind || (e.write ? 'write' : 'read'),
      ok: e.ok !== false, ...(e.error ? { error: String(e.error).slice(0, 300) } : {}),
      ...(Number.isFinite(e.ms) ? { ms: Math.round(e.ms) } : {}), ...(e.approval ? { approval: e.approval } : {}),
      ...(e.rule ? { rule: e.rule } : {}), ...(e.summary ? { summary: String(e.summary).slice(0, 300) } : {})
    };
    try {
      fs.mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
      fs.appendFileSync(path.join(this.#dir, `${line.at.slice(0, 7)}.jsonl`), JSON.stringify(line) + '\n', { mode: 0o600 });
    } catch { /* best effort */ }
  }

  /** The newest lines, newest first, from the newest months back; filters by connector and who. */
  recent({ limit = 200, connector, by } = {}) {
    if (!this.#dir) return [];
    let months = [];
    try { months = fs.readdirSync(this.#dir).filter(n => MONTH.test(n)).sort().reverse(); } catch { return []; }
    const out = [];
    for (const m of months.slice(0, 12)) {
      let lines = [];
      try { lines = fs.readFileSync(path.join(this.#dir, m), 'utf8').split('\n').filter(Boolean); } catch { continue; }
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
        let e; try { e = JSON.parse(lines[i]); } catch { continue; }
        if (!e || typeof e !== 'object') continue;
        if (connector && e.connector !== connector) continue;
        if (by && e.by !== by) continue;
        out.push(e);
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  /** When each connector was last used: {connector: iso}. From this month and last. */
  lastUsed() {
    const out = {};
    for (const e of this.recent({ limit: 5000 })) if (e.connector && !out[e.connector]) out[e.connector] = e.at;
    return out;
  }
}
