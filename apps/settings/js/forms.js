/* Build a settings form from a connector's configSchema (docs/connector.md, "Config schema and the
   settings form"), and read values back out of it. The schema is limited to the form subset
   (docs/schemas/config-form.schema.json), so each node maps to one control:

     string                      text field (format: uri -> url; x-workshop-multiline -> textarea)
     string + enum               select (x-workshop-labels for option labels)
     string + x-workshop-models  select of opencode's models (provider/model), blank for opencode's default; the
                                 list comes from opts.models(), an async {models: [{provider, providerName, id, name}]}
     string + x-workshop-env     environment variable name field: whether a token is there, and Add token
                                 (saves it in this computer's secret store under that name; opts.onSecret)
     string + x-workshop-secret  secret name field: whether it is saved and until when, and Add token / Replace
                                 (opts.onSecret opens the dialog, secret-dialog.js). The button follows
                                 x-workshop-secret-kind: token, key-file or password. A value is never shown.
     integer / number            number field (minimum, maximum)
     boolean                     checkbox
     array of strings            list of text fields with add and remove
     array of objects            repeating group with add and remove
     object                      fieldset (nesting up to 3 levels)
     top level + x-workshop-tab  not shown; edited on that Settings page, value kept as it was
     top level + x-workshop-section  in a folded section with that name (for example ADO's team reports)

   Settings shows each page's fields only (pages.js cuts the schema down with subSchema), so a form here is
   one page's worth. opts.fold: false keeps optional fields with defaults in view (no "More options").

   render(schema, value, env, opts) returns a DOM element whose `readValue()` gives the current config
   back as a plain object. Each control carries its own reader, so reading never re-parses the DOM.
   In read-only mode every control is disabled. Values are never typed into the form itself: Add token opens a
   dialog that sends the value straight to Workshop's secret store, and the form keeps only the name. */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let seq = 0;
const nextId = () => 'f' + (++seq);

// Public: build the form. `env` is the GET /api/connectors/<id>/config `env` map ({NAME: {set}}).

/** The button's words for a secret field: Add or Replace, token, key file or password. */
export function secretButton(kind, saved) {
  const what = kind === 'key-file' ? 'key file' : kind === 'password' ? 'password' : 'token';
  return `${saved ? 'Replace' : 'Add'} ${what}`;
}

/** A secret's state in a few words: {text, cls}. `s` is the agent's {set, store, expires, daysLeft} or null. */
export function secretState(s, unsaved) {
  if (unsaved) return { text: 'save to check', cls: '' };
  const d = s && typeof s.daysLeft === 'number' ? s.daysLeft : null;
  if (!s || !s.set) return { text: 'not added yet', cls: 'warn' };
  if (d !== null && d < 0) return { text: `expired ${s.expires}`, cls: 'warn' };
  if (d !== null && d <= 14) return { text: `saved, expires in ${d} days`, cls: 'warn' };
  return { text: `saved in ${s.store || 'your secret store'}`, cls: 'ok' };
}

/** The command that saves a secret of this kind from a terminal, for people who prefer one. */
export function secretCommand(name, kind) {
  if (kind === 'key-file') return `workshop secret set ${name} --from-file <key.json>`;
  if (kind === 'password') return `workshop secret set ${name} --password`;
  return `workshop secret set ${name} --expires YYYY-MM-DD`;
}

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

