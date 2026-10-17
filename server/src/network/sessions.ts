import type { Logger } from 'pino';
import { CS, LEVEL_PREFIX, SC, parseClientControl, type ExitCrossing, type ServerControlMsg } from '@crusaders/shared';
import type { Account, TicketStore } from '../auth/tickets.ts';
import type { CharacterPersistRecord, CharacterRepository } from '../persistence/characters.ts';
import type { JoinOptions, PersistRecord, TransferState } from '../simulation/world_zone.ts';
import type { ZoneHost } from '../zone/zone_host.ts';
import type { ZoneManager } from '../zone/zone_manager.ts';
import { TokenBucket } from './rate_limit.ts';
import { CLOSE, type ClientConnection, type TransportHandlers } from './transport.ts';

const AUTH_TIMEOUT_MS = 10_000;

/**
 * zoning: the client was told SC_ZONE_CHANGE and loads the arena (pending join until
 * CS_ZONE_READY); transferring: the old zone is removing the player for a portal transition.
 */
type State = 'awaiting_auth' | 'authenticated' | 'joining' | 'zoning' | 'in_world' | 'transferring';

interface Session {
  conn: ClientConnection;
  state: State;
  account: Account | null;
  characterId: string | null;
  /** Arena (zone) the player is in or entering. */
  zone: string;
  /** Join options waiting for CS_ZONE_READY. */
  pendingJoin: JoinOptions | null;
  inputBucket: TokenBucket;
  controlBucket: TokenBucket;
  authTimer: NodeJS.Timeout;
  /** When the character entered the world (played time), 0 until then. */
  enteredAt: number;
}

/**
 * Connection state machine on the main thread:
 * awaiting_auth --CS_AUTH_TICKET--> authenticated --CS_SELECT_CHARACTER--> joining
 *   --SC_ZONE_CHANGE--> zoning --CS_ZONE_READY--> in_world --portal--> transferring --> zoning ...
 * Binary input is only accepted in_world and is forwarded untouched to the player's zone worker.
 */
export class SessionManager implements TransportHandlers {
  private readonly sessions = new Map<number, Session>();
  private readonly tickets: TicketStore;
  private readonly zones: ZoneManager;
  private readonly defaultArena: string;
  private readonly persist: (records: CharacterPersistRecord[]) => void;
  private readonly log: Logger;
  private readonly characters: CharacterRepository;
  /** Characters currently in (or joining) the world; one connection per character. */
  private readonly activeCharacters = new Set<string>();

  constructor(
    tickets: TicketStore,
    zones: ZoneManager,
    characters: CharacterRepository,
    log: Logger,
    opts: { defaultArena: string; devGuestSpawn?: { x: number; y: number; z: number } | null; persist: (records: CharacterPersistRecord[]) => void },
  ) {
    this.tickets = tickets;
    this.zones = zones;
    this.characters = characters;
    this.log = log;
    this.defaultArena = opts.defaultArena;
    this.persist = opts.persist;
    this.devGuestSpawn = opts.devGuestSpawn ?? null;
  }

  private readonly devGuestSpawn: { x: number; y: number; z: number } | null;

  private zoneOf(s: Session): ZoneHost | null {
    return this.zones.host(s.zone);
  }

  /** A player of `arena` entered a portal to `target` (from the zone worker). */
  onPortal(arena: string, connId: number, target: string, keep?: { x: number; y: number; z: number; mesh: string }, via?: ExitCrossing): void {
    const s = this.sessions.get(connId);
    if (!s || s.state !== 'in_world' || s.zone !== arena) return;
    if (!this.zones.available(target)) {
      this.log.warn({ conn: connId, from: arena, target }, 'portal target not available');
      this.send(s, { op: SC.ERROR, d: { code: 'zone_unavailable', message: 'This way is blocked.' } });
      return;
    }
    s.state = 'transferring';
    s.pendingJoin = null;
    this.zones.host(arena)?.transfer(connId);
    this.log.info({ conn: connId, from: arena, to: target }, 'zone transfer');
    // Remember the destination; the 'transferred' answer carries the player's state.
    (s as Session & { transferTo?: string }).transferTo = target;
    (s as Session & { transferKeep?: typeof keep }).transferKeep = keep;
    (s as Session & { transferVia?: ExitCrossing }).transferVia = via;
  }

