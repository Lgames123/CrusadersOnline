import { randomBytes, randomUUID } from 'node:crypto';
import type { CharacterSummary } from '@crusaders/shared';

/** Identity bound to a WebSocket ticket. */
export interface Account {
  id: string;
  name: string;
  characters: CharacterSummary[];
  /** Ephemeral development guest: nothing is persisted. */
  guest: boolean;
  /** Admin panel access (accounts.is_admin). */
  admin?: boolean;
  /** Chat muted until (ms since epoch), when it was at ticket time. */
  mutedUntil?: number | null;
}

interface PendingTicket {
  account: Account;
  expiresAt: number;
}

/**
 * Single-use, short-lived WebSocket tickets (ADR-008). Issued over HTTP, redeemed by the
 * first WebSocket message. Tickets are opaque random strings, never placed in URLs.
 */
export class TicketStore {
  private readonly tickets = new Map<string, PendingTicket>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlSeconds = 30, now: () => number = Date.now) {
    this.ttlMs = ttlSeconds * 1000;
    this.now = now;
  }

  issue(account: Account): string {
    this.prune();
    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(ticket, { account, expiresAt: this.now() + this.ttlMs });
    return ticket;
  }

  /** Returns the account and invalidates the ticket; null if unknown, used or expired. */
  redeem(ticket: string): Account | null {
    const t = this.tickets.get(ticket);
    if (!t) return null;
    this.tickets.delete(ticket);
    return t.expiresAt >= this.now() ? t.account : null;
  }

  private prune(): void {
    const now = this.now();
    for (const [k, v] of this.tickets) if (v.expiresAt < now) this.tickets.delete(k);
  }
}

let guestCounter = 0;

/** Ephemeral guest account for development until persistent accounts land (M07). */
export function createGuestAccount(): Account {
  const name = `Guest${String(++guestCounter).padStart(3, '0')}`;
  return { id: randomUUID(), name, characters: [{ id: randomUUID(), name }], guest: true };
}
