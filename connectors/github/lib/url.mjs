// "config.fromUrl": fill in the settings from any link copied out of GitHub (repo, issue, PR, project or
// milestone page; github.com or GitHub Enterprise Server). Saves nothing.
import { REPO_RE } from './config.mjs';

export function configFromUrl(url, current = {}) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { throw new Error('That is not a link. Copy the address of any repo, issue or pull request page.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('That is not a web link.');
  const parts = u.pathname.split('/').filter(Boolean);
  const host = u.host.toLowerCase();
  const dotcom = host === 'github.com' || host === 'www.github.com';
  const apiUrl = dotcom ? 'https://api.github.com' : `${u.protocol}//${u.host}/api/v3`;
  const repo = parts.length >= 2 && !['orgs', 'users', 'settings'].includes(parts[0]) ? `${parts[0]}/${parts[1].replace(/\.git$/, '')}` : '';
  const config = JSON.parse(JSON.stringify(current || {}));
  const notes = [];
  config.connections = Array.isArray(config.connections) ? config.connections : [];
  let conn = config.connections.find(c => String(c.apiUrl || 'https://api.github.com').replace(/\/+$/, '') === apiUrl);
  if (!conn) {
    const taken = new Set(config.connections.map(c => c.name));
    let name = dotcom ? 'github' : host.split('.')[0].replace(/[^A-Za-z0-9_-]/g, '') || 'github';
    for (let i = 2; taken.has(name); i++) name = `${name.replace(/-\d+$/, '')}-${i}`;
    conn = { name, apiUrl, tokenEnv: 'GITHUB_PAT' };
    config.connections.push(conn);
    notes.push(`Added the connection "${name}" for ${dotcom ? 'github.com' : host}. Add its token in Settings, Tokens & sign-ins.`);
  } else notes.push(`The connection "${conn.name}" already points at ${dotcom ? 'github.com' : host}.`);
  if (!config.defaultConnection) config.defaultConnection = conn.name;
  if (repo && REPO_RE.test(repo)) {
    config.repos = Array.isArray(config.repos) ? config.repos : [];
    if (config.repos.length && !config.repos.some(r => r.toLowerCase() === repo.toLowerCase())) {
      config.repos.push(repo);
      notes.push(`Added ${repo} to Repos.`);
    } else if (!config.repos.length) notes.push(`Repos is empty, so every repo you can see counts, ${repo} included.`);
  }
  return { config, notes };
}
