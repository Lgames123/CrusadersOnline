import { randomBytes } from 'node:crypto';
import { pino } from 'pino';
import { loadConfig } from './config.ts';
import { removeControlFile, writeControlFile } from './control.ts';
import { startServer, type RunningServer } from './index.ts';

const config = loadConfig();
const log = pino({
  level: config.logLevel,
  ...(config.env === 'development' ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l' } } } : {}),
});

// Every way this process is asked to stop goes through shutdown(), which flushes every character
// still in the world before exiting. Only a hard kill (SIGKILL, Stop-Process, taskkill /F, Node's
// own --watch restart on Windows) skips it: stop with `pnpm stop:server` instead.
const SHUTDOWN_DEADLINE_MS = 25_000;
const token = randomBytes(24).toString('hex');
let server: RunningServer | undefined;
let shuttingDown = false;
let stopRequested: { reason: string; exitCode: number } | null = null;

async function shutdown(reason: string, exitCode = 0): Promise<void> {
  // Asked to stop while the database is still opening: finish starting, then stop properly.
  if (!server) return void (stopRequested ??= { reason, exitCode });
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ reason }, 'shutting down: saving characters');
  setTimeout(() => {
    log.error({ reason }, `shutdown did not finish within ${SHUTDOWN_DEADLINE_MS / 1000} s; exiting anyway`);
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS).unref();
  try {
    await server.close();
    log.info('shutdown complete');
  } catch (err) {
    log.error({ err }, 'shutdown failed');
    exitCode = 1;
  }
  removeControlFile(token);
  process.exit(exitCode);
}

// SIGHUP: closing the console window on Windows (node is killed ~10 s later); SIGBREAK: Ctrl+Break.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', ...(process.platform === 'win32' ? ['SIGBREAK' as const] : [])] as const) {
  process.on(signal, () => void shutdown(signal));
}
// The dev runner (scripts/dev.ts) restarts through IPC so that restarts save too.
process.on('message', (msg: unknown) => {
  if ((msg as { t?: string } | null)?.t === 'shutdown') void shutdown('restart');
});
// A crash still saves what it can before exiting with an error.
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'uncaught exception');
  void shutdown('crash', 1);
});
process.on('unhandledRejection', (err) => {
  log.fatal({ err }, 'unhandled rejection');
  void shutdown('crash', 1);
});

try {
  server = await startServer({}, log, { control: { token, onShutdown: () => void shutdown('stop:server') } });
} catch (err) {
  log.error((err as Error).message);
  process.exit(1);
}
writeControlFile({ pid: process.pid, port: server.port, token, databaseUrl: config.databaseUrl });
log.info('simulation ticking at 20 Hz');
// (TypeScript cannot see that a signal handler may have set it during the await.)
const early = stopRequested as { reason: string; exitCode: number } | null;
if (early) void shutdown(early.reason, early.exitCode);
