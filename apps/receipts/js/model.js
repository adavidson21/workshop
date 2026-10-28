/* Receipts: the data model. Constants, the default config (Workshop's own generic rubric), collection
   names, schema versions and migrations, entry cleanup, cycles, coverage and scores. No DOM and no SDK,
   so Node tests can use every function here. Schemas: ../README.md and ../schemas/. */

export const APP = 'receipts';

/* ---------- collections and versions ---------- */

// Every collection Receipts owns, by kind. Nested names follow docs/data-format.md (Names).
export const VERSIONS = { config: 1, entries: 1, metrics: 1, summary: 1 };
export const CONFIG = 'config';
export const entriesName = (personId, year) => `entries/${personId}/${year}`;
export const metricsName = (personId, month) => `metrics/${personId}/${month}`;
export const goalsName = (personId, year) => `goals/${personId}/${year}`;
// A summary is a Markdown file (ws.files) plus a sidecar collection (ws.data) of the same name.
export const summaryBase = (personId, cycleId, version = 1) => `summaries/${personId}/${cycleId}${version > 1 ? '-v' + version : ''}`;
export const summaryFile = (personId, cycleId, version = 1) => summaryBase(personId, cycleId, version) + '.md';

/** The kind of a collection from its name: 'config', 'entries', 'metrics', 'goals' or 'summary'. */
export function kindOf(collection) {
  if (collection === CONFIG) return 'config';
  const k = collection.split('/')[0];
  return k === 'summaries' ? 'summary' : k;
}
export const schemaOf = collection => `${APP}.${collection}`;

/** An empty envelope for a collection, ready for its first put. */
export function emptyEnvelope(collection, meta) {
  const env = { schema: schemaOf(collection), version: VERSIONS[kindOf(collection)] || 1, rev: 0, items: [], deleted: {} };
  if (meta) env.meta = meta;
  return env;
}

// One pure, idempotent function per version step, run in order on read (docs/data-format.md, Migrations).
// Every collection is at version 1, so there are no steps yet. A step looks like:
//   entries: { 1: env => ({...env, version: 2, items: env.items.map(...)}) }
export const MIGRATIONS = { config: {}, entries: {}, metrics: {}, summary: {} };

/** Brings an envelope up to the current version. Returns {env, tooNew}. A newer version is never changed. */
export function migrate(env, collection, steps = MIGRATIONS) {
  if (!env) return { env, tooNew: false };
  const kind = kindOf(collection), target = VERSIONS[kind];
  if (env.version > target) return { env, tooNew: true };
  let out = env;
  while (out.version < target) {
    const step = steps[kind] && steps[kind][out.version];
    if (!step) throw new Error(`No migration for ${collection} from version ${out.version}.`);
    out = step(out);
  }
  return { env: out, tooNew: false };
}

/* ---------- names ---------- */

export const SEGMENT = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A stable id from a name, unique among `taken`. Matches the collection segment rule. */
export function slugify(name, taken = []) {
  let base = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36).replace(/-+$/, '');
  if (!base) base = 'person';
  const used = new Set(taken);
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  return id;
}

