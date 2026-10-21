/**
 * Local control of a running server, for stopping it gracefully where signals cannot: on Windows
 * another process can only hard-kill node (Stop-Process, taskkill /F, child.kill()), which skips
 * the final character flush. main.ts writes local/server-control.json (port, pid, token); `pnpm
 * stop:server` posts the token to POST /control/shutdown on the server port. Caddy never proxies
 * /control, and the endpoint answers only the same machine.
 */
import { timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { REPO_ROOT } from './config.ts';

export const CONTROL_FILE = path.join(REPO_ROOT, 'local', 'server-control.json');
export const CONTROL_PATH = '/control/shutdown';
export const CONTROL_HEADER = 'x-control-token';

export interface ControlInfo {
  pid: number;
  port: number;
  token: string;
  databaseUrl: string;
}

/** Best effort: a container without a writable local/ simply has no control file (docker stop works there). */
export function writeControlFile(info: ControlInfo): boolean {
  try {
    mkdirSync(path.dirname(CONTROL_FILE), { recursive: true });
    writeFileSync(CONTROL_FILE, JSON.stringify(info));
    return true;
  } catch {
    return false;
  }
}

export function readControlFile(): ControlInfo | null {
  try {
    return JSON.parse(readFileSync(CONTROL_FILE, 'utf8')) as ControlInfo;
  } catch {
    return null;
  }
}

/** Removes the file only while it is still ours (a newer server may have replaced it). */
export function removeControlFile(token: string): void {
  if (readControlFile()?.token === token) rmSync(CONTROL_FILE, { force: true });
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function controlRequestAllowed(req: IncomingMessage, token: string): boolean {
  const remote = req.socket.remoteAddress ?? '';
  const local = remote === req.socket.localAddress || remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const given = Buffer.from(String(req.headers[CONTROL_HEADER] ?? ''));
  const want = Buffer.from(token);
  return local && given.length === want.length && timingSafeEqual(given, want);
}
