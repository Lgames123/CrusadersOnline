import type { Logger } from 'pino';
import { CS, SC, parseClientControl, type ServerControlMsg } from '@crusaders/shared';
import type { Account, TicketStore } from '../auth/tickets.ts';
import type { CharacterRepository } from '../persistence/characters.ts';
import type { ZoneHost } from '../zone/zone_host.ts';
import { TokenBucket } from './rate_limit.ts';
import { CLOSE, type ClientConnection, type TransportHandlers } from './transport.ts';

const AUTH_TIMEOUT_MS = 10_000;

type State = 'awaiting_auth' | 'authenticated' | 'joining' | 'in_world';

interface Session {
  conn: ClientConnection;
  state: State;
  account: Account | null;
  characterId: string | null;
  inputBucket: TokenBucket;
  controlBucket: TokenBucket;
  authTimer: NodeJS.Timeout;
}

/**
 * Connection state machine on the main thread:
 * awaiting_auth --CS_AUTH_TICKET--> authenticated --CS_SELECT_CHARACTER--> in_world.
 * Binary input is only accepted in_world and is forwarded untouched to the zone worker.
 */
export class SessionManager implements TransportHandlers {
  private readonly sessions = new Map<number, Session>();
  private readonly tickets: TicketStore;
  private readonly zone: ZoneHost;
  private readonly log: Logger;
  private readonly characters: CharacterRepository;
  /** Characters currently in (or joining) the world; one connection per character. */
  private readonly activeCharacters = new Set<string>();

  constructor(tickets: TicketStore, zone: ZoneHost, characters: CharacterRepository, log: Logger) {
    this.tickets = tickets;
    this.zone = zone;
    this.characters = characters;
    this.log = log;
  }

  /** Called by the zone host for every outbound frame. */
  deliver(connId: number, data: Uint8Array | string): void {
    this.sessions.get(connId)?.conn.send(data);
  }

  get playerCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.state === 'in_world') n++;
    return n;
  }

  open(conn: ClientConnection): void {
    const session: Session = {
      conn,
      state: 'awaiting_auth',
      account: null,
      characterId: null,
      inputBucket: new TokenBucket(25, 30), // 20 Hz nominal (security.md §2.3)
      controlBucket: new TokenBucket(5, 10),
      authTimer: setTimeout(() => conn.close(CLOSE.AUTH_TIMEOUT, 'authentication timeout'), AUTH_TIMEOUT_MS),
    };
    this.sessions.set(conn.id, session);
  }

  close(conn: ClientConnection): void {
    const s = this.sessions.get(conn.id);
    if (!s) return;
    clearTimeout(s.authTimer);
    if (s.state === 'in_world') this.zone.leave(conn.id);
    if (s.characterId) this.activeCharacters.delete(s.characterId);
    this.sessions.delete(conn.id);
    this.log.info({ conn: conn.id, account: s.account?.name }, 'disconnected');
  }

  message(conn: ClientConnection, data: Uint8Array | string): void {
    const s = this.sessions.get(conn.id);
    if (!s) return;

    if (typeof data !== 'string') {
      if (s.state !== 'in_world' || data[0] !== CS.PLAYER_INPUT) return this.reject(s, 'unexpected binary frame');
      if (!s.inputBucket.take()) return this.reject(s, 'input rate exceeded');
      // Copy into a standalone ArrayBuffer so it can be transferred to the worker.
      this.zone.input(conn.id, data.slice().buffer as ArrayBuffer);
      return;
    }

    if (!s.controlBucket.take()) return this.reject(s, 'control rate exceeded');
    const msg = parseClientControl(data);
    if (!msg) return this.reject(s, 'malformed control message');

    switch (msg.op) {
      case CS.AUTH_TICKET: {
        if (s.state !== 'awaiting_auth') return this.reject(s, 'already authenticated');
        const account = this.tickets.redeem(msg.d.ticket);
        if (!account) {
          conn.close(CLOSE.AUTH_FAILED, 'invalid ticket');
          return;
        }
        clearTimeout(s.authTimer);
        s.account = account;
        s.state = 'authenticated';
        this.send(s, { op: SC.AUTH_SUCCESS, d: { accountName: account.name, characters: account.characters } });
        this.log.info({ conn: conn.id, account: account.name }, 'authenticated');
        return;
      }
      case CS.SELECT_CHARACTER: {
        if (s.state !== 'authenticated' || !s.account) return this.reject(s, 'not authenticated');
        const summary = s.account.characters.find((c) => c.id === msg.d.characterId);
        if (!summary) return this.reject(s, 'character not owned by account');
        if (this.activeCharacters.has(summary.id)) {
          this.send(s, { op: SC.ERROR, d: { code: 'character_in_use', message: 'character is already in the world' } });
          conn.close(CLOSE.POLICY, 'character already in world');
          return;
        }
        s.state = 'joining';
        s.characterId = summary.id;
        this.activeCharacters.add(summary.id);
        void this.enterWorld(s, s.account, summary.id, summary.name);
        return;
      }
      case CS.INTERACT:
        if (s.state === 'in_world') this.zone.interact(conn.id, msg.d.object);
        return;
      case CS.USE_ITEM:
        if (s.state === 'in_world') this.zone.useItem(conn.id, msg.d.slot);
        return;
      case CS.EQUIP_ITEM:
        if (s.state === 'in_world') this.zone.equip(conn.id, msg.d.slot, msg.d.equip);
        return;
      case CS.PLAYER_ATTACK:
        if (s.state === 'in_world') this.zone.attack(conn.id);
        return;
      case CS.PING:
        this.send(s, { op: SC.PONG, d: { clientTime: msg.d.clientTime, serverTick: this.zone.tick } });
        return;
      default:
        // Combat and chat arrive with M09; accepted but ignored for now.
        return;
    }
  }

  private async enterWorld(s: Session, account: Account, characterId: string, name: string): Promise<void> {
    try {
      if (account.guest) {
        this.zone.join(s.conn.id, { name, characterId: null });
      } else {
        const saved = await this.characters.loadOwned(account.id, characterId);
        if (!saved) return this.reject(s, 'character not found');
        if (!this.sessions.has(s.conn.id)) return; // disconnected while loading
        this.zone.join(s.conn.id, {
          name: saved.name,
          characterId: saved.id,
          position: saved.position,
          yaw: saved.yaw,
          experience: saved.experience,
          gold: saved.gold,
          hp: saved.hp,
          inventory: saved.inventory,
        });
      }
      s.state = 'in_world';
      this.log.info({ conn: s.conn.id, character: name, zone: this.zone.zone, guest: account.guest }, 'entered world');
    } catch (err) {
      this.log.error({ err, conn: s.conn.id }, 'failed to enter world');
      s.conn.close(1011, 'internal error');
    }
  }

  private send(s: Session, msg: ServerControlMsg): void {
    s.conn.send(JSON.stringify(msg));
  }

  private reject(s: Session, reason: string): void {
    this.log.warn({ conn: s.conn.id, reason }, 'closing connection');
    s.conn.close(CLOSE.POLICY, reason);
  }
}
