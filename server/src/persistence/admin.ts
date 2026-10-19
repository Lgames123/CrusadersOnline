import type { Kysely } from 'kysely';
import type { AdminEvent, WorldRates } from '@crusaders/shared';
import type { DB } from './schema.ts';

export interface AdminActionRow {
  id: number;
  at: number;
  admin: string;
  action: string;
  target: string | null;
  detail: string | null;
}

export interface AccountMatch {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: number;
  bannedUntil: number | null;
  banReason: string | null;
  mutedUntil: number | null;
  characters: { id: string; name: string; level: number; zone: string }[];
}

const ms = (d: Date | string | null) => (d === null ? null : new Date(d).getTime());

/** Moderation, rate events and the audit log (006_admin.sql). */
export class AdminRepository {
  private readonly db: Kysely<DB>;

  constructor(db: Kysely<DB>) {
    this.db = db;
  }

  /** The account a username or one of its characters' names (any case) names. */
  async findAccount(name: string): Promise<AccountMatch | null> {
    const lower = name.toLowerCase();
    const byUser = await this.db.selectFrom('accounts').select('id').where((eb) => eb(eb.fn('lower', ['username']), '=', lower)).executeTakeFirst();
    const id = byUser?.id ?? (await this.db.selectFrom('characters').select('account_id').where((eb) => eb(eb.fn('lower', ['name']), '=', lower)).executeTakeFirst())?.account_id;
    if (!id) return null;
    return (await this.accounts([id]))[0] ?? null;
  }

  /** Accounts whose username or a character's name contains `q` (newest first). */
  async searchAccounts(q: string, limit = 50): Promise<AccountMatch[]> {
    const like = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const users = await this.db.selectFrom('accounts').select('id').where((eb) => eb(eb.fn('lower', ['username']), 'like', like)).orderBy('created_at', 'desc').limit(limit).execute();
    const chars = await this.db.selectFrom('characters').select('account_id').where((eb) => eb(eb.fn('lower', ['name']), 'like', like)).limit(limit).execute();
    const ids = [...new Set([...users.map((u) => u.id), ...chars.map((c) => c.account_id)])].slice(0, limit);
    return this.accounts(ids);
  }

  private async accounts(ids: string[]): Promise<AccountMatch[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.selectFrom('accounts').selectAll().where('id', 'in', ids).orderBy('created_at', 'desc').execute();
    const chars = await this.db.selectFrom('characters').select(['id', 'name', 'level', 'zone_id', 'account_id']).where('account_id', 'in', ids).orderBy('created_at').execute();
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      isAdmin: r.is_admin,
      createdAt: ms(r.created_at)!,
      bannedUntil: ms(r.banned_until),
      banReason: r.ban_reason,
      mutedUntil: ms(r.muted_until),
      characters: chars.filter((c) => c.account_id === r.id).map((c) => ({ id: c.id, name: c.name, level: c.level, zone: c.zone_id })),
    }));
  }

  async setBan(accountId: string, until: number | null, reason: string | null): Promise<void> {
    await this.db.updateTable('accounts').set({ banned_until: until === null ? null : new Date(until), ban_reason: until === null ? null : reason, updated_at: new Date() }).where('id', '=', accountId).execute();
    // A ban ends every web session too (the login page is refused until it runs out).
    if (until !== null) await this.db.updateTable('sessions').set({ revoked_at: new Date() }).where('account_id', '=', accountId).where('revoked_at', 'is', null).execute();
  }

  async setMute(accountId: string, until: number | null): Promise<void> {
    await this.db.updateTable('accounts').set({ muted_until: until === null ? null : new Date(until), updated_at: new Date() }).where('id', '=', accountId).execute();
  }

  async log(admin: string, action: string, target: string | null, detail: string | null): Promise<void> {
    await this.db.insertInto('admin_actions').values({ admin, action, target, detail }).execute();
  }

  async actions(limit = 200): Promise<AdminActionRow[]> {
    const rows = await this.db.selectFrom('admin_actions').selectAll().orderBy('id', 'desc').limit(limit).execute();
    return rows.map((r) => ({ id: Number(r.id), at: ms(r.at)!, admin: r.admin, action: r.action, target: r.target, detail: r.detail }));
  }

  async createEvent(e: Omit<AdminEvent, 'id' | 'state'>): Promise<string> {
    const row = await this.db
      .insertInto('admin_events')
      .values({ name: e.name, rates: JSON.stringify(e.rates), starts_at: new Date(e.startsAt), ends_at: new Date(e.endsAt), announce: e.announce, created_by: e.createdBy })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** Ends an event now (cancelled before or while it runs). */
  async cancelEvent(id: string): Promise<void> {
    await this.db.updateTable('admin_events').set({ cancelled_at: new Date() }).where('id', '=', id).where('cancelled_at', 'is', null).execute();
  }

  /** Events not over by `since` (scheduled and running), plus the last `recent` finished ones. */
  async events(since: number, recent = 20): Promise<AdminEvent[]> {
    const live = await this.db.selectFrom('admin_events').selectAll().where('cancelled_at', 'is', null).where('ends_at', '>', new Date(since)).orderBy('starts_at').execute();
    const past = await this.db
      .selectFrom('admin_events')
      .selectAll()
      .where((eb) => eb.or([eb('cancelled_at', 'is not', null), eb('ends_at', '<=', new Date(since))]))
      .orderBy('ends_at', 'desc')
      .limit(recent)
      .execute();
    return [...live, ...past].map((r) => {
      const startsAt = ms(r.starts_at)!;
      const endsAt = ms(r.ends_at)!;
      const state: AdminEvent['state'] = r.cancelled_at ? 'cancelled' : endsAt <= since ? 'ended' : startsAt <= since ? 'active' : 'scheduled';
      return { id: r.id, name: r.name, rates: JSON.parse(r.rates) as WorldRates, startsAt, endsAt, announce: r.announce, createdBy: r.created_by, state };
    });
  }
}
