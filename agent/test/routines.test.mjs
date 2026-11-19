// Routines (lib/routines.mjs): when they are due, how a run starts through the opencode connector, and what is kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Routines, asCommand, runsOn, slots, CATCH_UP_HOURS } from '../lib/routines.mjs';

const at = s => new Date(s); // local time: these tests use local dates on purpose

function make({ routines = [], fail = false, now = at('2026-11-19T09:10:00') } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'routines-'));
  const config = { routines };
  const calls = [];
  const connectors = { async call(id, action, body, meta) { calls.push({ id, action, args: body.args, confirm: body.confirm, caller: meta.caller }); if (fail) throw new Error('opencode is not connected.'); return { session: 'ses_1' }; } };
  let clock = now;
  const r = new Routines({ config: () => config, connectors, dataDir, now: () => clock });
  return { r, calls, config, dataDir, set: d => { clock = d; }, done: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}
const R = (over = {}) => ({ id: 'rt-0000000a', name: 'Morning check', run: '/cloudflare why workshop', schedule: { days: 'weekdays', time: '09:00' }, enabled: true, created: '2026-11-01T00:00:00.000Z', ...over });

test('days and slots: weekdays skip the weekend, and the last and next times are found', () => {
  assert.equal(runsOn('weekdays', 6), false);
  assert.equal(runsOn('weekdays', 3), true);
  assert.equal(runsOn('thu', 4), true);
  const s = slots({ days: 'weekdays', time: '09:00' }, at('2026-11-21T10:00:00')); // a Saturday
  assert.equal(s.last.getDay(), 5);
  assert.equal(s.next.getDay(), 1);
  assert.deepEqual(asCommand('/cloudflare why workshop'), { name: 'cloudflare', args: 'why workshop' });
  assert.equal(asCommand('Summarize yesterday'), null);
});

test('a due routine starts a chat with its command once per scheduled time, as a routine, confirmed', async () => {
  const m = make({ routines: [R()] });
  try {
    assert.equal(m.r.due().length, 1);
    await m.r.tick();
    assert.deepEqual(m.calls, [{ id: 'opencode', action: 'chat.command', args: { name: 'cloudflare', args: 'why workshop' }, confirm: true, caller: 'routine' }]);
    assert.equal(m.r.due().length, 0, 'once per slot');
    await m.r.tick();
    assert.equal(m.calls.length, 1);
    const v = m.r.view();
    assert.equal(v.runs[0].ok, true);
    assert.equal(v.runs[0].session, 'ses_1');
    assert.equal(v.routines[0].lastRun.how, 'schedule');
    assert.ok(v.routines[0].next);
    m.set(at('2026-11-20T09:01:00'));
    assert.equal(m.r.due().length, 1, 'the next day is a new slot');
  } finally { m.done(); }
});

test('catch-up: a missed run runs when Workshop is back within the window; older, new or turned-off ones do not', async () => {
  const late = make({ routines: [R()], now: at(`2026-11-19T${String(9 + CATCH_UP_HOURS - 1).padStart(2, '0')}:00:00`) });
  try { assert.equal(late.r.due().length, 1); } finally { late.done(); }
  const old = make({ routines: [R()], now: at(`2026-11-19T${String(9 + CATCH_UP_HOURS + 1).padStart(2, '0')}:00:00`) });
  try { assert.equal(old.r.due().length, 0); } finally { old.done(); }
  const fresh = make({ routines: [R({ created: at('2026-11-19T09:05:00').toISOString() })] });
  try { assert.equal(fresh.r.due().length, 0, 'made after today\'s time'); } finally { fresh.done(); }
  const off = make({ routines: [R({ enabled: false })] });
  try { assert.equal(off.r.due().length, 0); } finally { off.done(); }
});

test('a prompt starts a plain chat; a failure is recorded, not thrown; Run now works any time', async () => {
  const m = make({ routines: [R({ run: 'Summarize what changed', agent: 'chat' })], fail: true });
  try {
    const out = await m.r.runNow('rt-0000000a');
    assert.equal(out.ok, false);
    assert.match(out.error, /not connected/);
    assert.deepEqual(m.calls[0], { id: 'opencode', action: 'chat.start', args: { text: 'Summarize what changed', agent: 'chat' }, confirm: true, caller: 'routine' });
    assert.equal(m.r.view().runs[0].how, 'now');
    await assert.rejects(m.r.runNow('rt-ffffffff'), /no routine/);
  } finally { m.done(); }
});

test('check: fills ids and dates, keeps old ones, and refuses bad input in words', () => {
  const m = make({ routines: [R()] });
  try {
    const out = m.r.check([{ ...R(), name: 'Renamed' }, { name: 'New', run: '/standup', schedule: { days: 'daily', time: '17:30' } }]);
    assert.equal(out[0].id, 'rt-0000000a');
    assert.equal(out[0].created, '2026-11-01T00:00:00.000Z');
    assert.match(out[1].id, /^rt-[0-9a-f]{8}$/);
    assert.equal(out[1].enabled, true);
    assert.throws(() => m.r.check([{ name: 'x', run: '/a', schedule: { days: 'someday', time: '09:00' } }]), /days is daily/);
    assert.throws(() => m.r.check([{ name: 'x', run: '/a', schedule: { days: 'daily', time: '9am' } }]), /HH:MM/);
    assert.throws(() => m.r.check([{ name: '', run: '/a', schedule: { days: 'daily', time: '09:00' } }]), /needs a name/);
    assert.throws(() => m.r.check('nope'), /Send/);
  } finally { m.done(); }
});
