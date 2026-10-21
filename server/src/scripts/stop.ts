/**
 * pnpm stop:server — stops the server started on this machine (pnpm dev:server / start:server)
 * gracefully: it saves every character in the world, then exits. Use this instead of
 * Stop-Process / taskkill / closing the window. In Docker, `docker compose stop server` does the same.
 */
import { CONTROL_HEADER, CONTROL_PATH, isProcessAlive, readControlFile } from '../control.ts';

const WAIT_MS = 30_000;
const info = readControlFile();
if (!info || !isProcessAlive(info.pid)) {
  console.log('[stop] no server running here (local/server-control.json missing or stale)');
  process.exit(0);
}
try {
  const res = await fetch(`http://127.0.0.1:${info.port}${CONTROL_PATH}`, { method: 'POST', headers: { [CONTROL_HEADER]: info.token } });
  if (res.status !== 202) throw new Error(`HTTP ${res.status}`);
} catch (err) {
  console.error(`[stop] could not ask the server (pid ${info.pid}, port ${info.port}) to stop: ${(err as Error).message}`);
  process.exit(1);
}
console.log(`[stop] server (pid ${info.pid}) is saving characters and stopping…`);
const until = Date.now() + WAIT_MS;
while (isProcessAlive(info.pid)) {
  if (Date.now() > until) {
    console.error(`[stop] still running after ${WAIT_MS / 1000} s; check its log`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 200));
}
console.log('[stop] stopped');
