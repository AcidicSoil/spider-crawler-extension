import { createBackend } from './app.mjs';

const app = createBackend();
const port = Number(process.env.PORT || 5195);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const server = Bun.serve({ hostname: '127.0.0.1', port, fetch: app.fetch });
console.log(`Spider backend ready at http://127.0.0.1:${server.port}`);

const stop = () => {
  server.stop(true);
  app.close();
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
