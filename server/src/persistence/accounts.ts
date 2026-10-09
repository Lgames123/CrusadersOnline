import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { Kysely } from 'kysely';
import type { CharacterSummary } from '@crusaders/shared';
import type { DB } from './schema.ts';

/** OWASP minimum for argon2id (ADR-008). */
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 } as const;

export class UsernameTakenError extends Error {}

export interface AccountRecord {
  id: string;
  username: string;
  isAdmin: boolean;
}

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
        await trx.insertInto('characters').values({ account_id: acc.id, name: username }).execute();
        return { id: acc.id, username: acc.username, isAdmin: acc.is_admin };
      });
    } catch (err) {
      if (/unique|duplicate/i.test((err as Error).message)) throw new UsernameTakenError('username already taken');
      throw err;
    }
  }

  async verifyLogin(username: string, password: string): Promise<AccountRecord | null> {
    const row = await this.db
      .selectFrom('accounts')
      .select(['id', 'username', 'is_admin', 'password_hash'])
      .where((eb) => eb(eb.fn('lower', ['username']), '=', username.toLowerCase()))
      .executeTakeFirst();
    if (!row) {
      this.dummyHash ??= argon2.hash(randomBytes(16).toString('hex'), ARGON2_OPTIONS);
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      return null;
    }
    const ok = await argon2.verify(row.password_hash, password).catch(() => false);
    return ok ? { id: row.id, username: row.username, isAdmin: row.is_admin } : null;
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
      .select(['accounts.id', 'accounts.username', 'accounts.is_admin'])
      .where('sessions.id', '=', hashToken(token))
      .where('sessions.revoked_at', 'is', null)
      .where('sessions.expires_at', '>', new Date())
      .executeTakeFirst();
    return row ? { id: row.id, username: row.username, isAdmin: row.is_admin } : null;
  }

  async revokeSession(token: string): Promise<void> {
    await this.db.updateTable('sessions').set({ revoked_at: new Date() }).where('id', '=', hashToken(token)).execute();
  }

  async listCharacters(accountId: string): Promise<CharacterSummary[]> {
    return this.db.selectFrom('characters').select(['id', 'name']).where('account_id', '=', accountId).orderBy('created_at').execute();
  }
}
