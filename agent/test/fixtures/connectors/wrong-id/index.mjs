// Test fixture for agent/test: its id does not match its folder name.
export default {
  api: 1, id: 'other-id', name: 'Wrong id', version: '1.0.0', configSchema: { type: 'object', additionalProperties: false, properties: {} },
  actions: {}, async start() {}, async stop() {}, status() { return { state: 'ready', message: null }; }
};