// A field has a working default when it, or every field inside it, has one.
// Environment variable names (where a PAT lives) always stay in view.
const hasDefault = x => !x['x-workshop-env'] && !x['x-workshop-secret'] && ('default' in x) || (x.type === 'object' && Object.keys(x.properties || {}).length > 0 && Object.values(x.properties).every(hasDefault));
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
  // At the top level, optional fields that come with a working default fold under "More options", so the
  // form opens on what has to be filled in (for ADO: connections and mapping). Only when something stays out.
  // A top-level field marked x-workshop-tab is edited on that Settings tab (for ADO: repos and PR sources on
  // Repos), so the form leaves it out and hands its current value back unchanged.
  const elsewhere = top ? Object.keys(props).filter(k => props[k]['x-workshop-tab'] && !o.page) : [];
  for (const k of elsewhere) readers[k] = () => value[k];
  const keys = Object.keys(props).filter(k => !elsewhere.includes(k));
  const sectionOf = k => (top && props[k]['x-workshop-section']) || '';
  const fold = top && o.fold !== false ? keys.filter(k => !sectionOf(k) && !required.has(k) && hasDefault(props[k])) : [];
  const plain = keys.filter(k => !sectionOf(k));
  const more = fold.length && fold.length < plain.length ? document.createElement('details') : null;
  if (more) { more.className = 'cfg-more'; more.innerHTML = '<summary>More options</summary>'; }
  const sections = new Map();
  const sectionEl = name => {
    if (!sections.has(name)) {
      const d = document.createElement('details');
      d.className = 'cfg-section';
      const sm = document.createElement('summary'); sm.textContent = name; d.appendChild(sm);
      sections.set(name, d);
    }
    return sections.get(name);
  };
  for (const key of keys) {
    const sub = props[key];
    // An object in a section draws its fields straight in the section, with no box and legend of its own.
    const flat = sectionOf(key) && sub.type === 'object';
    const node = control(sub, value[key], env, flat ? Object.assign({}, o, { _nested: false, fold: false }) : childOpts);
    if (flat && sub.description) sectionEl(sectionOf(key)).appendChild(help(sub.description));
    readers[key] = node.readValue;
    const into = sectionOf(key) ? sectionEl(sectionOf(key)) : (more && fold.includes(key)) ? more : wrap;
    const r = row(sub, node, key, required.has(key));
    // A field the connector keeps only so old settings stay valid ("No longer used: ...") is not shown; its value
    // is still read back, so saving never drops it (Settings UX v1).
    if (/^No longer used/i.test(sub.description || '')) r.hidden = true;
    into.appendChild(r);
  }
  if (more) wrap.appendChild(more);
  for (const d of sections.values()) wrap.appendChild(d);
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

/** The Add token button for a token field, or null where values cannot be added (read-only, no agent). */
function actionButton(o, ro) {
  if (!o.onSecret) return null;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn cfg-secret-btn';
  if (ro) b.disabled = true;
  return b;
}

