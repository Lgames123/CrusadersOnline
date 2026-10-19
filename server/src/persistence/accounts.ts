import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { Kysely } from 'kysely';
import { LEVEL_PREFIX, NEW_GAME_ACT, type CharacterSummary } from '@crusaders/shared';
import type { DB } from './schema.ts';

/** OWASP minimum for argon2id (ADR-008). */
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 } as const;

export class UsernameTakenError extends Error {}

export interface AccountRecord {
  id: string;
  username: string;
  isAdmin: boolean;
  /** Moderation, ms since epoch (null: none); a past date has run out. */
  bannedUntil: number | null;
  banReason: string | null;
  mutedUntil: number | null;
}

type AccountRow = { id: string; username: string; is_admin: boolean; banned_until: Date | null; ban_reason: string | null; muted_until: Date | null };
const ACCOUNT_COLUMNS = ['accounts.id', 'accounts.username', 'accounts.is_admin', 'accounts.banned_until', 'accounts.ban_reason', 'accounts.muted_until'] as const;

const toRecord = (r: AccountRow): AccountRecord => ({
  id: r.id,
  username: r.username,
  isAdmin: r.is_admin,
  bannedUntil: r.banned_until ? new Date(r.banned_until).getTime() : null,
  banReason: r.ban_reason,
  mutedUntil: r.muted_until ? new Date(r.muted_until).getTime() : null,
});

const hashToken = (token: string) => createHash('sha256').update(token).digest();

/** Accounts, password verification and server-side sessions. */
export class AccountRepository {
  private readonly db: Kysely<DB>;
  /** Hash verified when a username does not exist, so timing does not reveal valid usernames. */
  private dummyHash: Promise<string> | null = null;

  constructor(db: Kysely<DB>) {
    this.db = db;
  }

  /** Creates the account and its first character (named after the account). */
  async register(username: string, password: string): Promise<AccountRecord> {
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    try {
      return await this.db.transaction().execute(async (trx) => {
        const acc = await trx
          .insertInto('accounts')
          .values({ username, password_hash: passwordHash })
          .returning(['id', 'username', 'is_admin'])
          .executeTakeFirstOrThrow();
        // A new game: the first act's start point (no saved position); the server's default
        // arena instead when that act is not converted.
        await trx.insertInto('characters').values({ account_id: acc.id, name: username, zone_id: `${LEVEL_PREFIX}${NEW_GAME_ACT}` }).execute();
        return { id: acc.id, username: acc.username, isAdmin: acc.is_admin, bannedUntil: null, banReason: null, mutedUntil: null };
      });
    } catch (err) {
      if (/unique|duplicate/i.test((err as Error).message)) throw new UsernameTakenError('username already taken');
      throw err;
    }
  }

  async verifyLogin(username: string, password: string): Promise<AccountRecord | null> {
    const row = await this.db
      .selectFrom('accounts')
      .select([...ACCOUNT_COLUMNS, 'accounts.password_hash'])
      .where((eb) => eb(eb.fn('lower', ['username']), '=', username.toLowerCase()))
      .executeTakeFirst();
    if (!row) {
      this.dummyHash ??= argon2.hash(randomBytes(16).toString('hex'), ARGON2_OPTIONS);
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      return null;
    }
    const ok = await argon2.verify(row.password_hash, password).catch(() => false);
    return ok ? toRecord(row) : null;
  }

  /** Returns the opaque session token; only its SHA-256 is stored. */
  async createSession(accountId: string, ttlHours: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db
      .insertInto('sessions')
      .values({ id: hashToken(token), account_id: accountId, expires_at: new Date(Date.now() + ttlHours * 3600_000) })
      .execute();
    return token;
  }

  async resolveSession(token: string): Promise<AccountRecord | null> {
    const row = await this.db
      .selectFrom('sessions')
      .innerJoin('accounts', 'accounts.id', 'sessions.account_id')
      .select([...ACCOUNT_COLUMNS])
      .where('sessions.id', '=', hashToken(token))
      .where('sessions.revoked_at', 'is', null)
      .where('sessions.expires_at', '>', new Date())
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  /** Grants or takes away the admin panel (ADMIN_USERS, scripts/admin.ts). False: no such account. */
  async setAdmin(username: string, admin: boolean): Promise<boolean> {
    const r = await this.db
      .updateTable('accounts')
      .set({ is_admin: admin, updated_at: new Date() })
      .where((eb) => eb(eb.fn('lower', ['username']), '=', username.toLowerCase()))
      .executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  }

  async revokeSession(token: string): Promise<void> {
    await this.db.updateTable('sessions').set({ revoked_at: new Date() }).where('id', '=', hashToken(token)).execute();
  }

  async listCharacters(accountId: string): Promise<CharacterSummary[]> {
    return this.db.selectFrom('characters').select(['id', 'name']).where('account_id', '=', accountId).orderBy('created_at').execute();
  }
}
