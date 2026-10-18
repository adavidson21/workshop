// Checks a connector module's default export against docs/connector.md. Shared by the mock agent and
// tests/check-contracts.mjs; the real agent (WS1) must apply the same checks when it loads a connector.
const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const ACTION = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

/** Returns null if the module is valid, else one plain-words problem. */
export function checkConnectorModule(m, folder, schemas) {
  if (!m || typeof m !== 'object') return 'No default export object.';
  if (m.api !== 1) return `Unsupported connector api ${JSON.stringify(m.api)}; expected 1.`;
  if (typeof m.id !== 'string' || !NAME.test(m.id)) return `id ${JSON.stringify(m.id)} is not a valid connector id.`;
  if (m.id !== folder) return `id "${m.id}" does not match its folder "${folder}".`;
  if (typeof m.name !== 'string' || !m.name) return 'Missing name.';
  if (typeof m.version !== 'string' || !SEMVER.test(m.version)) return 'version must be major.minor.patch.';
  for (const k of ['start', 'stop', 'status']) if (typeof m[k] !== 'function') return `Missing ${k}().`;
  const formErrors = schemas.validate('config-form', m.configSchema);
  if (formErrors.length) return `configSchema is outside the form subset: ${formErrors[0]}`;
  if (!m.actions || typeof m.actions !== 'object' || Array.isArray(m.actions)) return 'Missing actions object.';
  for (const [name, a] of Object.entries(m.actions)) {
    if (!ACTION.test(name)) return `Action name "${name}" is not valid.`;
    if (!a || typeof a.run !== 'function') return `Action ${name} has no run().`;
    if (typeof a.title !== 'string' || !a.title) return `Action ${name} has no title.`;
    if (typeof a.write !== 'boolean') return `Action ${name} must say write: true or false.`;
    if (a.argsSchema !== undefined && (typeof a.argsSchema !== 'object' || a.argsSchema === null)) return `Action ${name} argsSchema must be a schema object.`;
  }
  if (m.test !== undefined) {
    const t = m.test;
    if (!t || !Object.hasOwn(m.actions, t.action)) return 'test.action must name one of the actions.';
    if (m.actions[t.action].write) return 'test.action must be a read action.';
    if (typeof t.arg !== 'string' || typeof t.label !== 'string') return 'test needs arg and label.';
  }
  return null;
}
