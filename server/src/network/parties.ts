/**
 * Parties (MMO Stage 2, not original; docs/game-design/mmo/02 §6, 09): up to PARTY_MAX
 * characters, one leader, invitations that lapse after INVITE_MS. Held in memory by the main
 * thread (a party ends with the server; nothing is saved). Characters are known by name,
 * compared case-insensitively; the caller maps names to sessions.
 */
export const PARTY_MAX = 5;
export const INVITE_MS = 60_000;

export interface Party {
  id: string;
  /** Members' names as they were given, the leader first. */
  members: string[];
}

export type PartyResult = { ok: true; party?: Party; message?: string } | { ok: false; error: string };

const key = (name: string) => name.toLowerCase();

export class Parties {
  private readonly byName = new Map<string, Party>();
  /** Invitee -> who invited them and when. */
  private readonly invites = new Map<string, { from: string; at: number }>();
  private nextId = 1;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  of(name: string): Party | null {
    return this.byName.get(key(name)) ?? null;
  }

  leader(party: Party): string {
    return party.members[0]!;
  }

  /** `from` invites `to` (both online: the caller checks). */
  invite(from: string, to: string): PartyResult {
    if (key(from) === key(to)) return { ok: false, error: 'You cannot invite yourself.' };
    const mine = this.of(from);
    if (mine && key(this.leader(mine)) !== key(from)) return { ok: false, error: 'Only the party leader can invite.' };
    if (mine && mine.members.length >= PARTY_MAX) return { ok: false, error: `The party is full (${PARTY_MAX}).` };
    if (this.of(to)) return { ok: false, error: `${to} is already in a party.` };
    this.invites.set(key(to), { from, at: this.now() });
    return { ok: true, message: `You invite ${to} to your party.` };
  }

  /** The pending invitation of `name`, or null (lapsed ones are dropped). */
  pendingFor(name: string): string | null {
    const inv = this.invites.get(key(name));
    if (!inv) return null;
    if (this.now() - inv.at > INVITE_MS) {
      this.invites.delete(key(name));
      return null;
    }
    return inv.from;
  }

  accept(name: string): PartyResult {
    const from = this.pendingFor(name);
    this.invites.delete(key(name));
    if (!from) return { ok: false, error: 'You have no party invitation.' };
    if (this.of(name)) return { ok: false, error: 'You are already in a party.' };
    let party = this.of(from);
    if (party && key(this.leader(party)) !== key(from)) return { ok: false, error: `${from} no longer leads a party.` };
    if (!party) {
      party = { id: `p${this.nextId++}`, members: [from] };
      this.byName.set(key(from), party);
    }
    if (party.members.length >= PARTY_MAX) return { ok: false, error: 'That party is full.' };
    party.members.push(name);
    this.byName.set(key(name), party);
    return { ok: true, party };
  }

  decline(name: string): PartyResult {
    const from = this.pendingFor(name);
    this.invites.delete(key(name));
    return from ? { ok: true, message: `You decline ${from}'s invitation.` } : { ok: false, error: 'You have no party invitation.' };
  }

  /** `name` leaves (or is gone): the party passes to the next member; one left alone disbands it. */
  leave(name: string): PartyResult {
    const party = this.of(name);
    if (!party) return { ok: false, error: 'You are not in a party.' };
    party.members = party.members.filter((m) => key(m) !== key(name));
    this.byName.delete(key(name));
    if (party.members.length <= 1) {
      for (const m of party.members) this.byName.delete(key(m));
      party.members = [];
    }
    return { ok: true, party };
  }

  kick(leader: string, name: string): PartyResult {
    const party = this.of(leader);
    if (!party || key(this.leader(party)) !== key(leader)) return { ok: false, error: 'Only the party leader can remove members.' };
    if (!party.members.some((m) => key(m) === key(name)) || key(name) === key(leader)) return { ok: false, error: `${name} is not in your party.` };
    return this.leave(party.members.find((m) => key(m) === key(name))!);
  }

  promote(leader: string, name: string): PartyResult {
    const party = this.of(leader);
    if (!party || key(this.leader(party)) !== key(leader)) return { ok: false, error: 'Only the party leader can do that.' };
    const i = party.members.findIndex((m) => key(m) === key(name));
    if (i <= 0) return { ok: false, error: `${name} is not in your party.` };
    const [m] = party.members.splice(i, 1);
    party.members.unshift(m!);
    return { ok: true, party };
  }
}
