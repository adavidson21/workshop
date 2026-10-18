// Contract suite target: the in-memory mock agent.
import { createMockAgent } from '../../mock-agent.mjs';

/** Start an agent for one test file. Must resolve {url, port, token, stop}. */
export async function start({ home, appsDir, connectorsDir, env, config }) {
  const agent = await createMockAgent({ home, appsDir, connectorsDir, env, config });
  return { url: agent.url, port: agent.port, token: agent.token, stop: agent.stop };
}
