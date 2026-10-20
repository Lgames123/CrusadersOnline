import type { Logger } from 'pino';
import { CS, LEVEL_PREFIX, MAX_STACK, PERMANENT_UNTIL, SC, SPELLS, decodeSpells, emptyStoryState, encodeSpells, parseClientControl, startingInventory, type Difficulty, type InventoryEntry, type ExitCrossing, type ItemCatalog, type KnownSpell, type ServerControlMsg } from '@crusaders/shared';
import type { Account, TicketStore } from '../auth/tickets.ts';
import type { CharacterPersistRecord, CharacterRepository } from '../persistence/characters.ts';
import { auctionDeposit, type EconomyEvent, type JoinOptions, type PersistRecord, type TransferState } from '../simulation/world_zone.ts';
import type { EconomyRepository } from '../persistence/economy.ts';
import type { ZoneHost } from '../zone/zone_host.ts';
import type { ZoneManager } from '../zone/zone_manager.ts';
import { TokenBucket } from './rate_limit.ts';
import { CLOSE, type ClientConnection, type TransportHandlers } from './transport.ts';
import { Parties } from './parties.ts';

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
  /** The character's name once it enters the world (chat sender, private-line address). */
  name: string;
  /** Chat lines: a speaker past it is told to slow down, not disconnected. */
  chatBucket: TokenBucket;
  /** When the connection opened (admin panel). */
  openedAt: number;
}

/** A chat line as the admin panel's log sees it (players' lines and the staff's own). */
export interface ChatLogEntry {
  channel: 'local' | 'global' | 'private' | 'admin';
  from: string;
  to?: string;
  zone?: string;
  text: string;
}

/** A connection as the admin panel lists it. */
export interface SessionView {
  connId: number;
  accountId: string;
  account: string;
  character: string;
  guest: boolean;
  admin: boolean;
  zone: string;
  state: State;
  since: number;
  mutedUntil: number | null;
}

/**
 * Connection state machine on the main thread:
 * awaiting_auth --CS_AUTH_TICKET--> authenticated --CS_SELECT_CHARACTER--> joining
 *   --SC_ZONE_CHANGE--> zoning --CS_ZONE_READY--> in_world --portal--> transferring --> zoning ...
 * Binary input is only accepted in_world and is forwarded untouched to the player's zone worker.
 */
