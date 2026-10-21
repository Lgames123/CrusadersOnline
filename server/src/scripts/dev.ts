/**
 * pnpm dev:server — runs main.ts and restarts it when server or shared code changes, like
 * `node --watch`, but every restart is graceful: the child is asked over IPC to save and exit.
 * (`node --watch` restarts with child.kill(), which on Windows is a hard kill that loses up to a
 * minute of every online character's progress.) Ctrl+C reaches the child too; this waits for it.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from '../config.ts';

const MAIN = fileURLToPath(new URL('../main.ts', import.meta.url));
const WATCHED = [path.join(REPO_ROOT, 'server', 'src'), path.join(REPO_ROOT, 'shared', 'src')];
const KILL_AFTER_MS = 30_000;

let child: ChildProcess | null = null;
let restartPending = false;
let exiting = false;
let debounce: NodeJS.Timeout | undefined;

function start(): void {
  const c = fork(MAIN, process.argv.slice(2), { stdio: 'inherit', execArgv: process.execArgv });
  child = c;
  c.on('exit', (code, signal) => {
    if (child === c) child = null;
    if (exiting) process.exit(0);
    if (restartPending) {
      restartPending = false;
      start();
    } else {
      console.log(`[dev] server exited (${signal ?? `code ${code}`}); waiting for a file change to start it again`);
    }
  });
}

function stopChild(): void {
  const c = child;
  if (!c || c.exitCode !== null) return;
  if (c.connected) c.send({ t: 'shutdown' });
  setTimeout(() => {
    if (c.exitCode === null && c.signalCode === null) {
      console.error(`[dev] server did not stop within ${KILL_AFTER_MS / 1000} s; killing it`);
      c.kill('SIGKILL');
    }
  }, KILL_AFTER_MS).unref();
}

function changed(file: string | null): void {
  if (exiting || (file && !/\.(ts|json)$/.test(file))) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    console.log(`[dev] ${file ?? 'change'} → restarting (saving characters first)`);
    if (child) {
      restartPending = true;
      stopChild();
    } else {
      start();
    }
  }, 300);
}

for (const dir of WATCHED) watch(dir, { recursive: true }, (_event, file) => changed(file));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', ...(process.platform === 'win32' ? ['SIGBREAK' as const] : [])] as const) {
  process.on(signal, () => {
    exiting = true;
    if (child) stopChild();
    else process.exit(0);
  });
}
start();
