// Start the Workshop agent: node agent/start.mjs
//
// Reads <home>/config.json (created with defaults on first run), listens on 127.0.0.1:<port>, and prints the
// address to open. Home is ~/.workshop, or WORKSHOP_HOME. Stop it with Ctrl+C.
//
// Options:
//   --port <n>     listen on this port for this run only (config.json is not changed)
//   --quiet        do not print log lines to the console
//   --help
import { createAgent } from './server.mjs';
import { resolveHome } from './lib/home.mjs';
import { VERSION } from './version.mjs';

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`Workshop needs Node 22 or later. This is Node ${process.versions.node}.`);
  process.exit(1);
}

const args = process.argv.slice(2);
const opt = { echoLog: true };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--port') {
    const n = Number(args[++i]);
    if (!Number.isInteger(n) || n < 1024 || n > 65535) { console.error('--port needs a number from 1024 to 65535.'); process.exit(1); }
    opt.port = n;
  } else if (a === '--quiet') opt.echoLog = false;
  else if (a === '--help' || a === '-h') {
    console.log('Usage: node agent/start.mjs [--port <n>] [--quiet]\nHome folder: ~/.workshop, or set WORKSHOP_HOME.');
    process.exit(0);
  } else { console.error(`Unknown option ${a}. Try --help.`); process.exit(1); }
}

const home = resolveHome();
let agent;
try {
  agent = await createAgent({ home, port: opt.port, echoLog: opt.echoLog });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// The launcher URL carries the token once; the agent swaps it for a cookie and drops it from the address.
// It is printed here only, never written to the log.
console.log(`\nWorkshop ${VERSION} is running. Open this address in Chrome or Edge on this computer:\n\n  ${agent.url}/?token=${agent.token}\n\nHome: ${agent.home}\nLog:  ${agent.logFile}\nPress Ctrl+C to stop.\n`);

let quitting = false;
const quit = async () => {
  if (quitting) return;
  quitting = true;
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  await agent.stop();
  process.exit(0);
};
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
process.on('SIGHUP', quit);
