/* Build a settings form from a connector's configSchema (docs/connector.md, "Config schema and the
   settings form"), and read values back out of it. The schema is limited to the form subset
   (docs/schemas/config-form.schema.json), so each node maps to one control:

     string                      text field (format: uri -> url; x-workshop-multiline -> textarea)
     string + enum               select (x-workshop-labels for option labels)
     string + x-workshop-env     environment variable name field (shows whether it is set; no value field)
     integer / number            number field (minimum, maximum)
     boolean                     checkbox
     array of strings            list of text fields with add and remove
     array of objects            repeating group with add and remove
     object                      fieldset (nesting up to 3 levels)

   render(schema, value, env, opts) returns a DOM element whose `readValue()` gives the current config
   back as a plain object. Each control carries its own reader, so reading never re-parses the DOM.
   In read-only mode every control is disabled. PATs are never entered here: an env field shows the
   variable name and whether it is set, never a value. */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let seq = 0;
const nextId = () => 'f' + (++seq);

// Public: build the form. `env` is the GET /api/connectors/<id>/config `env` map ({NAME: {set}}).
export function render(schema, value, env, opts) {
  const node = control(schema, value, env, opts || {});
  node.classList.add('cfg-root');
  return node;
}

// Public: read the current values from a rendered form.
export function readValue(node) { return node.readValue ? node.readValue() : null; }

function control(schema, value, env, o) {
  if (schema.type === 'object') return objectField(schema, value || {}, env, o);
  if (schema.type === 'array') return arrayField(schema, Array.isArray(value) ? value : [], env, o);
  return leafField(schema, value, env, o);
}

const titleOf = (schema, fallback) => schema.title || fallback || '';
function help(text) { const p = document.createElement('p'); p.className = 'cfg-help'; p.textContent = text; return p; }

function objectField(schema, value, env, o) {
  const top = !o._nested;
  const wrap = document.createElement(top ? 'div' : 'fieldset');
  if (!top) {
    const lg = document.createElement('legend'); lg.textContent = titleOf(schema); wrap.appendChild(lg);
    if (schema.description) wrap.appendChild(help(schema.description));
  }
  const childOpts = Object.assign({}, o, { _nested: true });
  const props = schema.properties || {};
  const required = new Set(schema.required || []);
  const readers = {};
  for (const key of Object.keys(props)) {
    const sub = props[key];
    const node = control(sub, value[key], env, childOpts);
    readers[key] = node.readValue;
    wrap.appendChild(row(sub, node, key, required.has(key)));
  }
  // Keys come out in schema order. An empty optional text field is left out rather than sent as "", so it
  // does not fail its pattern and the connector's default applies.
  wrap.readValue = () => {
    const out = {};
    for (const key of Object.keys(readers)) {
      const v = readers[key]();
      if (v === undefined || (v === '' && !required.has(key))) continue;
      out[key] = v;
    }
    return out;
  };
  return wrap;
}

// A labelled row around a leaf control; object/array controls label themselves.
function row(schema, node, key, required) {
  if (schema.type === 'object' || schema.type === 'array') return node;
  const r = document.createElement('div');
  r.className = 'cfg-row';
  const id = nextId();
  const lab = document.createElement('label');
  lab.setAttribute('for', id);
  lab.textContent = titleOf(schema, key);
  const field = node.querySelector('input, select, textarea');
  if (field) { field.id = id; if (required && schema.type !== 'boolean') field.required = true; }
  if (required) { const star = document.createElement('span'); star.className = 'cfg-req'; star.textContent = ' (required)'; lab.appendChild(star); }
  if (schema.type === 'boolean') { r.classList.add('cfg-check'); r.appendChild(node); r.appendChild(lab); }
  else { r.appendChild(lab); r.appendChild(node); }
  if (schema.description) r.appendChild(help(schema.description));
  return r;
}

