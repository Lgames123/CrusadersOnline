import type { Kysely, Transaction } from 'kysely';
import { sanitizeMods, ITEM_UID, type ItemMods } from '@crusaders/shared';
import type { DB } from './schema.ts';

/**
 * The auction house and the mailbox (MMO Stage 4, docs/game-design/mmo/05 §3), buyout only.
 * Listed items stay in their listing row (escrow) until sold, cancelled or expired; whatever a
 * character is owed (bought items, sale proceeds, returned items) waits in his mailbox until he
 * claims it at a merchant. Every money-moving step runs in one transaction with the listing row
 * locked (`FOR UPDATE`), and leaves a line in economy_audit.
 */
export const AUCTION = {
  /** Non-refundable deposit: 5 % of the price × the duration's multiplier. */
  depositRate: 0.05,
  durations: { 12: 1, 24: 1.5, 48: 2 } as Record<number, number>,
  /** Taken from the price before the seller is paid. */
  saleTax: 0.1,
  maxActivePerSeller: 15,
  pageSize: 50,
} as const;

export function auctionDeposit(price: number, hours: number): number {
  return Math.max(1, Math.floor(price * AUCTION.depositRate * (AUCTION.durations[hours] ?? 1)));
}

export interface EscrowItem {
  itemId: string;
  uid?: string;
  quantity: number;
  mods?: ItemMods;
}

export interface ListingView {
  id: string;
  seller: string;
  itemId: string;
  quantity: number;
  mods?: ItemMods;
  price: number;
  expiresAt: string;
  mine?: boolean;
}

export interface MailView {
  id: string;
  sender: string;
  subject: string;
  gold: number;
  item?: EscrowItem;
}

