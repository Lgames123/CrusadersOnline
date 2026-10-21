import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { Logger } from 'pino';
import { CHARACTER_NAME_RE, MAX_CHARACTERS, PERMANENT_UNTIL, realmPopulation, type ItemCatalog, type RealmInfo } from '@crusaders/shared';
import { createGuestAccount, type TicketStore } from '../auth/tickets.ts';
import type { ServerConfig } from '../config.ts';
import { UsernameTakenError, type AccountRecord, type AccountRepository } from '../persistence/accounts.ts';
import { NameTakenError, type CharacterRepository } from '../persistence/characters.ts';
import { TokenBucket } from '../network/rate_limit.ts';

export const SESSION_COOKIE = 'co_session';
const MAX_BODY_BYTES = 4096;

const CredentialsSchema = z.object({
  username: z.string().regex(/^[A-Za-z0-9_]{3,20}$/, 'username must be 3-20 letters, digits or _'),
  password: z.string().min(8, 'password must have at least 8 characters').max(128),
});

const NewCharacterSchema = z.object({ name: z.string().regex(CHARACTER_NAME_RE, 'name must be 3-20 letters, digits or _') });
/** Deleting asks for the character's name again, as typed confirmation. */
const DeleteCharacterSchema = z.object({ name: z.string().max(20) });
const TicketSchema = z.object({ characterId: z.uuid() });
const CHARACTER_PATH = /^\/api\/characters\/([0-9a-f-]{36})$/i;

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
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