let counter = 0;
/** A new item id: `r_` plus time and a counter in base 36, random enough for one user's data. */
export function newId(prefix = 'r') {
  counter = (counter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
}

/* ---------- vocabulary ---------- */

export const KINDS = [
  { id: 'win', name: 'Win' },
  { id: 'growth', name: 'Growth' },
  { id: 'concern', name: 'Concern' },
  { id: 'feedback', name: 'Feedback' },
  { id: 'note', name: 'Note' }
];
export const RELATIONS = [
  { id: 'self', name: 'You' },
  { id: 'report', name: 'Direct report' },
  { id: 'manager', name: 'Manager' }
];
export const EFFORTS = ['S', 'M', 'L'];
export const VISIBILITY = ['Self', 'Team', 'Org', 'Company', 'Customer'];
export const ARTIFACTS = ['PR', 'Ticket', 'Design doc', 'RFC', 'Runbook', 'Postmortem', 'Release notes', 'Dashboard', 'PRD', 'Roadmap', 'Experiment', 'Other'];
export const METRIC_SOURCES = ['Observed', 'Dashboard', 'Ticket', 'PR', 'Incident', 'Customer', 'Other'];

/* ---------- the default config: Workshop's own rubric, not any company's review form ---------- */

export const DEFAULT_RUBRIC = [
  { id: 'results', name: 'Results', description: 'Delivered outcomes, met commitments, measurable impact.' },
  { id: 'craft', name: 'Craft', description: 'Quality of work, technical or functional depth, sound decisions.' },
  { id: 'ownership', name: 'Ownership', description: 'Initiative, follow-through, fixing problems without being asked.' },
  { id: 'collaboration', name: 'Collaboration', description: 'Working across people and teams, unblocking others.' },
  { id: 'communication', name: 'Communication', description: 'Clarity in writing and speaking, keeping the right people informed.' },
  { id: 'leadership', name: 'Leadership', description: 'Mentoring, raising the bar, influence without authority, developing people.' },
  { id: 'growth', name: 'Growth', description: 'New skills, acting on feedback, stretch work.' }
];

export const DEFAULT_ROLES = [
  { id: 'engineer-ic', name: 'Engineer IC' },
  { id: 'engineering-manager', name: 'Engineering Manager' },
  { id: 'product-ic', name: 'Product IC' },
  { id: 'product-manager', name: 'Product Manager' }
];

// Generic work types per role (ported from TaskLedger's role category lists).
export const DEFAULT_CATEGORIES = {
  'engineer-ic': ['Feature delivery', 'Technical design', 'Reliability and on-call', 'Performance and scaling', 'Quality and testing',
    'Security and risk reduction', 'Developer experience and tooling', 'Documentation and runbooks', 'Mentoring and knowledge sharing', 'Refactoring and tech debt'],
  'engineering-manager': ['Delivery and execution', 'Incident leadership', 'Cross-team leadership', 'Stakeholder management', 'Technical strategy',
    'Process improvement', 'Delegation and scaling the team', 'Hiring and staffing', 'Coaching and growth', 'Operational excellence'],
  'product-ic': ['Discovery and research', 'Requirements', 'Roadmap and prioritization', 'Stakeholder alignment', 'Delivery and execution',
    'Experiments', 'Metrics and analytics', 'Customer feedback', 'Launch', 'Process improvement'],
  'product-manager': ['Product strategy', 'Portfolio and roadmap planning', 'Cross-functional leadership', 'Stakeholder and exec alignment', 'Team execution',
    'Coaching and development', 'Hiring and staffing', 'Operating rhythm', 'Customer and market strategy', 'Metrics and outcomes']
};

// The CSV and Excel columns, in order. `scores` columns are opt-in, as in TaskLedger.
export const CSV_COLUMNS = [
  'EntryId', 'Date', 'Quarter', 'Year', 'Person', 'Relation', 'Role', 'Kind', 'Category', 'RubricPrimary', 'RubricSecondary',
  'Visibility', 'Impact', 'Strategic', 'Effort', 'RiskReduced', 'Metric', 'MetricSource', 'Collaborators', 'Artifact', 'Links',
  'Bullet', 'Note', 'Tags', 'NeedsReview', 'Source', 'LeverageScore', 'ReviewScore'
];
export const DEFAULT_CSV_COLUMNS = CSV_COLUMNS.filter(c => c !== 'LeverageScore' && c !== 'ReviewScore');
export const NUDGE_DAYS = 14;
export const SELF_ID = 'me';

/** Half-year cycles for `year`: H1 and H2, each due two weeks after it ends. */
export function defaultCycles(year) {
  return [
    { id: `${year}-h1`, name: `H1 ${year}`, start: `${year}-01-01`, end: `${year}-06-30`, due: `${year}-07-14` },
    { id: `${year}-h2`, name: `H2 ${year}`, start: `${year}-07-01`, end: `${year}-12-31`, due: `${year + 1}-01-14` }
  ];
}

/** The config envelope written on first run: you as `self`, the generic rubric, roles, categories, cycles. */
export function defaultConfig({ today, selfName = 'You', now = Date.now() } = {}) {
  const year = Number(String(today).slice(0, 4));
  const env = emptyEnvelope(CONFIG, {
    updatedAt: now,
    rubric: DEFAULT_RUBRIC.map(r => ({ ...r })),
    roles: DEFAULT_ROLES.map(r => ({ ...r })),
    categories: Object.fromEntries(Object.entries(DEFAULT_CATEGORIES).map(([k, v]) => [k, [...v]])),
    cycles: defaultCycles(year),
    nudgeDays: NUDGE_DAYS,
    csvColumns: [...DEFAULT_CSV_COLUMNS]
  });
  env.items.push({ id: SELF_ID, updatedAt: now, name: selfName || 'You', relation: 'self', role: 'engineering-manager', level: '', active: true });
  return env;
}

/* ---------- reading config safely (keeps unknown fields; fills what is missing) ---------- */

/** The config's settings with defaults for anything missing. Never changes the envelope. */
export function settingsOf(configEnv, today) {
  const m = (configEnv && configEnv.meta) || {};
  const arr = (v, d) => Array.isArray(v) && v.length ? v : d;
  return {
    rubric: arr(m.rubric, DEFAULT_RUBRIC),
    roles: arr(m.roles, DEFAULT_ROLES),
    categories: m.categories && typeof m.categories === 'object' ? m.categories : DEFAULT_CATEGORIES,
    cycles: arr(m.cycles, defaultCycles(Number(String(today).slice(0, 4)))),
    nudgeDays: Number.isInteger(m.nudgeDays) && m.nudgeDays > 0 ? m.nudgeDays : NUDGE_DAYS,
    csvColumns: arr(m.csvColumns, DEFAULT_CSV_COLUMNS).filter(c => CSV_COLUMNS.includes(c))
  };
}

/** People in display order: you first, then your manager, then reports, each by name. */
export function peopleOf(configEnv, { activeOnly = false } = {}) {
  const order = { self: 0, manager: 1, report: 2 };
  return ((configEnv && configEnv.items) || [])
    .filter(p => p && typeof p.id === 'string' && (!activeOnly || p.active !== false))
    .sort((a, b) => (order[a.relation] ?? 3) - (order[b.relation] ?? 3) || String(a.name).localeCompare(String(b.name)));
}

export const categoriesFor = (settings, roleId) => (settings.categories && settings.categories[roleId]) || [];

/* ---------- entries ---------- */

const str = (v, max = 4000) => typeof v === 'string' ? v.slice(0, max) : '';
const strs = (v, max = 20) => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 200)).slice(0, max) : [];
export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const isHttp = u => typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u.trim());

