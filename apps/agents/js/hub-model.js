/* Dispatch: the hub's pure parts (docs/hub.md). No DOM, so Node tests import them (test/hub.test.mjs).

   checkRoute validates route.json from Tandem's /hub against docs/schemas/hub-route.schema.json by hand (the
   browser has no schema validator) and returns a clean copy, or null. Anything unknown is dropped, never shown or
   acted on. toProposal turns a route proposal into the capture shape shared/capture.js uses, so the review list
   and toHandoff work the same as Home's quick capture. answerHtml renders answer.md as escaped text with code,
   bold, lists and http(s) links only. */
import { readCards, targetsFor } from '../../../shared/summary.js';

export const TARGETS = ['prioritizer', 'receipts', 'notes'];
export const PAYLOAD_KINDS = ['task', 'win', 'feedback', 'growth', 'concern', 'note'];
export const INTENTS = ['capture', 'ask', 'go', 'act', 'clarify'];
// What an `act` may suggest: opencode actions that start Tandem work, each behind its own confirm.
export const ACTS = { opencode: ['spike', 'start.local'] };
const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const ACTION = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max;
const only = (o, keys) => Object.keys(o).every(k => keys.includes(k));

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function cleanProposal(p) {
  if (!isObj(p) || !only(p, ['to', 'text', 'payload', 'confidence', 'reason'])) return null;
  if (!TARGETS.includes(p.to) || !str(p.text, 1, 2000) || !isObj(p.payload) || !PAYLOAD_KINDS.includes(p.payload.kind)) return null;
  const okKind = p.to === 'prioritizer' ? p.payload.kind === 'task' : p.to === 'notes' ? p.payload.kind === 'note' : p.payload.kind !== 'task';
  if (!okKind) return null;
  if (p.confidence !== undefined && !(typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 1)) return null;
  if (p.reason !== undefined && !str(p.reason, 0, 300)) return null;
  return { to: p.to, text: p.text, payload: { ...p.payload }, confidence: p.confidence, reason: p.reason || '' };
}

/* route.json to a clean copy, or null when it does not match the schema. */
export function checkRoute(r) {
  if (!isObj(r) || r.version !== 1 || !INTENTS.includes(r.intent)) return null;
  if (!only(r, ['version', 'intent', 'proposals', 'ask', 'go', 'act', 'clarify'])) return null;
  const out = { version: 1, intent: r.intent };
  if (r.intent === 'capture') {
    if (!Array.isArray(r.proposals) || r.proposals.length < 1 || r.proposals.length > 20) return null;
    const ps = r.proposals.map(cleanProposal);
    if (ps.some(p => !p)) return null;
    out.proposals = ps;
  } else if (r.intent === 'ask') {
    if (!isObj(r.ask) || !only(r.ask, ['repos']) || !Array.isArray(r.ask.repos) || r.ask.repos.length > 10 || !r.ask.repos.every(x => str(x, 1, 100))) return null;
    out.ask = { repos: r.ask.repos.slice() };
  } else if (r.intent === 'go') {
    if (!isObj(r.go) || !only(r.go, ['app', 'path']) || !NAME.test(r.go.app || '') || (r.go.path !== undefined && !str(r.go.path, 0, 200))) return null;
    out.go = { app: r.go.app, ...(r.go.path ? { path: r.go.path } : {}) };
  } else if (r.intent === 'act') {
    const a = r.act;
    if (!isObj(a) || !only(a, ['connector', 'action', 'args', 'label']) || !NAME.test(a.connector || '') || !ACTION.test(a.action || '') || !str(a.label, 1, 120) || (a.args !== undefined && !isObj(a.args))) return null;
    out.act = { connector: a.connector, action: a.action, args: { ...(a.args || {}) }, label: a.label };
  } else if (r.intent === 'clarify') {
    const c = r.clarify;
    if (!isObj(c) || !only(c, ['question', 'choices']) || !str(c.question, 1, 300) || !Array.isArray(c.choices) || c.choices.length < 2 || c.choices.length > 4 || !c.choices.every(x => str(x, 1, 80))) return null;
    out.clarify = { question: c.question, choices: c.choices.slice() };
  }
  return out;
}

/* Whether Dispatch offers this act as a button at all (ACTS). Other suggestions show as text only. */
export const actAllowed = a => !!(a && ACTS[a.connector] && ACTS[a.connector].includes(a.action));

/* A route proposal in the shape of shared/capture.js (kind, to, text, title, payload). */
export function toProposal(p) {
  const q = p.payload || {};
  const kind = p.to === 'prioritizer' ? (q.waiting ? 'waiting' : 'task') : p.to === 'receipts' ? 'receipt' : 'note';
  return { kind, to: p.to, text: p.text, title: q.title || p.text, payload: { ...q }, confidence: p.confidence, reason: p.reason };
}
export const LOW = 0.5;
export const isLow = p => typeof p.confidence === 'number' && p.confidence < LOW;

/* What to send with a message (docs/hub.md, request.md): names only. people: directory envelope; summary: Docket's
   summary envelope (its `lists` targets, docs/summaries.md); teams: Settings' teams envelope (docs/teams.md).
   Each optional. */
export function hubContext({ people, summary, teams } = {}) {
  const ppl = people && people.schema === 'settings.people' && people.version === 1 ? people.items || [] : [];
  const cards = readCards(summary, 'prioritizer');
  const targets = cards && targetsFor([cards], 'task');
  const ls = targets ? targets.map(r => ({ name: r.title })) : [];
  const team = teams && teams.schema === 'settings.teams' && teams.version === 1 && Array.isArray(teams.items)
    ? teams.items.find(t => t && Array.isArray(t.areas) && t.areas.length) : null;
  const areas = team ? team.areas : [];
  return {
    people: ppl.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && p.name && !p.archived).slice(0, 200)
      .map(p => ({ id: p.id.slice(0, 110), name: p.name.slice(0, 200), ...(['self', 'report', 'manager', 'peer'].includes(p.relation) ? { relation: p.relation } : {}),
        ...(typeof p.team === 'boolean' ? { team: p.team } : p.relation === 'self' || p.relation === 'report' ? { team: true } : {}) })),
    lists: ls.filter(l => l && typeof l.name === 'string' && l.name).map(l => l.name.slice(0, 120)).slice(0, 200),
    areas: areas.filter(a => typeof a === 'string' && a).map(a => a.slice(0, 300)).slice(0, 200)
  };
}

export const hubId = (rand = Math.random) => 'hub_' + Date.now().toString(36) + rand().toString(36).slice(2, 8);

/* answer.md as safe HTML: everything escaped; then `code`, **bold**, "- " lists, "## " headings and bare
   http(s) links. Nothing else from the text becomes markup. */
export function answerHtml(md) {
  const inline = s => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<>"')]+)/g, (m, a, u) => `${a}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  const out = [];
  let list = false;
  for (const raw of String(md || '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    const hd = /^#{1,6}\s+(.*)$/.exec(line);
    if (hd) out.push(`<h4>${inline(hd[1])}</h4>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}

/* Sessions the hub started (their command is /hub ...): Dispatch lists them only while they need you. */
export const isHubCommand = c => /^\/hub\s/.test(String(c || ''));