export function readCookie(req: IncomingMessage, name: string): string | null {
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

/** The client's address: the proxy's header when configured (its first entry), else the socket's. */
export function clientIp(req: IncomingMessage, header: string | null): string {
  const raw = header ? req.headers[header] : undefined;
  const first = (Array.isArray(raw) ? raw[0] : raw)?.split(',')[0]?.trim();
  return first || (req.socket.remoteAddress ?? 'unknown');
}

export interface ApiDeps {
  config: ServerConfig;
  accounts: AccountRepository;
  characters: CharacterRepository;
  /** Item catalog, to tell what a character wears on the character screen. */
  items: ItemCatalog;
  tickets: TicketStore;
  log: Logger;
  /** Players in the world now (realm population). */
  onlinePlayers?: () => number;
  /** Whether a character is in (or entering) the world: it cannot be deleted then. */
  isCharacterOnline?: (characterId: string) => boolean;
  /** Admin panel routes (/api/admin/*), given the signed-in admin account. */
  admin?: (req: IncomingMessage, res: ServerResponse, path: string, url: URL, account: AccountRecord) => Promise<boolean>;
}

/** Why a banned account is refused, for the login page. */
export function bannedMessage(a: AccountRecord): string | null {
  if (!a.bannedUntil || a.bannedUntil <= Date.now()) return null;
  const when = a.bannedUntil >= PERMANENT_UNTIL ? 'permanently' : `until ${new Date(a.bannedUntil).toUTCString()}`;
  return `This account is banned ${when}${a.banReason ? ` (${a.banReason})` : ''}.`;
}

/**
 * HTTP API (ADR-008):
 *   POST /api/auth/register  {username, password} -> session cookie
 *   POST /api/auth/login     {username, password} -> session cookie
 *   POST /api/auth/logout                          -> revokes session
 *   GET  /api/auth/me                              -> account + characters
 *   GET  /api/realms                               -> server selection list
 *   GET  /api/characters                           -> character screen details
 *   POST /api/characters      {name}               -> new character (up to MAX_CHARACTERS)
 *   DELETE /api/characters/:id {name}              -> deletes it (the name typed as confirmation)
 *   POST /api/ws-ticket       [{characterId}]      -> single-use WebSocket ticket (for that character)
 *   POST /api/dev/guest-ticket (non-production)    -> ticket for an ephemeral guest
 */
export function createApiHandler(deps: ApiDeps): (req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean> {
  const { config, accounts, characters, items, tickets, log } = deps;
  const perIp = new Limiter(config.httpRate, config.httpBurst);
  const perUsername = new Limiter(0.2, 5);

  const sessionCookie = (token: string, maxAgeSeconds: number) =>
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${config.cookieSecure ? '; Secure' : ''}`;

  async function requireAccount(req: IncomingMessage): Promise<{ account: AccountRecord; token: string }> {
    const token = readCookie(req, SESSION_COOKIE);
    const account = token ? await accounts.resolveSession(token) : null;
    if (!token || !account) throw new HttpError(401, 'not_authenticated');
    const banned = bannedMessage(account);
    if (banned) throw new HttpError(403, 'banned', banned);
    return { account, token };
  }

  async function startSession(res: ServerResponse, account: AccountRecord, status: number): Promise<void> {
    const banned = bannedMessage(account);
    if (banned) throw new HttpError(403, 'banned', banned);
    // ADMIN_USERS: these accounts get the admin panel when they sign in.
    if (!account.isAdmin && config.adminUsers.includes(account.username.toLowerCase())) {
      await accounts.setAdmin(account.username, true);
      account.isAdmin = true;
      log.info({ username: account.username }, 'admin granted (ADMIN_USERS)');
    }
    const token = await accounts.createSession(account.id, config.sessionTtlHours);
    const characters = await accounts.listCharacters(account.id);
    json(res, status, { username: account.username, characters, ...(account.isAdmin ? { admin: true } : {}) }, { 'set-cookie': sessionCookie(token, config.sessionTtlHours * 3600) });
  }

  async function credentials(req: IncomingMessage): Promise<{ username: string; password: string }> {
    const ip = clientIp(req, config.clientIpHeader);
    if (!perIp.take(ip)) throw new HttpError(429, 'rate_limited');
    const parsed = CredentialsSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, 'invalid_credentials_format', parsed.error.issues[0]?.message);
    if (!perUsername.take(parsed.data.username.toLowerCase())) throw new HttpError(429, 'rate_limited');
    return parsed.data;
  }

  async function body<T>(req: IncomingMessage, schema: z.ZodType<T>, code: string): Promise<T> {
    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, code, parsed.error.issues[0]?.message);
    return parsed.data;
  }

  return async (req, res, path) => {
    if (path.startsWith('/api/admin/') && deps.admin) {
      try {
        const { account } = await requireAccount(req);
        if (!account.isAdmin) throw new HttpError(403, 'not_admin', 'This account is not an administrator.');
        return await deps.admin(req, res, path, new URL(req.url ?? '/', 'http://localhost'), account);
      } catch (err) {
        if (err instanceof HttpError) json(res, err.status, { error: err.code, message: err.message });
        else {
          log.error({ err, path }, 'admin request failed');
          json(res, 500, { error: 'internal_error' });
        }
        return true;
      }
    }
    const deleting = req.method === 'DELETE' ? CHARACTER_PATH.exec(path) : null;
    const route = deleting ? 'DELETE /api/characters/:id' : `${req.method} ${path}`;
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
          json(res, 200, { username: account.username, characters: await accounts.listCharacters(account.id), ...(account.isAdmin ? { admin: true } : {}) });
          return true;
        }
        case 'GET /api/realms': {
          const { account } = await requireAccount(req);
          const online = deps.onlinePlayers?.() ?? 0;
          // One world per server: this one.
          const realm: RealmInfo = {
            id: config.realmName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            name: config.realmName,
            type: config.features.length > 0 ? 'Classic + features' : 'Classic',
            population: realmPopulation(online),
            online,
            characters: (await accounts.listCharacters(account.id)).length,
          };
          json(res, 200, { realms: [realm] });
          return true;
        }
        case 'GET /api/characters': {
          const { account } = await requireAccount(req);
          json(res, 200, { characters: await characters.listDetails(account.id, items), max: MAX_CHARACTERS });
          return true;
        }
        case 'POST /api/characters': {
          if (!perIp.take(clientIp(req, config.clientIpHeader))) throw new HttpError(429, 'rate_limited');
          const { account } = await requireAccount(req);
          const { name } = await body(req, NewCharacterSchema, 'invalid_name');
          let created: Awaited<ReturnType<CharacterRepository['create']>>;
          try {
            created = await characters.create(account.id, name);
          } catch (err) {
            if (err instanceof NameTakenError) throw new HttpError(409, 'name_taken');
            throw err;
          }
          if (created === 'limit') throw new HttpError(409, 'character_limit', `at most ${MAX_CHARACTERS} characters per account`);
          log.info({ account: account.username, character: name }, 'character created');
          json(res, 201, { id: created.id });
          return true;
        }
        case 'DELETE /api/characters/:id': {
          if (!perIp.take(clientIp(req, config.clientIpHeader))) throw new HttpError(429, 'rate_limited');
          const { account } = await requireAccount(req);
          const id = deleting![1]!.toLowerCase();
          const { name } = await body(req, DeleteCharacterSchema, 'invalid_request');
          const own = (await accounts.listCharacters(account.id)).find((c) => c.id === id);
          if (!own) throw new HttpError(404, 'character_not_found');
          if (own.name.toLowerCase() !== name.trim().toLowerCase()) throw new HttpError(400, 'name_mismatch');
          if (deps.isCharacterOnline?.(id)) throw new HttpError(409, 'character_online');
          await characters.delete(account.id, id);
          log.info({ account: account.username, character: own.name }, 'character deleted');
          json(res, 200, { ok: true });
          return true;
        }
        case 'POST /api/ws-ticket': {
          if (!perIp.take(clientIp(req, config.clientIpHeader))) throw new HttpError(429, 'rate_limited');
          const { account } = await requireAccount(req);
          let list = await accounts.listCharacters(account.id);
          // The character screen names the character to play; without one, the first.
          if (/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
            const { characterId } = await body(req, TicketSchema, 'invalid_request');
            list = list.filter((c) => c.id === characterId.toLowerCase());
            if (list.length === 0) throw new HttpError(404, 'character_not_found');
          }
          if (list.length === 0) throw new HttpError(409, 'no_character');
          json(res, 200, { ticket: tickets.issue({ id: account.id, name: account.username, characters: list, guest: false, admin: account.isAdmin, mutedUntil: account.mutedUntil }) });
          return true;
        }
        case 'POST /api/dev/guest-ticket': {
          if (!config.allowGuests) return false;
          if (!perIp.take(clientIp(req, config.clientIpHeader))) throw new HttpError(429, 'rate_limited');
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