/** A clean entry: known fields with valid values, unknown fields kept as they are. */
export function cleanEntry(e, rubricIds) {
  const out = { ...e };
  out.date = isDate(e.date) ? e.date : '';
  out.kind = KINDS.some(k => k.id === e.kind) ? e.kind : 'note';
  out.note = str(e.note);
  out.rubric = strs(e.rubric, 3).filter(r => !rubricIds || rubricIds.includes(r)).filter((r, i, a) => a.indexOf(r) === i);
  out.category = str(e.category, 200);
  out.bullet = str(e.bullet, 600);
  out.impact = Number.isInteger(e.impact) && e.impact >= 1 && e.impact <= 5 ? e.impact : null;
  out.effort = EFFORTS.includes(e.effort) ? e.effort : null;
  out.strategic = e.strategic === true;
  out.riskReduced = Number.isInteger(e.riskReduced) && e.riskReduced >= 0 && e.riskReduced <= 5 ? e.riskReduced : null;
  out.visibility = VISIBILITY.includes(e.visibility) ? e.visibility : null;
  out.collaborators = strs(e.collaborators);
  out.artifact = str(e.artifact, 100);
  out.links = strs(e.links).filter(isHttp);
  out.metric = str(e.metric, 300);
  out.metricSource = str(e.metricSource, 100);
  out.tags = strs(e.tags).map(t => t.toLowerCase());
  out.review = e.review === true;
  out.source = str(e.source, 40) || 'manual';
  out.sourceRef = str(e.sourceRef, 300);
  return out;
}

/** A new manual entry. */
export function newEntry(fields, today) {
  return cleanEntry({ id: newId('r'), date: today, kind: 'win', source: 'manual', ...fields });
}

