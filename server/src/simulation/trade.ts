/**
 * Direct trade between two players of one zone (MMO Stage 4, not original;
 * docs/game-design/mmo/05 §2). Two-phase: both lock their offers, then both confirm; any change
 * to an offer unlocks both. The swap runs on copies of both bags and is applied only when every
 * item still is where it was offered and everything fits (all or nothing); the zone then saves
 * both characters in one batch (one transaction).
 */
import { addItem, MAX_STACK, type InventoryEntry, type ItemCatalog } from '@crusaders/shared';

export const TRADE_RANGE = 8;
export const TRADE_REQUEST_MS = 30_000;

export interface Trader {
  connId: number;
  name: string;
  inventory: InventoryEntry[];
  gold: number;
}

export interface TradeOffer {
  /** Offered items by identity (uid), with the quantity of a stack (the whole stack). */
  uids: string[];
  gold: number;
  locked: boolean;
  confirmed: boolean;
}

export interface Trade {
  a: number;
  b: number;
  offers: Map<number, TradeOffer>;
}

/** Why an item cannot change hands: equipped, a key or quest item, bound. */
export function untradable(e: InventoryEntry, catalog: ItemCatalog): string | null {
  const def = catalog.get(e.itemId);
  if (!def) return 'unknown item';
  if (e.equipped) return `${def.name} is worn: take it off first`;
  if (def.keyItem || def.questItem) return `${def.name} cannot be traded`;
  if (e.mods?.bound) return `${def.name} is bound to you`;
  return null;
}

const emptyOffer = (): TradeOffer => ({ uids: [], gold: 0, locked: false, confirmed: false });

export class TradeDesk {
  /** Pending requests: invitee conn -> requester conn and when. */
  private readonly requests = new Map<number, { from: number; at: number }>();
  /** Open trades by either side's conn. */
  private readonly open = new Map<number, Trade>();

  of(connId: number): Trade | undefined {
    return this.open.get(connId);
  }

  request(from: number, to: number, now: number): string | null {
    if (from === to) return 'You cannot trade with yourself.';
    if (this.open.has(from)) return 'You are already trading.';
    if (this.open.has(to)) return 'They are already trading.';
    this.requests.set(to, { from, at: now });
    return null;
  }

  /** The invitee accepts: the trade opens (null = no live request). */
  accept(to: number, now: number): Trade | null {
    const r = this.requests.get(to);
    this.requests.delete(to);
    if (!r || now - r.at > TRADE_REQUEST_MS || this.open.has(r.from) || this.open.has(to)) return null;
    const t: Trade = { a: r.from, b: to, offers: new Map([[r.from, emptyOffer()], [to, emptyOffer()]]) };
    this.open.set(r.from, t);
    this.open.set(to, t);
    return t;
  }

  declined(to: number): number | null {
    const r = this.requests.get(to);
    this.requests.delete(to);
    return r?.from ?? null;
  }

  /** A new offer from one side: every lock and confirmation drops. */
  offer(t: Trade, connId: number, uids: string[], gold: number): void {
    const o = t.offers.get(connId);
    if (!o) return;
    o.uids = [...new Set(uids)].slice(0, 16);
    o.gold = Math.max(0, Math.floor(gold));
    for (const x of t.offers.values()) {
      x.locked = false;
      x.confirmed = false;
    }
  }

  lock(t: Trade, connId: number): void {
    const o = t.offers.get(connId);
    if (o) o.locked = true;
  }

  /** True when both have now confirmed (both were locked). */
  confirm(t: Trade, connId: number): boolean {
    const o = t.offers.get(connId);
    if (!o || ![...t.offers.values()].every((x) => x.locked)) return false;
    o.confirmed = true;
    return [...t.offers.values()].every((x) => x.confirmed);
  }

  close(t: Trade): void {
    this.open.delete(t.a);
    this.open.delete(t.b);
  }

  /** Forgets a player (gone from the zone): his trade closes, his requests lapse. */
  forget(connId: number): Trade | undefined {
    const t = this.open.get(connId);
    if (t) this.close(t);
    this.requests.delete(connId);
    for (const [to, r] of this.requests) if (r.from === connId) this.requests.delete(to);
    return t;
  }
}

/**
 * The swap, all or nothing: an error, or both bags and purses as they become. Items move with
 * their identity and mods; stacks move whole.
 */
export function settleTrade(a: Trader, b: Trader, offerA: TradeOffer, offerB: TradeOffer, catalog: ItemCatalog): { error: string } | { a: { inventory: InventoryEntry[]; gold: number }; b: { inventory: InventoryEntry[]; gold: number } } {
  if (offerA.gold > a.gold) return { error: `${a.name} has not that much gold.` };
  if (offerB.gold > b.gold) return { error: `${b.name} has not that much gold.` };
  const invA = structuredClone(a.inventory);
  const invB = structuredClone(b.inventory);
  const take = (inv: InventoryEntry[], uids: string[], who: string): InventoryEntry[] | string => {
    const out: InventoryEntry[] = [];
    for (const uid of uids) {
      const i = inv.findIndex((e) => e.uid === uid);
      if (i < 0) return `${who} no longer has an offered item.`;
      const why = untradable(inv[i]!, catalog);
      if (why) return why;
      out.push(inv.splice(i, 1)[0]!);
    }
    return out;
  };
  const give = (inv: InventoryEntry[], items: InventoryEntry[], who: string): string | null => {
    for (const e of items) {
      let left = e.quantity ?? 1;
      const def = catalog.get(e.itemId);
      if (def?.stackable) {
        while (left > 0) {
          const n = Math.min(left, MAX_STACK);
          if (addItem(inv, e.itemId, n, catalog) === null) return `${who}'s bag is full.`;
          left -= n;
        }
        continue;
      }
      const slot = addItem(inv, e.itemId, 1, catalog);
      if (slot === null) return `${who}'s bag is full.`;
      const added = inv.find((x) => x.slot === slot)!;
      if (e.uid) added.uid = e.uid;
      if (e.mods) added.mods = e.mods;
    }
    return null;
  };
  const fromA = take(invA, offerA.uids, a.name);
  if (typeof fromA === 'string') return { error: fromA };
  const fromB = take(invB, offerB.uids, b.name);
  if (typeof fromB === 'string') return { error: fromB };
  const errA = give(invA, fromB, a.name);
  if (errA) return { error: errA };
  const errB = give(invB, fromA, b.name);
  if (errB) return { error: errB };
  return {
    a: { inventory: invA, gold: a.gold - offerA.gold + offerB.gold },
    b: { inventory: invB, gold: b.gold - offerB.gold + offerA.gold },
  };
}