function leafField(schema, value, env, o) {
  const holder = document.createElement('div');
  holder.className = 'cfg-leaf';
  const ro = o.readOnly;

  if (schema['x-workshop-env']) {
    const name = value != null ? String(value) : (schema.default || '');
    const input = document.createElement('input');
    input.type = 'text'; input.value = name; input.className = 'cfg-input mono'; input.placeholder = 'ENV_VAR_NAME';
    if (ro) input.disabled = true;
    holder.appendChild(input);
    const status = document.createElement('span');
    status.className = 'cfg-env-status';
    // The agent reports only on names already saved in the config; a new name is checked after Save.
    const render = () => {
      const n = input.value.trim();
      const known = env && Object.prototype.hasOwnProperty.call(env, n);
      const set = known && env[n].set;
      status.textContent = !n ? '' : !known ? 'save to check' : set ? 'set on this computer' : 'not set on this computer';
      status.className = 'cfg-env-status ' + (!known ? '' : set ? 'ok' : 'warn');
    };
    input.addEventListener('input', render); render();
    holder.appendChild(status);
    holder.readValue = () => input.value.trim();
    return holder; // secrets are never entered here, only the variable name
  }

  if (schema.type === 'boolean') {
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = value === true;
    if (ro) input.disabled = true;
    holder.appendChild(input);
    holder.readValue = () => input.checked;
    return holder;
  }

  if (schema.type === 'integer' || schema.type === 'number') {
    const input = document.createElement('input');
    input.type = 'number'; input.className = 'cfg-input mono';
    input.value = value != null ? value : (schema.default != null ? schema.default : '');
    if (schema.minimum != null) input.min = schema.minimum;
    if (schema.maximum != null) input.max = schema.maximum;
    if (schema.type === 'integer') input.step = '1';
    if (ro) input.disabled = true;
    holder.appendChild(input);
    holder.readValue = () => { if (input.value === '') return undefined; const n = Number(input.value); return Number.isFinite(n) ? n : undefined; };
    return holder;
  }

  // string
  if (Array.isArray(schema.enum)) {
    const sel = document.createElement('select'); sel.className = 'cfg-input';
    const labels = schema['x-workshop-labels'];
    schema.enum.forEach((v, i) => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = (labels && labels[i]) || v;
      if (value === v || (value == null && schema.default === v)) opt.selected = true;
      sel.appendChild(opt);
    });
    if (ro) sel.disabled = true;
    holder.appendChild(sel);
    holder.readValue = () => sel.value;
    return holder;
  }
  if (schema['x-workshop-multiline']) {
    const ta = document.createElement('textarea'); ta.className = 'cfg-input'; ta.rows = 3;
    ta.value = value != null ? value : (schema.default || '');
    if (ro) ta.disabled = true;
    holder.appendChild(ta);
    holder.readValue = () => ta.value;
    return holder;
  }
  const input = document.createElement('input');
  input.type = schema.format === 'uri' ? 'url' : 'text'; input.className = 'cfg-input';
  input.value = value != null ? value : (schema.default || '');
  if (schema.maxLength != null) input.maxLength = schema.maxLength;
  if (ro) input.disabled = true;
  holder.appendChild(input);
  holder.readValue = () => input.value;
  return holder;
}

function arrayField(schema, value, env, o) {
  const wrap = document.createElement('fieldset');
  const lg = document.createElement('legend'); lg.textContent = titleOf(schema); wrap.appendChild(lg);
  if (schema.description) wrap.appendChild(help(schema.description));
  const list = document.createElement('div'); list.className = 'cfg-list'; wrap.appendChild(list);
  const itemReaders = [];
  const childOpts = Object.assign({}, o, { _nested: true });

  function addItem(itemValue) {
    const item = document.createElement('div'); item.className = 'cfg-item';
    const body = control(schema.items, itemValue, env, childOpts);
    body.classList.add('cfg-item-body');
    item.appendChild(body);
    const reader = body.readValue;
    itemReaders.push(reader);
    if (!o.readOnly) {
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'btn ghost cfg-remove'; rm.textContent = 'Remove';
      rm.addEventListener('click', () => { const i = itemReaders.indexOf(reader); if (i >= 0) itemReaders.splice(i, 1); item.remove(); });
      item.appendChild(rm);
    }
    list.appendChild(item);
  }
  value.forEach(addItem);

  if (!o.readOnly) {
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'btn cfg-add'; add.textContent = 'Add';
    add.addEventListener('click', () => addItem(schema.items && schema.items.type === 'object' ? {} : ''));
    wrap.appendChild(add);
  }
  wrap.readValue = () => {
    const items = itemReaders.map(r => r());
    return schema.items && schema.items.type === 'string' ? items.filter(v => v !== '') : items;
  };
  return wrap;
}

export { esc };
