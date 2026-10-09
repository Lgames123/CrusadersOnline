import { pino } from 'pino';
import { loadConfig } from './config.ts';
import { startServer } from './index.ts';

const config = loadConfig();
const log = pino({
  level: config.logLevel,
  ...(config.env === 'development' ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l' } } } : {}),
});

let server;
try {
  server = await startServer({}, log);
} catch (err) {
  log.error((err as Error).message);
  process.exit(1);
}
log.info('simulation ticking at 20 Hz');

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    await server!.close();
    process.exit(0);
  });
}
