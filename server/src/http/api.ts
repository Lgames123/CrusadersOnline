import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { Logger } from 'pino';
import { createGuestAccount, type TicketStore } from '../auth/tickets.ts';
import type { ServerConfig } from '../config.ts';
import { UsernameTakenError, type AccountRecord, type AccountRepository } from '../persistence/accounts.ts';
import { TokenBucket } from '../network/rate_limit.ts';

const SESSION_COOKIE = 'co_session';
const MAX_BODY_BYTES = 4096;

const CredentialsSchema = z.object({
  username: z.string().regex(/^[A-Za-z0-9_]{3,20}$/, 'username must be 3-20 letters, digits or _'),
  password: z.string().min(8, 'password must have at least 8 characters').max(128),
});

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'json_required');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || null;
  }
  return null;
}

/** Per-key token buckets with a cap on tracked keys. */
class Limiter {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly rate: number;
  private readonly burst: number;

  constructor(rate: number, burst: number) {
    this.rate = rate;
    this.burst = burst;
  }

  take(key: string): boolean {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size > 10_000) this.buckets.clear();
      this.buckets.set(key, (b = new TokenBucket(this.rate, this.burst)));
    }
    return b.take();
  }
}

export interface ApiDeps {
  config: ServerConfig;
  accounts: AccountRepository;
  tickets: TicketStore;
  log: Logger;
}

/**
 * HTTP API (ADR-008):
 *   POST /api/auth/register  {username, password} -> session cookie
 *   POST /api/auth/login     {username, password} -> session cookie
 *   POST /api/auth/logout                          -> revokes session
 *   GET  /api/auth/me                              -> account + characters
 *   POST /api/ws-ticket                            -> single-use WebSocket ticket
 *   POST /api/dev/guest-ticket (non-production)    -> ticket for an ephemeral guest
 */
export function createApiHandler(deps: ApiDeps): (req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean> {
  const { config, accounts, tickets, log } = deps;
  const perIp = new Limiter(config.httpRate, config.httpBurst);
  const perUsername = new Limiter(0.2, 5);

  const sessionCookie = (token: string, maxAgeSeconds: number) =>
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${config.cookieSecure ? '; Secure' : ''}`;

  async function requireAccount(req: IncomingMessage): Promise<{ account: AccountRecord; token: string }> {
    const token = readCookie(req, SESSION_COOKIE);
    const account = token ? await accounts.resolveSession(token) : null;
    if (!token || !account) throw new HttpError(401, 'not_authenticated');
    return { account, token };
  }

  async function startSession(res: ServerResponse, account: AccountRecord, status: number): Promise<void> {
    const token = await accounts.createSession(account.id, config.sessionTtlHours);
    const characters = await accounts.listCharacters(account.id);
    json(res, status, { username: account.username, characters }, { 'set-cookie': sessionCookie(token, config.sessionTtlHours * 3600) });
  }

  async function credentials(req: IncomingMessage): Promise<{ username: string; password: string }> {
    const ip = req.socket.remoteAddress ?? 'unknown';
    if (!perIp.take(ip)) throw new HttpError(429, 'rate_limited');
    const parsed = CredentialsSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, 'invalid_credentials_format', parsed.error.issues[0]?.message);
    if (!perUsername.take(parsed.data.username.toLowerCase())) throw new HttpError(429, 'rate_limited');
    return parsed.data;
  }

  return async (req, res, path) => {
    const route = `${req.method} ${path}`;
    try {
      switch (route) {
        case 'POST /api/auth/register': {
          const { username, password } = await credentials(req);
          try {
            const account = await accounts.register(username, password);
            log.info({ username }, 'account registered');
            await startSession(res, account, 201);
          } catch (err) {
            if (err instanceof UsernameTakenError) throw new HttpError(409, 'username_taken');
            throw err;
          }
          return true;
        }
        case 'POST /api/auth/login': {
          const { username, password } = await credentials(req);
          const account = await accounts.verifyLogin(username, password);
          if (!account) throw new HttpError(401, 'invalid_login', 'wrong username or password');
          await startSession(res, account, 200);
          return true;
        }
        case 'POST /api/auth/logout': {
          const token = readCookie(req, SESSION_COOKIE);
          if (token) await accounts.revokeSession(token);
          json(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0) });
          return true;
        }
        case 'GET /api/auth/me': {
          const { account } = await requireAccount(req);
          json(res, 200, { username: account.username, characters: await accounts.listCharacters(account.id) });
          return true;
        }
        case 'POST /api/ws-ticket': {
          if (!perIp.take(req.socket.remoteAddress ?? 'unknown')) throw new HttpError(429, 'rate_limited');
          const { account } = await requireAccount(req);
          const characters = await accounts.listCharacters(account.id);
          json(res, 200, { ticket: tickets.issue({ id: account.id, name: account.username, characters, guest: false }) });
          return true;
        }
        case 'POST /api/dev/guest-ticket': {
          if (!config.allowGuests) return false;
          if (!perIp.take(req.socket.remoteAddress ?? 'unknown')) throw new HttpError(429, 'rate_limited');
          json(res, 200, { ticket: tickets.issue(createGuestAccount()) });
          return true;
        }
        default:
          return false;
      }
    } catch (err) {
      if (err instanceof HttpError) {
        json(res, err.status, { error: err.code, message: err.message });
      } else {
        log.error({ err, route }, 'request failed');
        json(res, 500, { error: 'internal_error' });
      }
      return true;
    }
  };
}