  /** The old zone removed the player: save, then send them into the destination zone. */
  onTransferred(arena: string, connId: number, record: PersistRecord | null, state: TransferState | null): void {
    const s = this.sessions.get(connId) as (Session & { transferTo?: string; transferKeep?: { x: number; y: number; z: number; mesh: string }; transferVia?: ExitCrossing }) | undefined;
    const target = s?.transferTo;
    const keep = s?.transferKeep;
    const via = s?.transferVia;
    if (record) this.persist([{ ...record, ...(target ? { zone: target, resetPosition: true } : {}) }]);
    if (!s || !target || !state) return;
    delete s.transferTo;
    delete s.transferKeep;
    delete s.transferVia;
    void this.sendToZone(s, target, { ...state, arrivingFrom: arena, ...(via ? { arrivingVia: via } : {}), ...(keep ? { arrivingAt: { x: keep.x, y: keep.y, z: keep.z }, arrivingMesh: keep.mesh } : {}) });
  }

  /** Announces the arena to the client and waits for CS_ZONE_READY before joining. */
  private async sendToZone(s: Session, arena: string, join: JoinOptions): Promise<void> {
    try {
      await this.zones.get(arena);
    } catch (err) {
      this.log.error({ err, arena }, 'zone failed to start');
      s.conn.close(1011, 'zone unavailable');
      return;
    }
    if (!this.sessions.has(s.conn.id)) return;
    s.zone = arena;
    s.pendingJoin = join;
    s.state = 'zoning';
    this.send(s, { op: SC.ZONE_CHANGE, d: { arena } });
  }

  /** Called by the zone host for every outbound frame. */
  deliver(connId: number, data: Uint8Array | string): void {
    this.sessions.get(connId)?.conn.send(data);
  }

