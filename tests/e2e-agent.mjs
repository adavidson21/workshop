// Starts the real Workshop agent (agent/server.mjs) for tests/e2e.py, with a temporary home and the apps and
// connectors folders the test passes. Prints one JSON line {url, token} when listening, then runs until its
// stdin closes or it gets SIGTERM.
//
//   node tests/e2e-agent.mjs --home <dir> --apps <dir> --connectors <dir> [--env NAME=value ...]
import { createAgent } from '../agent/server.mjs';

const args = process.argv.slice(2);
const opt = { env: {} };
for (let i = 0; i < args.length; i++) {
  const v = () => args[++i];
  if (args[i] === '--home') opt.home = v();
  else if (args[i] === '--apps') opt.appsDir = v();
  else if (args[i] === '--connectors') opt.connectorsDir = v();
  else if (args[i] === '--env') { const [k, ...rest] = v().split('='); opt.env[k] = rest.join('='); }
}
const agent = await createAgent({ home: opt.home, appsDir: opt.appsDir, connectorsDir: opt.connectorsDir, env: opt.env, port: 0, echoLog: false });
console.log(JSON.stringify({ url: agent.url, token: agent.token }));
const quit = async () => { await agent.stop(); process.exit(0); };
process.on('SIGTERM', quit);
process.stdin.on('end', quit);
process.stdin.resume();
