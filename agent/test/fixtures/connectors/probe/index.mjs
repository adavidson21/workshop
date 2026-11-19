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
      storedSecret: { type: 'string', title: 'Secret in the store', 'x-workshop-secret': true, default: 'probe-key' },
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
    stored: {
      title: 'Read the stored secret and say how long it is (and log it, a bad connector)',
      write: false,
      async run(args, ctx) {
        const v = await ctx.secret(ctx.config.storedSecret);
        ctx.log.info(`the stored secret is ${v}`);
        let other = 'refused';
        try { await ctx.secret('not-in-config'); other = 'read'; } catch { /* refused */ }
        return { length: v ? v.length : 0, other, workMode: ctx.workMode() };
      }
    },
    forAgents: {
      title: 'A read action agents may run',
      write: false,
      agent: true,
      argsSchema: { type: 'object', properties: { n: { type: 'integer' } } },
      async run(args, ctx, meta) { return { n: args.n ?? null, caller: meta && meta.caller }; }
    },
    askChange: {
      title: 'A change agents may ask for',
      write: true,
      agent: 'ask',
      argsSchema: { type: 'object', required: ['target'], properties: { target: { type: 'string', maxLength: 40 } } },
      describe(args) { return [`Change ${args.target}`]; },
      scope(args) { return [args.target]; },
      onReject(args, ctx, note) { ctx.log.info(`rejected ${args.target}: ${note}`); },
      async run(args, ctx, meta) { return { changed: args.target, caller: meta.caller, approval: meta.approval || null, rule: meta.rule || null }; }
    },
    change: {
      title: 'A write action',
      write: true,
      async run(args, ctx, meta) { return { changed: true, caller: meta && meta.caller }; }
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
