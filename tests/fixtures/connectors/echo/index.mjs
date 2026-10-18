// Test fixture: a complete, minimal connector per docs/connector.md. It talks to nothing outside
// Workshop. The contract suite uses it to exercise every part of the connector contract.
let starts = 0;
let state = 'stopped';
let message = null;

export default {
  api: 1,
  id: 'echo',
  name: 'Echo',
  version: '1.0.0',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['greeting'],
    properties: {
      greeting: { type: 'string', title: 'Greeting', default: 'Hello', maxLength: 40 },
      tokenEnv: { type: 'string', title: 'Token environment variable', 'x-workshop-env': true, default: 'ECHO_TOKEN' },
      mode: { type: 'string', title: 'Mode', enum: ['plain', 'loud'], 'x-workshop-labels': ['As typed', 'Upper case'], default: 'plain' },
      failStart: { type: 'boolean', title: 'Fail on start (for tests)', default: false }
    }
  },
  test: { action: 'echo', arg: 'text', label: 'Text' },
  actions: {
    echo: {
      title: 'Echo text back',
      write: false,
      argsSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 200 } } },
      async run(args, ctx) {
        const text = ctx.config.mode === 'loud' ? args.text.toUpperCase() : args.text;
        ctx.emit('echoed', { text });
        return { greeting: ctx.config.greeting, text, tokenSet: Boolean(ctx.env(ctx.config.tokenEnv)), starts };
      }
    },
    record: {
      title: 'Record a note outside Workshop',
      write: true,
      async run(args, ctx) {
        const list = (await ctx.storage.get('records')) || [];
        list.push(args);
        await ctx.storage.put('records', list);
        return { count: list.length };
      }
    },
    envProbe: {
      title: 'Try to read an undeclared environment variable',
      write: false,
      async run(args, ctx) {
        try { ctx.env('PATH'); return { threw: false }; } catch { return { threw: true }; }
      }
    },
    fail: {
      title: 'Fail on purpose',
      write: false,
      async run() {
        const err = new Error('The echo service is not answering.');
        err.status = 503;
        err.code = 'unavailable';
        throw err;
      }
    }
  },
  async start(ctx) {
    starts++;
    if (ctx.config.failStart) {
      state = 'error';
      message = 'Start failed on purpose.';
      return;
    }
    state = 'ready';
    message = null;
  },
  async stop() {
    state = 'stopped';
    message = null;
  },
  status() {
    return { state, message, details: { starts } };
  }
};
