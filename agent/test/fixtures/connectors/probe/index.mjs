// Test fixture for agent/test: exercises ctx.log redaction, private storage on disk and a slow stop.
let state = 'stopped';
let stopMs = 0;

export default {
  api: 1,
  id: 'probe',
  name: 'Probe',
  version: '1.0.0',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      secretEnv: { type: 'string', title: 'Secret environment variable', 'x-workshop-env': true, default: 'PROBE_SECRET' },
      stopMs: { type: 'integer', title: 'Stop delay in ms (for tests)', minimum: 0, maximum: 60000, default: 0 }
    }
  },
  actions: {
    leak: {
      title: 'Log the secret (a bad connector)',
      write: false,
      async run(args, ctx) {
        ctx.log.info(`the secret is ${ctx.env(ctx.config.secretEnv)}`);
        return { logged: true };
      }
    },
    save: {
      title: 'Save a value',
      write: false,
      argsSchema: { type: 'object', required: ['value'], properties: { value: {} } },
      async run(args, ctx) {
        await ctx.storage.put('saved', args.value);
        return { read: await ctx.storage.get('saved') };
      }
    },
    badKey: {
      title: 'Use a bad storage key',
      write: false,
      async run(args, ctx) {
        try { await ctx.storage.put('../escape', 1); return { threw: false }; } catch { return { threw: true }; }
      }
    },
    badEmit: {
      title: 'Emit a payload that is too large',
      write: false,
      async run(args, ctx) {
        try { ctx.emit('big', { blob: 'x'.repeat(70 * 1024) }); return { threw: false }; } catch { return { threw: true }; }
      }
    },
    signal: {
      title: 'Report whether the abort signal fired',
      write: false,
      async run(args, ctx) { return { aborted: ctx.signal.aborted, home: ctx.home }; }
    }
  },
  async start(ctx) { stopMs = ctx.config.stopMs; state = 'ready'; },
  async stop() { await new Promise(r => setTimeout(r, stopMs)); state = 'stopped'; },
  status() { return { state, message: null }; }
};
