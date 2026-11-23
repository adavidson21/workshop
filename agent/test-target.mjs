// Contract suite target for the real agent (tests/contract/README.md):
//   WORKSHOP_TARGET=agent/test-target.mjs node --test "tests/contract/*.test.mjs"
//
// It writes the test's config.json into the given home folder, the same way a user would, and starts the
// agent in this process on a free port. Nothing is mocked: data goes to disk in config.dataDir. A caller that
// gives no dataDir gets a new temp data folder, removed on stop, so a test never touches the real ~/Workshop.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from './server.mjs';

/** Ask the OS for a free port on 127.0.0.1. */
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** Start an agent for one test file. Resolves {url, port, token, stop}. */
export async function start({ home, appsDir, connectorsDir, env, config }) {
  const tempData = config?.dataDir ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-target-data-'));
  const dropTemp = () => { if (tempData) fs.rmSync(tempData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };
  for (let attempt = 0; ; attempt++) {
    const port = await freePort();
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'config.json'), `${JSON.stringify({ ...config, ...(tempData ? { dataDir: tempData } : {}), port }, null, 2)}\n`);
    try {
      const agent = await createAgent({ home, appsDir, connectorsDir, env });
      const stop = async () => { await agent.stop(); dropTemp(); };
      return { url: agent.url, port: agent.port, token: agent.token, stop };
    } catch (e) {
      if (e.code !== 'EADDRINUSE' || attempt >= 4) { dropTemp(); throw e; }
    }
  }
}
