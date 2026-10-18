// Test fixture for agent/test: declares a connector API version the agent does not support.
export default {
  api: 2, id: 'bad-api', name: 'Bad API', version: '1.0.0', configSchema: { type: 'object', additionalProperties: false, properties: {} },
  actions: {}, async start() {}, async stop() {}, status() { return { state: 'ready', message: null }; }
};