/** Why an entry is in Needs review: missing a rubric section or a bullet, or marked for review. */
export function reviewReasons(e) {
  const r = [];
  if (!e.rubric || !e.rubric.length) r.push('rubric');
  if (!e.bullet || !e.bullet.trim()) r.push('bullet');
  if (e.review) r.push('marked');
  return r;
}
export const needsReview = e => reviewReasons(e).length > 0;

/* ---------- dates and cycles ---------- */

export const yearOf = date => Number(String(date).slice(0, 4));
export const monthOf = date => String(date).slice(0, 7);
export function quarterOf(date) {
  const m = Number(String(date).slice(5, 7));
  return m <= 3 ? 'Q1' : m <= 6 ? 'Q2' : m <= 9 ? 'Q3' : 'Q4';
}
export const inCycle = (date, c) => !!c && date >= c.start && date <= c.end;
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
export function todayLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const cycleById = (settings, id) => settings.cycles.find(c => c.id === id) || null;

/** Cycles sorted by start date, oldest first. */
export const sortedCycles = settings => [...settings.cycles].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));

/** The cycle holding `today`, else the latest one that started before it, else the first. */
export function currentCycle(settings, today) {
  const cs = sortedCycles(settings);
  return cs.find(c => inCycle(today, c)) || [...cs].reverse().find(c => c.start <= today) || cs[0] || null;
}
/** The cycle before `cycle` by start date, or null. */
export function previousCycle(settings, cycle) {
  const cs = sortedCycles(settings);
  const i = cs.findIndex(c => c.id === cycle.id);
  return i > 0 ? cs[i - 1] : null;
}
/** Every yyyy-mm a cycle touches, in order. */
export function monthsOf(cycle) {
  const out = [];
  let y = yearOf(cycle.start), m = Number(cycle.start.slice(5, 7));
  const endY = yearOf(cycle.end), endM = Number(cycle.end.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) { out.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
  return out;
}
/** The entry years to load: every year a cycle touches, plus this year. */
export function yearsToLoad(settings, today) {
  const ys = new Set([yearOf(today)]);
  for (const c of settings.cycles) for (let y = yearOf(c.start); y <= yearOf(c.end); y++) ys.add(y);
  return [...ys].filter(Number.isFinite).sort();
}
/** A cycle is valid when its id is a name segment and its dates are in order. */
export function validCycle(c) {
  return !!c && SEGMENT.test(c.id || '') && typeof c.name === 'string' && c.name.trim() !== '' && isDate(c.start) && isDate(c.end) && c.start <= c.end && (!c.due || isDate(c.due));
}

/* ---------- coverage and scores ---------- */

/** Entries in a cycle, oldest first (date, then id for a stable order). */
export function entriesIn(entries, cycle) {
  return entries.filter(e => inCycle(e.date, cycle)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** Counts per rubric section (an entry counts for each section it lists), kinds, and the empty sections. */
export function coverage(entries, rubric) {
  const bySection = Object.fromEntries(rubric.map(r => [r.id, 0]));
  const byKind = Object.fromEntries(KINDS.map(k => [k.id, 0]));
  for (const e of entries) {
    for (const r of e.rubric || []) if (r in bySection) bySection[r]++;
    if (e.kind in byKind) byKind[e.kind]++;
  }
  return { total: entries.length, bySection, byKind, gaps: rubric.filter(r => !bySection[r.id]).map(r => r.id) };
}

const VISIBILITY_WEIGHT = { Self: 1, Team: 2, Org: 3, Company: 4, Customer: 4 };
const EFFORT_WEIGHT = { S: 1, M: 2, L: 3 };
/** Impact times how far the work was seen (TaskLedger's leverage score). 0 to 20. */
export const leverageScore = e => (e.impact || 0) * (VISIBILITY_WEIGHT[e.visibility || 'Self'] || 1);
/** Impact, strategic fit, risk reduced and effort (TaskLedger's review score). 1 to 20. */
export const reviewScore = e => (e.impact || 0) * 2 + (e.strategic ? 2 : 0) + (e.riskReduced || 0) + (EFFORT_WEIGHT[e.effort || 'S'] || 1);

/** The latest entry date for a person, or null. */
export const lastEntryDate = entries => entries.reduce((m, e) => (e.date && (!m || e.date > m) ? e.date : m), null);