const num = (v: string | number) => Number(v);
const parseMods = (v: unknown) => sanitizeMods(typeof v === 'string' ? safe(v) : v);
function safe(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export class EconomyRepository {
  private readonly db: Kysely<DB>;

  constructor(db: Kysely<DB>) {
    this.db = db;
  }

  /** Puts an escrowed item up for sale; false (nothing written) when the seller has too many. */
  async list(seller: { id: string; name: string }, item: EscrowItem, price: number, hours: number): Promise<{ id: string } | 'limit'> {
    return this.db.transaction().execute(async (trx) => {
      const active = await trx.selectFrom('auction_listings').select((eb) => eb.fn.countAll<string>().as('n')).where('seller_character_id', '=', seller.id).where('status', '=', 'open').executeTakeFirst();
      if (Number(active?.n ?? 0) >= AUCTION.maxActivePerSeller) return 'limit' as const;
      const row = await trx
        .insertInto('auction_listings')
        .values({
          seller_character_id: seller.id,
          seller_name: seller.name,
          item_id: item.itemId,
          item_uid: item.uid && ITEM_UID.test(item.uid) ? item.uid : null,
          quantity: item.quantity,
          mods: item.mods ? JSON.stringify(item.mods) : null,
          price,
          deposit: auctionDeposit(price, hours),
          expires_at: new Date(Date.now() + hours * 3_600_000),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit(trx, 'auction_list', seller.id, null, auctionDeposit(price, hours), item, { price, hours, listing: row.id });
      return { id: row.id };
    });
  }

  /** Open listings, newest first, optionally of one catalogue id. */
  async search(itemIds: string[] | null, viewer: string | null, page = 0): Promise<ListingView[]> {
    let q = this.db.selectFrom('auction_listings').selectAll().where('status', '=', 'open').where('expires_at', '>', new Date());
    if (itemIds) q = q.where('item_id', 'in', itemIds.length ? itemIds : ['']);
    const rows = await q.orderBy('created_at', 'desc').limit(AUCTION.pageSize).offset(page * AUCTION.pageSize).execute();
    return rows.map((r) => {
      const mods = parseMods(r.mods);
      return { id: r.id, seller: r.seller_name, itemId: r.item_id, quantity: r.quantity, ...(mods ? { mods } : {}), price: num(r.price), expiresAt: new Date(r.expires_at).toISOString(), ...(viewer && r.seller_character_id === viewer ? { mine: true } : {}) };
    });
  }

  /** The open listing's price (no lock: the buy re-checks). */
  async price(listingId: string): Promise<{ price: number; seller: string } | null> {
    const r = await this.db.selectFrom('auction_listings').select(['price', 'seller_character_id']).where('id', '=', listingId).where('status', '=', 'open').where('expires_at', '>', new Date()).executeTakeFirst();
    return r ? { price: num(r.price), seller: r.seller_character_id } : null;
  }

  /**
   * The buyer (who already paid `paid` gold, taken by his zone) takes the listing: the item goes
   * to his mailbox, the price less the tax to the seller's. 'gone' when it was sold, cancelled or
   * expired meanwhile: the caller gives the gold back.
   */
  async buy(listingId: string, buyer: { id: string; name: string }, paid: number): Promise<'ok' | 'gone'> {
    return this.db.transaction().execute(async (trx) => {
      const l = await trx.selectFrom('auction_listings').selectAll().where('id', '=', listingId).forUpdate().executeTakeFirst();
      if (!l || l.status !== 'open' || new Date(l.expires_at).getTime() <= Date.now() || num(l.price) !== paid || l.seller_character_id === buyer.id) return 'gone' as const;
      await trx.updateTable('auction_listings').set({ status: 'sold', buyer_character_id: buyer.id }).where('id', '=', listingId).execute();
      const item = this.rowItem(l);
      await this.mail(trx, buyer.id, `Bought: ${l.item_id}`, 0, item);
      const proceeds = Math.floor(num(l.price) * (1 - AUCTION.saleTax));
      await this.mail(trx, l.seller_character_id, `Sold to ${buyer.name}`, proceeds, null);
      await this.audit(trx, 'auction_buy', buyer.id, l.seller_character_id, num(l.price), item, { listing: listingId, proceeds });
      return 'ok' as const;
    });
  }

  /** The seller takes his listing back (to his mailbox); the deposit is not returned. */
  async cancel(listingId: string, sellerId: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const l = await trx.selectFrom('auction_listings').selectAll().where('id', '=', listingId).forUpdate().executeTakeFirst();
      if (!l || l.status !== 'open' || l.seller_character_id !== sellerId) return false;
      await trx.updateTable('auction_listings').set({ status: 'cancelled' }).where('id', '=', listingId).execute();
      await this.mail(trx, sellerId, 'Auction cancelled', 0, this.rowItem(l));
      await this.audit(trx, 'auction_cancel', sellerId, null, 0, this.rowItem(l), { listing: listingId });
      return true;
    });
  }

  /** Listings past their time go back to their sellers' mailboxes; returns how many. */
  async expireDue(now = new Date()): Promise<number> {
    const due = await this.db.selectFrom('auction_listings').select('id').where('status', '=', 'open').where('expires_at', '<=', now).limit(200).execute();
    let n = 0;
    for (const { id } of due) {
      const done = await this.db.transaction().execute(async (trx) => {
        const l = await trx.selectFrom('auction_listings').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
        if (!l || l.status !== 'open') return false;
        await trx.updateTable('auction_listings').set({ status: 'expired' }).where('id', '=', id).execute();
        await this.mail(trx, l.seller_character_id, 'Auction expired', 0, this.rowItem(l));
        await this.audit(trx, 'auction_expire', l.seller_character_id, null, 0, this.rowItem(l), { listing: id });
        return true;
      });
      if (done) n++;
    }
    return n;
  }

  async mailFor(characterId: string): Promise<MailView[]> {
    const rows = await this.db.selectFrom('mailbox').selectAll().where('character_id', '=', characterId).orderBy('created_at').execute();
    return rows.map((r) => ({ id: r.id, sender: r.sender, subject: r.subject, gold: num(r.gold), ...(r.item_id ? { item: this.rowItem(r) } : {}) }));
  }

  /** Takes all of a character's mail out of the mailbox (the caller delivers it or puts back what does not fit). */
  async claimAll(characterId: string): Promise<MailView[]> {
    return this.db.transaction().execute(async (trx) => {
      const rows = await trx.deleteFrom('mailbox').where('character_id', '=', characterId).returningAll().execute();
      const out = rows.map((r) => ({ id: r.id, sender: r.sender, subject: r.subject, gold: num(r.gold), ...(r.item_id ? { item: this.rowItem(r) } : {}) }));
      if (out.length) await this.audit(trx, 'mail_claim', characterId, null, out.reduce((g, m) => g + m.gold, 0), null, { count: out.length });
      return out;
    });
  }

  /** Puts something (back) in a character's mailbox. */
  async send(characterId: string, subject: string, gold: number, item: EscrowItem | null): Promise<void> {
    await this.db.transaction().execute((trx) => this.mail(trx, characterId, subject, gold, item));
  }

  private rowItem(r: { item_id: string | null; item_uid: string | null; quantity: number; mods: unknown }): EscrowItem {
    const mods = parseMods(r.mods);
    return { itemId: r.item_id!, quantity: r.quantity, ...(r.item_uid ? { uid: r.item_uid } : {}), ...(mods ? { mods } : {}) };
  }

  private async mail(trx: Transaction<DB>, characterId: string, subject: string, gold: number, item: EscrowItem | null): Promise<void> {
    await trx
      .insertInto('mailbox')
      .values({
        character_id: characterId,
        subject: subject.slice(0, 80),
        gold,
        item_id: item?.itemId ?? null,
        item_uid: item?.uid && ITEM_UID.test(item.uid) ? item.uid : null,
        quantity: item?.quantity ?? 1,
        mods: item?.mods ? JSON.stringify(item.mods) : null,
      })
      .execute();
  }

  private async audit(trx: Transaction<DB>, kind: string, characterId: string | null, other: string | null, gold: number, item: EscrowItem | null, detail: object): Promise<void> {
    await trx
      .insertInto('economy_audit')
      .values({ kind, character_id: characterId, other_character_id: other, gold, item_id: item?.itemId ?? null, item_uid: item?.uid && ITEM_UID.test(item.uid) ? item.uid : null, detail: JSON.stringify(detail) })
      .execute();
  }
}