  /** Whether a character is in (or entering) the world. */
  isCharacterActive(characterId: string): boolean {
    return this.activeCharacters.has(characterId);
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
      zone: this.defaultArena,
      pendingJoin: null,
      inputBucket: new TokenBucket(25, 30), // 20 Hz nominal (security.md §2.3)
      controlBucket: new TokenBucket(5, 10),
      authTimer: setTimeout(() => conn.close(CLOSE.AUTH_TIMEOUT, 'authentication timeout'), AUTH_TIMEOUT_MS),
      enteredAt: 0,
    };
    this.sessions.set(conn.id, session);
  }

  close(conn: ClientConnection): void {
    const s = this.sessions.get(conn.id);
    if (!s) return;
    clearTimeout(s.authTimer);
    if (s.state === 'in_world' || s.state === 'transferring') this.zoneOf(s)?.leave(conn.id);
    if (s.characterId) this.activeCharacters.delete(s.characterId);
    if (s.characterId && s.enteredAt && !s.account?.guest) {
      const seconds = (Date.now() - s.enteredAt) / 1000;
      void this.characters.addPlayTime(s.characterId, seconds).catch((err: unknown) => this.log.error({ err }, 'play time save failed'));
    }
    this.sessions.delete(conn.id);
    this.log.info({ conn: conn.id, account: s.account?.name }, 'disconnected');
  }

  message(conn: ClientConnection, data: Uint8Array | string): void {
    const s = this.sessions.get(conn.id);
    if (!s) return;

    if (typeof data !== 'string') {
      if (data[0] !== CS.PLAYER_INPUT) return this.reject(s, 'unexpected binary frame');
      if (s.state === 'zoning' || s.state === 'transferring') return; // in flight during a zone change
      if (s.state !== 'in_world') return this.reject(s, 'unexpected binary frame');
      if (!s.inputBucket.take()) return this.reject(s, 'input rate exceeded');
      // Copy into a standalone ArrayBuffer so it can be transferred to the worker.
      this.zoneOf(s)?.input(conn.id, data.slice().buffer as ArrayBuffer);
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
      case CS.ZONE_READY: {
        if (s.state !== 'zoning' || !s.pendingJoin || msg.d.arena !== s.zone) return;
        const host = this.zoneOf(s);
        if (!host) return;
        host.join(conn.id, s.pendingJoin);
        s.pendingJoin = null;
        s.state = 'in_world';
        s.enteredAt ||= Date.now();
        this.log.info({ conn: conn.id, account: s.account?.name, zone: s.zone }, 'entered zone');
        return;
      }
      case CS.INTERACT:
        if (s.state !== 'in_world') return;
        if (msg.d.talk !== undefined) this.zoneOf(s)?.talk(conn.id, msg.d.object, msg.d.talk);
        else this.zoneOf(s)?.interact(conn.id, msg.d.object, msg.d.key ?? false);
        return;
      case CS.SHOP_OPEN:
        if (s.state === 'in_world') this.zoneOf(s)?.shopOpen(conn.id, msg.d.shop);
        return;
      case CS.SHOP_BUY:
        if (s.state === 'in_world') this.zoneOf(s)?.shopBuy(conn.id, msg.d.shop, msg.d.index, msg.d.itemId);
        return;
      case CS.SHOP_SELL:
        if (s.state === 'in_world') this.zoneOf(s)?.shopSell(conn.id, msg.d.shop, msg.d.slot, msg.d.itemId);
        return;
      case CS.USE_ITEM:
        if (s.state === 'in_world') this.zoneOf(s)?.useItem(conn.id, msg.d.slot);
        return;
      case CS.EQUIP_ITEM:
        if (s.state === 'in_world') this.zoneOf(s)?.equip(conn.id, msg.d.slot, msg.d.equip, msg.d.itemId, msg.d.x !== undefined && msg.d.y !== undefined ? { x: msg.d.x, y: msg.d.y } : undefined);
        return;
      case CS.MOVE_INVENTORY_ITEM:
        if (s.state === 'in_world') this.zoneOf(s)?.moveInventoryItem(conn.id, msg.d.slot, msg.d.x, msg.d.y, msg.d.itemId);
        return;
      case CS.MERGE_INVENTORY_STACK:
        if (s.state === 'in_world') this.zoneOf(s)?.mergeInventoryStacks(conn.id, msg.d.fromSlot, msg.d.toSlot);
        return;
      case CS.SPLIT_INVENTORY_STACK:
        if (s.state === 'in_world') this.zoneOf(s)?.splitInventoryStack(conn.id, msg.d.slot, msg.d.quantity);
        return;
      case CS.DROP_INVENTORY_ITEM:
        if (s.state === 'in_world') this.zoneOf(s)?.dropInventoryItem(conn.id, msg.d.slot, msg.d.itemId);
        return;
      case CS.CAST_SPELL:
        if (s.state === 'in_world') this.zoneOf(s)?.castSpell(conn.id);
        return;
      case CS.SELECT_SPELL:
        if (s.state === 'in_world') this.zoneOf(s)?.selectSpell(conn.id, msg.d.spell);
        return;
      case CS.PLAYER_ATTACK:
        if (s.state === 'in_world') this.zoneOf(s)?.attack(conn.id, msg.d.kind ?? 'normal');
        return;
      case CS.CUTSCENE_DONE:
        if (s.state === 'in_world') this.zoneOf(s)?.cutsceneDone(conn.id, msg.d.sequence);
        return;
      case CS.PING:
        this.send(s, { op: SC.PONG, d: { clientTime: msg.d.clientTime, serverTick: this.zoneOf(s)?.tick ?? 0 } });
        return;
      default:
        // Combat and chat arrive with M09; accepted but ignored for now.
        return;
    }
  }

  private async enterWorld(s: Session, account: Account, characterId: string, name: string): Promise<void> {
    try {
      if (account.guest) {
        await this.sendToZone(s, this.defaultArena, { name, characterId: null, ...(this.devGuestSpawn ? { position: this.devGuestSpawn } : {}) });
      } else {
        const saved = await this.characters.loadOwned(account.id, characterId);
        if (!saved) return this.reject(s, 'character not found');
        if (!this.sessions.has(s.conn.id)) return; // disconnected while loading
        // Resume in the saved level zone when it still exists (the saved position belongs to it);
        // characters last seen in the synthetic test arena, or anywhere unavailable, start in
        // the server's default arena.
        const resume = saved.zone.startsWith(LEVEL_PREFIX) && this.zones.available(saved.zone) ? saved.zone : this.defaultArena;
        await this.sendToZone(s, resume, {
          name: saved.name,
          characterId: saved.id,
          position: resume === saved.zone ? saved.position : null,
          yaw: saved.yaw,
          experience: saved.experience,
          gold: saved.gold,
          hp: saved.hp,
          inventory: saved.inventory,
          mana: saved.mana,
          spells: saved.spells,
          selectedSpell: saved.selectedSpell,
          story: saved.story,
        });
      }
      this.log.info({ conn: s.conn.id, character: name, zone: s.zone, guest: account.guest }, 'entering world');
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