export class SessionManager implements TransportHandlers {
  /** Parties (MMO Stage 2): in memory, by character name. */
  private readonly parties = new Parties();

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
    opts: {
      defaultArena: string;
      /** The server's difficulty: which level placements are there (the client builds the same). */
      difficulty?: Difficulty;
      devGuestSpawn?: { x: number; y: number; z: number } | null;
      devGuestSpells?: string | null;
      devGuestXp?: number;
      devGuestFinished?: boolean;
      /** The auction house and mailbox (MMO Stage 4); absent: none (tests). */
      economy?: EconomyRepository;
      /** The item catalogue (names in the auction house). */
      items?: ItemCatalog;
      devGuestItems?: string | null;
      persist: (records: CharacterPersistRecord[]) => void;
      /** Every player's chat line, for the admin panel's log. */
      onChat?: (line: ChatLogEntry) => void;
      /** A line told to each character entering the world (a running event), or null. */
      greeting?: () => string | null;
    },
  ) {
    this.onChat = opts.onChat;
    this.greeting = opts.greeting;
    this.tickets = tickets;
    this.zones = zones;
    this.characters = characters;
    this.log = log;
    this.defaultArena = opts.defaultArena;
    this.difficulty = opts.difficulty ?? 'medium';
    this.persist = opts.persist;
    this.devGuestSpawn = opts.devGuestSpawn ?? null;
    const all = /^all:(\d)$/.exec(opts.devGuestSpells ?? '');
    this.devGuestSpells = all ? SPELLS.map((spell) => ({ spell, level: Number(all[1]) })) : decodeSpells(opts.devGuestSpells);
    this.devGuestSpells = decodeSpells(encodeSpells(this.devGuestSpells));
    this.devGuestXp = opts.devGuestXp ?? 0;
    this.devGuestFinished = opts.devGuestFinished ?? false;
    this.economy = opts.economy ?? null;
    this.items = opts.items ?? null;
    // Listings past their time go back to their sellers.
    if (this.economy) {
      const eco = this.economy;
      setInterval(() => void eco.expireDue().catch((err: unknown) => this.log.error({ err }, 'auction expiry failed')), 60_000).unref();
    }
    const extra = (opts.devGuestItems ?? '').split(',').map((e) => e.trim().split(':')).filter(([id]) => !!id);
    this.devGuestItems = extra.length
      ? [...startingInventory(), ...extra.map(([itemId, n], i) => ({ slot: 2 + i, itemId: itemId!, equipped: false, ...(Number(n) > 1 ? { quantity: Math.min(MAX_STACK, Number(n)) } : {}) }))]
      : null;
  }

  private readonly onChat: ((line: ChatLogEntry) => void) | undefined;
  private readonly greeting: (() => string | null) | undefined;
  /** Chat mutes by account id (ms since epoch), from the ticket and the admin panel. */
  private readonly mutes = new Map<string, number>();
  private readonly devGuestSpawn: { x: number; y: number; z: number } | null;
  private readonly difficulty: Difficulty;
  /** Development only: what guests know and their experience (DEV_GUEST_SPELLS / DEV_GUEST_XP). */
  private readonly devGuestSpells: KnownSpell[];
  private readonly devGuestXp: number;
  /** Development only: guests have finished the story (DEV_GUEST_FINISHED). */
  private readonly devGuestFinished: boolean;
  private readonly economy: EconomyRepository | null;
  private readonly items: ItemCatalog | null;
  /** Development only: the guests' inventory (DEV_GUEST_ITEMS), else the starting one. */
  private readonly devGuestItems: InventoryEntry[] | null;

  private zoneOf(s: Session): ZoneHost | null {
    return this.zones.host(s.zone);
  }

  /** A player of `arena` entered a portal to `target` (from the zone worker). */
  onPortal(arena: string, connId: number, target: string, keep?: { x: number; y: number; z: number; mesh: string }, via?: ExitCrossing, waypoint?: boolean): void {
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
    (s as Session & { transferWaypoint?: boolean }).transferWaypoint = waypoint;
  }

  /** The old zone removed the player: save, then send them into the destination zone. */
  onTransferred(arena: string, connId: number, record: PersistRecord | null, state: TransferState | null): void {
    const s = this.sessions.get(connId) as (Session & { transferTo?: string; transferKeep?: { x: number; y: number; z: number; mesh: string }; transferVia?: ExitCrossing; transferWaypoint?: boolean }) | undefined;
    const target = s?.transferTo;
    const keep = s?.transferKeep;
    const via = s?.transferVia;
    const waypoint = s?.transferWaypoint;
    if (record) this.persist([{ ...record, ...(target ? { zone: target, resetPosition: true } : {}) }]);
    if (!s || !target || !state) return;
    delete s.transferTo;
    delete s.transferKeep;
    delete s.transferVia;
    delete s.transferWaypoint;
    if (waypoint) {
      void this.sendToZone(s, target, { ...state, arrivingWaypoint: true });
      return;
    }
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
    const party = s.name ? this.parties.of(s.name) : null;
    s.pendingJoin = { ...join, party: party?.id ?? null };
    s.state = 'zoning';
    this.send(s, { op: SC.ZONE_CHANGE, d: { arena, difficulty: this.difficulty } });
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
      name: '',
      chatBucket: new TokenBucket(1, 5),
      openedAt: Date.now(),
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
    // Leaving the world leaves the party (it lives in memory; nothing keeps the place).
    const party = s.name ? this.parties.of(s.name) : null;
    if (party) {
      const rest = party.members.filter((m) => m.toLowerCase() !== s.name.toLowerCase());
      this.parties.leave(s.name);
      for (const m of rest) {
        this.syncPartyMember(m);
        const o = this.sessionNamed(m);
        if (o) this.send(o, { op: SC.CHAT_BROADCAST, d: { channel: 'system', kind: 'info', text: `${s.name} leaves the party.` } });
      }
    }
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
        if (account.mutedUntil && account.mutedUntil > Date.now()) this.mutes.set(account.id, account.mutedUntil);
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
        if (!s.enteredAt) {
          s.enteredAt = Date.now();
          const hello = this.greeting?.();
          if (hello) this.send(s, { op: SC.CHAT_BROADCAST, d: { channel: 'system', kind: 'admin', text: hello } });
        }
        this.log.info({ conn: conn.id, account: s.account?.name, zone: s.zone }, 'entered zone');
        if (s.name) this.refreshParty(s.name);
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
      case CS.UNSTUCK:
        if (s.state === 'in_world') this.zoneOf(s)?.unstuck(conn.id);
        return;
      case CS.AUCTION:
        if (s.state === 'in_world') this.auctionAction(s, msg.d);
        return;
      case CS.TRADE:
        if (s.state === 'in_world') this.zoneOf(s)?.trade(conn.id, msg.d);
        return;
      case CS.REFINE:
        if (s.state === 'in_world') this.zoneOf(s)?.refine(conn.id, msg.d.slot, msg.d.itemId);
        return;
      case CS.PARTY:
        if (s.state === 'in_world' || s.state === 'zoning') this.partyAction(s, msg.d.action, msg.d.name);
        return;
      case CS.WAYPOINT_TRAVEL:
        if (s.state === 'in_world') this.zoneOf(s)?.waypointTravel(conn.id, msg.d.act);
        return;
      case CS.CHAT_MESSAGE:
        this.chat(s, msg.d.channel, msg.d.text, msg.d.to);
        return;
      case CS.PING:
        this.send(s, { op: SC.PONG, d: { clientTime: msg.d.clientTime, serverTick: this.zoneOf(s)?.tick ?? 0 } });
        return;
      default:
        // Every other parsed op is handled above.
        return;
    }
  }

  /** Whether a session's character is in the world (or between two zones of it). */
  private inWorld(s: Session): boolean {
    return s.state === 'in_world' || s.state === 'zoning' || s.state === 'transferring';
  }

  /**
   * A chat line: `local` to every player of the sender's zone, `global` to every player, `private`
   * to the character named `to` (any case) and echoed back to the sender. Not the original's
   * (single player); the server's own lines (loot, experience) come from the zones as `system`.
   */
  private chat(s: Session, channel: 'local' | 'global' | 'private' | 'party', raw: string, to?: string): void {
    if (!this.inWorld(s) || !s.name) return;
    const notice = (text: string) => this.send(s, { op: SC.CHAT_BROADCAST, d: { channel: 'system', kind: 'error', text } });
    // Control characters (newlines, bidi overrides) would break the line or spoof others.
    const text = raw.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim();
    if (!text) return;
    const muted = s.account ? this.mutes.get(s.account.id) : undefined;
    if (muted !== undefined) {
      if (muted > Date.now()) return notice(muted >= PERMANENT_UNTIL ? 'You are muted.' : `You are muted for ${Math.ceil((muted - Date.now()) / 60_000)} more minute(s).`);
      this.mutes.delete(s.account!.id);
    }
    if (!s.chatBucket.take()) return notice('You are sending messages too fast.');
    if (channel === 'party') {
      const party = this.parties.of(s.name);
      if (!party) return notice('You are not in a party.');
      const d = { channel, from: s.name, text };
      for (const m of party.members) {
        const o = this.sessionNamed(m);
        if (o) this.send(o, { op: SC.CHAT_BROADCAST, d: o === s ? { ...d, sent: true } : d });
      }
      this.onChat?.({ channel: 'local', from: s.name, zone: s.zone, text: `[party] ${text}` });
      return;
    }
    if (channel === 'private') {
      const wanted = to?.toLowerCase();
      const target = wanted ? [...this.sessions.values()].find((o) => this.inWorld(o) && o.name.toLowerCase() === wanted) : undefined;
      if (!target) return notice(`${to ?? 'Nobody'} is not online.`);
      const d = { channel, from: s.name, to: target.name, text };
      this.send(target, { op: SC.CHAT_BROADCAST, d });
      if (target !== s) this.send(s, { op: SC.CHAT_BROADCAST, d: { ...d, sent: true } });
      this.onChat?.({ channel, from: s.name, to: target.name, zone: s.zone, text });
      return;
    }
    this.onChat?.({ channel, from: s.name, zone: s.zone, text });
    const d = { channel, from: s.name, text };
    const msg = JSON.stringify({ op: SC.CHAT_BROADCAST, d } satisfies ServerControlMsg);
    for (const o of this.sessions.values()) {
      if (o !== s && this.inWorld(o) && (channel === 'global' || o.zone === s.zone)) o.conn.send(msg);
    }
    this.send(s, { op: SC.CHAT_BROADCAST, d: { ...d, sent: true } });
    this.log.info({ conn: s.conn.id, channel, from: s.name, length: text.length }, 'chat');
  }

  // --- Auction house (MMO Stage 4, not original; persistence/economy.ts) ------------------

  /** Purchases paid in a zone, waiting for the market: ref -> who buys what. */
  private readonly pendingBuys = new Map<string, { connId: number; characterId: string; name: string; listing: string; price: number }>();
  private nextBuyRef = 1;

  private auctionAction(s: Session, d: { action: 'search' | 'list' | 'buy' | 'cancel' | 'mail' | 'claim'; q?: string; id?: string; slot?: number; itemId?: string; price?: number; hours?: number }): void {
    const eco = this.economy;
    const fail = (text: string) => this.send(s, { op: SC.CHAT_BROADCAST, d: { channel: 'system', kind: 'error', text } });
    if (!eco || !s.characterId) return fail('The auction house needs a saved character.');
    const characterId = s.characterId;
    const run = (p: Promise<unknown>) => void p.catch((err: unknown) => {
      this.log.error({ err, action: d.action }, 'auction failed');
      fail('The auction house is unavailable right now.');
    });
    switch (d.action) {
      case 'search':
        return run(this.sendAuction(s, d.q));
      case 'mail':
        return run(this.sendAuction(s, undefined));
      case 'list': {
        const hours = d.hours ?? 24;
        if (!d.price || d.price < 1 || d.slot === undefined || ![12, 24, 48].includes(hours)) return fail('List what, for how much? Price 1 or more, 12 / 24 / 48 hours.');
        this.zoneOf(s)?.auctionEscrow(s.conn.id, d.slot, d.itemId, Math.floor(d.price), hours);
        return;
      }
      case 'buy': {
        if (!d.id) return;
        const id = d.id;
        return run((async () => {
          const offer = await eco.price(id);
          if (!offer) return fail('That item is no longer for sale.');
          if (offer.seller === characterId) return fail('That is your own listing.');
          const ref = `b${this.nextBuyRef++}`;
          this.pendingBuys.set(ref, { connId: s.conn.id, characterId, name: s.name, listing: id, price: offer.price });
          this.zoneOf(s)?.auctionCharge(s.conn.id, offer.price, ref);
        })());
      }
      case 'cancel':
        if (!d.id) return;
        return run((async () => {
          if (await eco.cancel(d.id!, characterId)) this.send(s, { op: SC.CHAT_BROADCAST, d: { channel: 'system', kind: 'trade', text: 'Listing cancelled: the item waits in your mailbox.' } });
          await this.sendAuction(s, d.q);
        })());
      case 'claim':
        return run((async () => {
          const mail = await eco.claimAll(characterId);
          if (!mail.length) return fail('Your mailbox is empty.');
          const gold = mail.reduce((n, m) => n + m.gold, 0);
          this.zoneOf(s)?.deliverMail(s.conn.id, gold, mail.flatMap((m) => (m.item ? [m.item] : [])));
          setTimeout(() => run(this.sendAuction(s, undefined)), 300);
        })());
    }
  }

  /** The market's answer to one of its zone requests. */
  onEconomy(e: EconomyEvent): void {
    const eco = this.economy;
    if (!eco) return;
    const s = this.sessions.get(e.connId);
    const tell = (text: string, kind: 'trade' | 'error' = 'trade') => s && this.send(s, { op: SC.CHAT_BROADCAST, d: { channel: 'system', kind, text } });
    const guard = (p: Promise<unknown>) => void p.catch((err: unknown) => this.log.error({ err, kind: e.kind }, 'auction step failed'));
    if (e.kind === 'escrowed') {
      guard((async () => {
        const r = await eco.list({ id: e.characterId, name: e.name }, e.item, e.price, e.hours).catch(() => 'error' as const);
        if (r === 'limit' || r === 'error') {
          // Not listed: the item comes back by mail (the deposit too: nothing was offered).
          await eco.send(e.characterId, r === 'limit' ? 'Too many listings' : 'Listing failed', auctionDeposit(e.price, e.hours), e.item);
          tell(r === 'limit' ? 'You already have 15 listings: the item went back to your mailbox.' : 'The listing failed: the item went back to your mailbox.', 'error');
        } else {
          tell(`Listed for ${e.price} gold (deposit ${auctionDeposit(e.price, e.hours)}).`);
        }
        if (s) await this.sendAuction(s, undefined);
      })());
    } else if (e.kind === 'charged') {
      const buy = this.pendingBuys.get(e.ref);
      this.pendingBuys.delete(e.ref);
      if (!buy || !e.ok) return;
      guard((async () => {
        const r = await eco.buy(buy.listing, { id: buy.characterId, name: buy.name }, buy.price).catch(() => 'gone' as const);
        if (r === 'gone') {
          await eco.send(buy.characterId, 'Refund: no longer for sale', buy.price, null);
          tell('Someone was quicker: your gold waits in your mailbox.', 'error');
        } else tell('Bought: the item waits in your mailbox.');
        if (s) await this.sendAuction(s, undefined);
      })());
    } else if (e.kind === 'undelivered') {
      guard((async () => {
        if (e.gold > 0) await eco.send(e.characterId, 'Not collected', e.gold, null);
        for (const it of e.items) await eco.send(e.characterId, 'Not collected', 0, it);
        if (s) await this.sendAuction(s, undefined);
      })());
    }
  }

  /** Listings (all, or those whose name holds `q`) and the mailbox. */
  private async sendAuction(s: Session, q: string | undefined): Promise<void> {
    const eco = this.economy;
    if (!eco || !s.characterId) return;
    const wanted = q?.trim().toLowerCase();
    const ids = wanted ? [...(this.items?.values() ?? [])].filter((d) => d.name.toLowerCase().includes(wanted)).map((d) => d.id) : null;
    const [found, mail] = await Promise.all([eco.search(ids, s.characterId), eco.mailFor(s.characterId)]);
    const look = (itemId: string) => {
      const def = this.items?.get(itemId);
      return { name: def?.name ?? itemId, type: def?.type ?? 'key', ...(def?.model !== undefined ? { model: def.model } : {}) };
    };
    this.send(s, {
      op: SC.AUCTION,
      d: {
        listings: found.map((l) => ({ ...l, ...look(l.itemId) })),
        mail: mail.map((m) => ({ id: m.id, sender: m.sender, subject: m.subject, gold: m.gold, ...(m.item ? { item: { ...m.item, ...look(m.item.itemId) } } : {}) })),
      },
    });
  }

  // --- Parties (MMO Stage 2, not original) -----------------------------------------------

  /** The in-world (or zoning) session of a character, by name. */
  private sessionNamed(name: string): Session | undefined {
    const wanted = name.toLowerCase();
    return [...this.sessions.values()].find((o) => this.inWorld(o) && o.name.toLowerCase() === wanted);
  }

  private partyAction(s: Session, action: 'invite' | 'accept' | 'decline' | 'leave' | 'kick' | 'promote', name?: string): void {
    const tell = (o: Session, text: string, kind: 'info' | 'error' = 'info') => this.send(o, { op: SC.CHAT_BROADCAST, d: { channel: 'system', kind, text } });
    const before = this.parties.of(s.name);
    const beforeMembers = before ? [...before.members] : [];
    let r;
    switch (action) {
      case 'invite': {
        const target = name ? this.sessionNamed(name) : undefined;
        if (!target) return tell(s, `${name ?? 'Nobody'} is not online.`, 'error');
        r = this.parties.invite(s.name, target.name);
        if (r.ok) {
          tell(target, `${s.name} invites you to a party. Type /accept or /decline.`);
          this.send(target, { op: SC.PARTY_UPDATE, d: { members: [], invite: s.name } });
        }
        break;
      }
      case 'accept': r = this.parties.accept(s.name); break;
      case 'decline': {
        const from = this.parties.pendingFor(s.name);
        r = this.parties.decline(s.name);
        const inviter = from ? this.sessionNamed(from) : undefined;
        if (r.ok && inviter) tell(inviter, `${s.name} declines your invitation.`);
        break;
      }
      case 'leave': r = this.parties.leave(s.name); break;
      case 'kick': r = name ? this.parties.kick(s.name, name) : { ok: false as const, error: 'Remove whom? /kick <name>' }; break;
      case 'promote': r = name ? this.parties.promote(s.name, name) : { ok: false as const, error: 'Promote whom? /promote <name>' }; break;
    }
    if (!r.ok) return tell(s, r.error, 'error');
    if (r.message) tell(s, r.message);
    if (action === 'invite' || action === 'decline') return;
    // Everyone who was or is in the party hears the new line-up.
    const now = r.party ? [...r.party.members] : [];
    for (const m of new Set([...beforeMembers, ...now, s.name])) this.syncPartyMember(m);
    const verb = action === 'accept' ? 'joins' : action === 'leave' ? 'leaves' : action === 'kick' ? 'is removed from' : null;
    const who = action === 'kick' ? name! : s.name;
    if (verb) for (const m of new Set([...beforeMembers, ...now])) { const o = this.sessionNamed(m); if (o) tell(o, `${who} ${verb} the party.`); }
    if (action === 'promote') for (const m of now) { const o = this.sessionNamed(m); if (o) tell(o, `${now[0]} now leads the party.`); }
  }

  /** Sends a character its party (or none) and tells its zone which party it is in. */
  private syncPartyMember(name: string): void {
    const o = this.sessionNamed(name);
    if (!o) return;
    const party = this.parties.of(name);
    const members = (party?.members ?? []).map((m, i) => {
      const ms = this.sessionNamed(m);
      return { name: ms?.name ?? m, leader: i === 0, zone: ms && ms.state === 'in_world' ? ms.zone : null };
    });
    this.send(o, { op: SC.PARTY_UPDATE, d: { members, self: o.name } });
    if (o.state === 'in_world') this.zoneOf(o)?.setParty(o.conn.id, party?.id ?? null);
  }

  /** A character entered a zone or left the world: its party's frames show where everyone is. */
  private refreshParty(name: string): void {
    const party = this.parties.of(name);
    for (const m of party?.members ?? [name]) this.syncPartyMember(m);
  }

  // --- Admin panel (not original) -------------------------------------------------------

  private view(s: Session): SessionView {
    const muted = s.account ? this.mutes.get(s.account.id) ?? null : null;
    return {
      connId: s.conn.id,
      accountId: s.account?.id ?? '',
      account: s.account?.name ?? '',
      character: s.name,
      guest: s.account?.guest ?? false,
      admin: s.account?.admin ?? false,
      zone: s.zone,
      state: s.state,
      since: s.enteredAt || s.openedAt,
      mutedUntil: muted !== null && muted > Date.now() ? muted : null,
    };
  }

  /** Every authenticated connection. */
  list(): SessionView[] {
    return [...this.sessions.values()].filter((s) => s.account).map((s) => this.view(s));
  }

  /** The connections of a character name or account name (any case), or of an account id. */
  find(nameOrAccountId: string): SessionView[] {
    const want = nameOrAccountId.toLowerCase();
    return [...this.sessions.values()]
      .filter((s) => s.account && (s.name.toLowerCase() === want || s.account.name.toLowerCase() === want || s.account.id === nameOrAccountId))
      .map((s) => this.view(s));
  }

  /** Closes a connection with a message the client shows; whether it was there. */
  kick(connId: number, message: string): boolean {
    const s = this.sessions.get(connId);
    if (!s) return false;
    this.send(s, { op: SC.ERROR, d: { code: 'kicked', message } });
    this.log.info({ conn: connId, account: s.account?.name, message }, 'kicked');
    s.conn.close(CLOSE.POLICY, message.slice(0, 120));
    return true;
  }

  /** Chat mute of an account (null: lifted), told to its characters in the world. */
  setMute(accountId: string, until: number | null): void {
    if (until === null) this.mutes.delete(accountId);
    else this.mutes.set(accountId, until);
    const text = until === null ? 'You can chat again.' : until >= PERMANENT_UNTIL ? 'You have been muted.' : `You have been muted for ${Math.ceil((until - Date.now()) / 60_000)} minute(s).`;
    for (const s of this.sessions.values()) if (s.account?.id === accountId && this.inWorld(s)) this.send(s, { op: SC.CHAT_BROADCAST, d: { channel: 'system', kind: 'admin', text } });
  }

  /**
   * A staff line (kind `admin`, shown on every chat tab): to everyone in the world, to one zone,
   * or to one character (false: not online).
   */
  adminLine(text: string, from: string, target: { zone: string } | { to: string } | null): boolean {
    const clean = text.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim();
    const to = target && 'to' in target ? target.to.toLowerCase() : null;
    const zone = target && 'zone' in target ? target.zone : null;
    const msg = JSON.stringify({ op: SC.CHAT_BROADCAST, d: { channel: 'system', kind: 'admin', text: to ? `(to you) ${clean}` : clean } } satisfies ServerControlMsg);
    let reached = 0;
    for (const s of this.sessions.values()) {
      if (!this.inWorld(s) || (zone && s.zone !== zone) || (to && s.name.toLowerCase() !== to)) continue;
      s.conn.send(msg);
      reached++;
    }
    if (to && reached === 0) return false;
    this.onChat?.({ channel: 'admin', from, text: clean, ...(to ? { to: target && 'to' in target ? target.to : '' } : {}), ...(zone ? { zone } : {}) });
    return true;
  }

  private async enterWorld(s: Session, account: Account, characterId: string, name: string): Promise<void> {
    try {
      if (account.guest) {
        s.name = name;
        await this.sendToZone(s, this.defaultArena, {
          name, characterId: null,
          ...(this.devGuestSpawn ? { position: this.devGuestSpawn } : {}),
          ...(this.devGuestSpells.length ? { spells: this.devGuestSpells, selectedSpell: this.devGuestSpells[0]!.spell } : {}),
          ...(this.devGuestXp ? { experience: this.devGuestXp } : {}),
          ...(this.devGuestFinished ? { story: { ...emptyStoryState(), completedAt: Date.now() } } : {}),
          ...(this.devGuestItems ? { inventory: structuredClone(this.devGuestItems) } : {}),
        });
      } else {
        const saved = await this.characters.loadOwned(account.id, characterId);
        if (!saved) return this.reject(s, 'character not found');
        if (!this.sessions.has(s.conn.id)) return; // disconnected while loading
        s.name = saved.name;
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
