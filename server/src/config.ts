import { existsSync } from 'node:fs';
import path from 'node:path';

export interface ServerConfig {
  host: string;
  port: number;
  env: 'development' | 'production' | 'test';
  logLevel: string;
  wsTicketTtlSeconds: number;
  /** Enables POST /api/dev/guest-ticket. Never on in production. */
  allowGuests: boolean;
  /** postgres://..., pglite:<dir> or pglite:memory (see persistence/db.ts). */
  databaseUrl: string;
  sessionTtlHours: number;
  /** Adds `Secure` to the session cookie; true whenever served over HTTPS. */
  cookieSecure: boolean;
  /** Auth/ticket endpoints: requests per second per IP, and burst. */
  httpRate: number;
  httpBurst: number;
  /** Original difficulty column for attributes and resists. */
  difficulty: 'easy' | 'medium' | 'hard';
  /**
   * Converted items.json replacing the built-in item catalog (ITEM_RULES). In development it
   * defaults to the user's own conversion output when present; otherwise built-in items only.
   */
  itemRulesPath: string | null;
  /**
   * Zone arena (ARENA): "synthetic-arena", or "level:<act>" for an original level converted from
   * the user's own installation (e.g. "level:ca1a"), read from `generatedDir`.
   */
  arena: string;
  /** Converter output directory (GENERATED_DIR, default local/generated). */
  generatedDir: string;
}

/** Repository root; relative paths (e.g. pglite:local/pgdata) resolve against it. */
/** 8080 is commonly taken on dev machines (e.g. the GhidraMCP plugin); containers override via SERVER_PORT. */
export const DEFAULT_PORT = 8090;

export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const envFile = path.join(REPO_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const DEV_ITEM_RULES = path.join(REPO_ROOT, 'local/generated/rules/items.json');

function resolveItemRules(env: ServerConfig['env']): string | null {
  const explicit = process.env['ITEM_RULES'];
  if (explicit) return path.resolve(REPO_ROOT, explicit);
  return env === 'development' && existsSync(DEV_ITEM_RULES) ? DEV_ITEM_RULES : null;
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const env = (process.env['NODE_ENV'] ?? 'development') as ServerConfig['env'];
  const port = Number(process.env['SERVER_PORT'] ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`invalid SERVER_PORT ${process.env['SERVER_PORT']}`);
  return {
    host: process.env['SERVER_HOST'] ?? '127.0.0.1',
    port,
    env,
    logLevel: process.env['LOG_LEVEL'] ?? (env === 'production' ? 'info' : 'debug'),
    wsTicketTtlSeconds: Number(process.env['WS_TICKET_TTL_SECONDS'] ?? 30),
    allowGuests: env !== 'production',
    databaseUrl: process.env['DATABASE_URL'] ?? (env === 'production' ? '' : 'pglite:local/pgdata'),
    sessionTtlHours: Number(process.env['SESSION_TTL_HOURS'] ?? 168),
    cookieSecure: (process.env['COOKIE_SECURE'] ?? (env === 'production' ? 'true' : 'false')) === 'true',
    difficulty: (['easy', 'medium', 'hard'].includes(process.env['DIFFICULTY'] ?? '') ? process.env['DIFFICULTY'] : 'medium') as ServerConfig['difficulty'],
    httpRate: 1,
    httpBurst: 10,
    itemRulesPath: resolveItemRules(env),
    arena: process.env['ARENA'] ?? 'synthetic-arena',
    generatedDir: path.resolve(REPO_ROOT, process.env['GENERATED_DIR'] ?? 'local/generated'),
    ...overrides,
  };
}