function leafField(schema, value, env, o) {
  const holder = document.createElement('div');
  holder.className = 'cfg-leaf';
  const ro = o.readOnly;

  if (schema['x-workshop-env']) {
    const name = value != null ? String(value) : (schema.default || '');
    const input = document.createElement('input');
    input.type = 'text'; input.value = name; input.className = 'cfg-input mono cfg-name'; input.placeholder = 'ENV_VAR_NAME';
    input.title = 'The name the token goes by. Keep the default unless you already use another.';
    if (ro) input.disabled = true;
    holder.appendChild(input);
    const status = document.createElement('span');
    status.className = 'cfg-env-status';
    const btn = actionButton(o, ro);
    // The agent reports only on names already saved in the config; a new name is checked after Save.
    const render = () => {
      const n = input.value.trim();
      const known = env && Object.prototype.hasOwnProperty.call(env, n);
      const e = known ? env[n] : null;
      status.textContent = !n ? '' : !known ? 'save to check' : e.stored ? secretState(e).text : e.set ? 'set on this computer' : 'not added yet';
      status.className = 'cfg-env-status ' + (!known ? '' : e.set ? 'ok' : 'warn');
      if (btn) { btn.textContent = secretButton('token', !!(e && e.stored)); btn.disabled = ro || !n || !known; }
    };
    input.addEventListener('input', render); render();
    holder.appendChild(status);
    if (btn) {
      holder.appendChild(btn);
      btn.addEventListener('click', async () => {
        const n = input.value.trim();
        const r = await o.onSecret({ kind: 'token', env: n, replace: !!(env[n] && env[n].stored) });
        if (r) { env[n] = { ...(env[n] || {}), set: true, stored: true, ...(r.status || {}) }; render(); }
      });
    }
    holder.readValue = () => input.value.trim();
    return holder; // the token itself never goes in the form, only the variable's name
  }

  if (schema['x-workshop-secret']) {
    const kind = schema['x-workshop-secret-kind'] || 'token';
    const saved0 = value != null ? String(value) : (schema.default || '');
    const input = document.createElement('input');
    input.type = 'text'; input.value = saved0; input.className = 'cfg-input mono cfg-name'; input.placeholder = 'name';
    input.title = 'The name Workshop keeps it under. Add token fills this in.';
    if (ro) input.disabled = true;
    holder.appendChild(input);
    const status = document.createElement('span');
    status.className = 'cfg-env-status';
    const btn = actionButton(o, ro);
    const secrets = o.secrets || {};
    // The agent reports on names already saved in the config (GET connector config, `secrets`); never a value.
    const render = () => {
      const n = input.value.trim();
      const s = Object.prototype.hasOwnProperty.call(secrets, n) ? secrets[n] : null;
      const pasted = n && !/^[a-z][a-z0-9-]{0,39}$/.test(n) && n.length >= 16;
      const st = pasted ? { text: 'that looks like the token itself: Save moves it into the secret store', cls: 'warn' } : !n ? { text: '', cls: '' } : secretState(s, !s);
      status.textContent = st.text;
      status.className = 'cfg-env-status ' + st.cls;
      if (btn) btn.textContent = secretButton(kind, !!(s && s.set));
    };
    input.addEventListener('input', render); render();
    holder.appendChild(status);
    if (btn) {
      holder.appendChild(btn);
      btn.addEventListener('click', async () => {
        const n = input.value.trim();
        const okName = /^[a-z][a-z0-9-]{0,39}$/.test(n);
        const r = await o.onSecret({ kind, name: okName ? n : (schema.default || o.connector || ''), replace: okName && !!(secrets[n] && secrets[n].set) });
        if (!r) return;
        secrets[r.name] = r.status || { set: true };
        if (r.name !== n) {
          input.value = r.name;
          input.dispatchEvent(new Event('input', { bubbles: true })); // marks the form changed: Save keeps the name
          status.textContent = 'saved: click Save to use it';
          status.className = 'cfg-env-status ok';
        } else render();
      });
    }
    holder.readValue = () => input.value.trim();
    return holder; // the value never goes in the form, only the name
  }

  if (schema.type === 'boolean') {
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = value === true || (value == null && schema.default === true); // unset takes the default, like other fields
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
  if (schema['x-workshop-models']) return modelsField(holder, schema, value, o);
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

/* A model picker: blank (opencode's default) first, then opencode's models grouped by provider. The saved value
   stays selectable even when opencode is off or no longer offers it, so opening and saving the page keeps it. */
function modelsField(holder, schema, value, o) {
  const saved = value != null ? String(value) : (schema.default || '');
  const sel = document.createElement('select'); sel.className = 'cfg-input';
  const status = document.createElement('span'); status.className = 'cfg-env-status';
  const fill = (models, note) => {
    const keep = sel.options.length ? sel.value : saved;
    sel.innerHTML = '';
    const add = (parent, v, label) => { const opt = document.createElement('option'); opt.value = v; opt.textContent = label; parent.appendChild(opt); };
    add(sel, '', "Opencode's default");
    const groups = new Map();
    for (const m of models) {
      if (!m || !m.provider || !m.id) continue;
      if (!groups.has(m.provider)) { const g = document.createElement('optgroup'); g.label = m.providerName || m.provider; groups.set(m.provider, g); sel.appendChild(g); }
      add(groups.get(m.provider), `${m.provider}/${m.id}`, m.name || m.id);
    }
    if (keep && ![...sel.options].some(x => x.value === keep)) add(sel, keep, `${keep} (not offered now)`);
    sel.value = keep;
    status.textContent = note || '';
    status.className = 'cfg-env-status' + (note ? ' warn' : '');
  };
  fill([], '');
  if (o.readOnly) sel.disabled = true;
  holder.appendChild(sel);
  holder.appendChild(status);
  if (o.models) {
    status.textContent = 'reading opencode\'s models...';
    Promise.resolve().then(() => o.models()).then(r => {
      const list = (r && Array.isArray(r.models)) ? r.models : [];
      fill(list, list.length ? '' : 'opencode has no models signed in yet');
    }, () => fill([], 'opencode is not connected, so only the saved choice shows'));
  }
  holder.readValue = () => sel.value;
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
