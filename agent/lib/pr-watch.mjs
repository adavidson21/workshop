// After Publish (Workshop project doc claude/after-publish-v1-plan.md): follows each published pull request until it
// merges. Every 5 minutes it asks the opencode connector what to watch (`published.watch`), asks the ADO or GitHub
// connector where each PR stands (`pr.status`, read only), and hands the answer back (`published.record`), which
// decides what follows: Tandem's /pr-fix when CI fails or the PR conflicts, the cleanup when it merges. Nothing here
// pushes or writes to ADO or GitHub.
//
// The calls go in Activity as a routine's. Reads are not logged (`quiet`), and a PR whose state did not change is
// recorded again only every 30 minutes, so Activity is not a wall of checks.

export const WATCH_MS = 5 * 60 * 1000;
export const SAME_MS = 30 * 60 * 1000;

/** What decides whether a status is worth recording again: everything but the time. */
export function fingerprint(s) {
  if (!s || !s.found) return 'none';
  return JSON.stringify([s.status, s.head, s.ci && s.ci.state, s.ci && s.ci.baseFailing, (s.ci && s.ci.checks || []).map(c => [c.name, c.state]), s.review, s.conflict, (s.threads || []).length, (s.threads || []).filter(t => !t.resolved).length]);
}

export class PrWatch {
  #connectors; #log; #now; #timer = null; #busy = false;
  #seen = new Map(); // "<folder>|<repo>" -> { print, at }

  constructor({ connectors, log, now = () => Date.now() }) {
    this.#connectors = connectors;
    this.#log = log;
    this.#now = now;
  }

  /** One pass over every published PR. Never throws. Returns how many repos were recorded. */
  async tick() {
    if (this.#busy) return 0;
    this.#busy = true;
    let recorded = 0;
    try {
      let list;
      try {
        list = await this.#connectors.call('opencode', 'published.watch', { args: {} }, { caller: 'routine', quiet: true });
      } catch { return 0; } // opencode is off or not ready: nothing to watch
      for (const item of (list && list.items) || []) {
        for (const r of item.repos || []) {
          const key = `${item.folder}|${r.repo}`;
          let status = null, error = null;
          try {
            status = await this.#connectors.call(r.host === 'ado' ? 'ado' : 'github', 'pr.status', { args: { remote: r.remote, branch: r.branch, target: r.target, logs: true } }, { caller: 'routine', quiet: true });
          } catch (e) {
            error = e && e.code === 'disabled' ? `Turn on the ${r.host === 'ado' ? 'Azure DevOps' : 'GitHub'} connector in Settings to follow this PR.` : String(e && e.message || 'It could not be read.');
          }
          const print = error ? `error:${error}` : fingerprint(status);
          const was = this.#seen.get(key);
          if (was && was.print === print && this.#now() - was.at < SAME_MS) continue;
          try {
            await this.#connectors.call('opencode', 'published.record', { args: { folder: item.folder, repo: r.repo, ...(error ? { error: error.slice(0, 1000) } : { status }) }, confirm: true }, { caller: 'routine' });
            this.#seen.set(key, { print, at: this.#now() });
            recorded++;
          } catch (e) {
            this.#log?.warn(`After Publish: could not record ${key}: ${e && e.message}`);
          }
        }
      }
    } finally {
      this.#busy = false;
    }
    return recorded;
  }

  start() {
    if (this.#timer) return;
    this.#timer = setInterval(() => { this.tick().catch(() => {}); }, WATCH_MS);
    this.#timer.unref?.();
    setTimeout(() => { this.tick().catch(() => {}); }, 30000).unref?.();
  }

  stop() { if (this.#timer) clearInterval(this.#timer); this.#timer = null; }
}
