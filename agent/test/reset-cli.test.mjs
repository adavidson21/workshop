// `workshop reset` against a real agent: it asks, needs the exact phrase, waits, then reports the backup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main } from '../../workshop.mjs';
import { start, tempHome, rmHome, put, request, envelope, dataDirOf } from './helpers.mjs';

function ioFor(agent, home, answers) {
  const out = [], asked = [], slept = [];
  return {
    out, asked, slept,
    io: {
      out: s => out.push(s),
      env: { WORKSHOP_HOME: home },
      probe: async () => ({ app: 'workshop-agent' }),
      ask: async q => { asked.push(q); return answers.length ? answers.shift() : ''; },
      sleep: async ms => { slept.push(ms); },
      agent: async (method, p, body) => {
        const r = await request(agent, method, p, { body });
        if (r.status >= 400) throw new Error(r.json?.error || `status ${r.status}`);
        return r.json;
      }
    }
  };
}

test('workshop reset: a wrong phrase cancels; the right one waits, backs up and deletes the picked app', async () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  const agent = await start(home, null, { resetWaitMs: 0 });
  try {
    await put(agent, '/api/data/board/tasks', envelope('board', 'tasks', [{ id: 'a', updatedAt: 1792330000000 }]));
    await put(agent, '/api/files/pages/one.md', { content: '# One\n', create: true });

    let t = ioFor(agent, home, ['1', 'delete everything']);
    assert.equal(await main(['reset'], t.io), 1);
    assert.match(t.out.join('\n'), /Cancelled\. Nothing was deleted\./);
    assert.match(t.asked[1], /Type "delete 1 app"/);
    assert.ok(fs.existsSync(path.join(dd, 'board')));

    t = ioFor(agent, home, ['delete 1 app']);
    assert.equal(await main(['reset', '--apps', 'BOARD'], t.io), 0, t.out.join('\n'));
    assert.equal(fs.existsSync(path.join(dd, 'board')), false);
    assert.ok(fs.existsSync(path.join(dd, 'pages', 'one.md')));
    const text = t.out.join('\n');
    assert.match(text, /Deletes: Board/);
    assert.match(text, /Done\. Backup: .*Workshop backup .*\.zip/);
    assert.deepEqual(t.slept, [], 'no wait left when the agent asks for none');

    t = ioFor(agent, home, []);
    assert.equal(await main(['reset', '--apps', 'nope'], t.io), 1);
    assert.match(t.out.join('\n'), /There is no app named nope/);
    t = ioFor(agent, home, []);
    assert.equal(await main(['reset', '--tandem', '--all'], t.io), 1);
    assert.match(t.out.join('\n'), /opencode connector/);
  } finally { await agent.stop(); rmHome(home); }
});

test('workshop reset counts down what is left of the wait before it deletes', async () => {
  const home = tempHome();
  const agent = await start(home, null, { resetWaitMs: 2500 });
  try {
    await put(agent, '/api/data/board/tasks', envelope('board', 'tasks', []));
    const t = ioFor(agent, home, ['delete everything']);
    // The fake sleep does not wait, so the agent still says "wait": the command reports it and deletes nothing.
    assert.equal(await main(['reset', '--all'], t.io), 1);
    assert.ok(t.slept.length >= 2, 'it counted down');
    assert.match(t.out.join('\n'), /Starting in \d/);
    assert.match(t.out.join('\n'), /Stopped: Wait \d+ more second/);
  } finally { await agent.stop(); rmHome(home); }
});

test('workshop reset says to start Workshop first when it is not running', async () => {
  const out = [];
  const home = tempHome();
  const code = await main(['reset', '--all'], { out: s => out.push(s), env: { WORKSHOP_HOME: home }, probe: async () => null });
  rmHome(home);
  assert.equal(code, 1);
  assert.match(out.join('\n'), /Workshop is not running/);
});
