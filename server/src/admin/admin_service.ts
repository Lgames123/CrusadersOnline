import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import {
  DEFAULT_RATES,
  MOB_ARCHETYPES,
  PERMANENT_UNTIL,
  type AdminAccountView,
  type AdminChatLine,
  type AdminEvent,
  type AdminPlayerView,
  type CustomSpawnSpec,
  type CustomSpawnView,
  type EventRequest,
  type ItemCatalog,
  type ModerationRequest,
  type PlayerAction,
  type SpawnRequest,
  type WorldRates,
} from '@crusaders/shared';
import type { AdminRepository } from '../persistence/admin.ts';
import type { SessionManager, SessionView } from '../network/sessions.ts';
import type { ZoneAdminReport } from '../simulation/world_zone.ts';
import type { ZoneManager } from '../zone/zone_manager.ts';

const CHAT_LOG_LINES = 500;
const TIMEOUT_DEFAULT_MINUTES = 10;

/** An admin request the panel shows as a refusal (400 with this message). */
export class AdminError extends Error {}

interface SpawnEntry {
  view: CustomSpawnView;
}

const rateText = (r: WorldRates) =>
  (Object.keys(DEFAULT_RATES) as (keyof WorldRates)[])
    .filter((k) => r[k] !== 1)
    .map((k) => `${k === 'xp' ? 'XP' : k[0]!.toUpperCase() + k.slice(1)} ×${r[k]}`)
    .join(', ') || 'no rate changes';

const minutesText = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m >= 120 ? `${Math.round(m / 60)} h` : `${m} min`;
};

/**
 * The admin panel's server side (not original), on the main thread: the live chat log,
 * moderation (kick, mute, timeout, ban), rate events with a start and an end, custom creature
 * spawns, player tools, and the audit log of all of it.
 */
export class AdminService {
  private readonly sessions: SessionManager;
  private readonly zones: ZoneManager;
  private readonly repo: AdminRepository;
  private readonly items: ItemCatalog;
  private readonly log: Logger;
  private readonly startedAt = Date.now();

  private chatSeq = 0;
  private readonly chatLog: AdminChatLine[] = [];
  private readonly streams = new Set<ServerResponse>();
  private readonly keepAlive: NodeJS.Timeout;

  /** Not ended or cancelled (scheduled and running), refreshed from the database on change. */
  private events: AdminEvent[] = [];
  /** Events whose start was handled (announced), so a restart does not announce them twice. */
  private readonly started = new Set<string>();
  private readonly clock: NodeJS.Timeout;

  private readonly spawns = new Map<string, SpawnEntry>();

  constructor(deps: { sessions: SessionManager; zones: ZoneManager; repo: AdminRepository; items: ItemCatalog; log: Logger }) {
    this.sessions = deps.sessions;
    this.zones = deps.zones;
    this.repo = deps.repo;
    this.items = deps.items;
    this.log = deps.log;
    this.keepAlive = setInterval(() => {
      for (const res of this.streams) res.write(': keep-alive\n\n');
    }, 25_000);
    this.keepAlive.unref();
    this.clock = setInterval(() => this.tick(), 1000);
    this.clock.unref();
  }

  /** Loads the events still to come or running (the ones already running are not announced again). */
  async start(): Promise<void> {
    this.events = (await this.repo.events(Date.now(), 0)).filter((e) => e.state === 'scheduled' || e.state === 'active');
    for (const e of this.events) if (e.state === 'active') this.started.add(e.id);
    this.applyRates();
  }

  stop(): void {
    clearInterval(this.keepAlive);
    clearInterval(this.clock);
    for (const res of this.streams) res.end();
    this.streams.clear();
  }

  // --- Chat ---------------------------------------------------------------------------

  /** A chat line for the log (SessionManager's onChat). */
  chat(line: Omit<AdminChatLine, 'seq' | 'at'>): void {
    const entry: AdminChatLine = { seq: ++this.chatSeq, at: Date.now(), ...line };
    this.chatLog.push(entry);
    if (this.chatLog.length > CHAT_LOG_LINES) this.chatLog.splice(0, this.chatLog.length - CHAT_LOG_LINES);
    const data = `event: chat\ndata: ${JSON.stringify(entry)}\n\n`;
    for (const res of this.streams) res.write(data);
  }

  chatHistory(after = 0): AdminChatLine[] {
    return this.chatLog.filter((l) => l.seq > after);
  }

  /** Server-sent events: the chat log as it happens (the last lines first). */
  stream(res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`retry: 3000\n\n`);
    for (const l of this.chatLog.slice(-200)) res.write(`event: chat\ndata: ${JSON.stringify(l)}\n\n`);
    this.streams.add(res);
    res.on('close', () => this.streams.delete(res));
  }

  async say(admin: string, mode: 'announce' | 'zone' | 'whisper', text: string, zone?: string, to?: string): Promise<void> {
    if (mode === 'zone' && !zone) throw new AdminError('Choose a zone.');
    if (mode === 'whisper' && !to) throw new AdminError('Name the character.');
    const ok = this.sessions.adminLine(text, admin, mode === 'announce' ? null : mode === 'zone' ? { zone: zone! } : { to: to! });
    if (!ok) throw new AdminError(`${to} is not online.`);
    await this.audit(admin, `chat.${mode}`, mode === 'announce' ? null : mode === 'zone' ? zone! : to!, text);
  }

  // --- Overview and players -----------------------------------------------------------

  overview() {
    const list = this.sessions.list();
    return {
      startedAt: this.startedAt,
      now: Date.now(),
      online: list.filter((s) => s.state === 'in_world').length,
      connections: list.length,
      rates: this.zones.currentRates,
      events: this.events.filter((e) => e.state === 'active'),
      zones: this.zones.names.map((name) => {
        const h = this.zones.host(name);
        return { name, players: h?.members.size ?? 0, tick: h?.tick ?? 0, metrics: h?.lastMetrics ?? null, spawns: [...this.spawns.values()].filter((s) => s.view.zone === name).length };
      }),
      arenas: this.zones.arenas(),
    };
  }

  private async reports(zones: Iterable<string>): Promise<Map<string, ZoneAdminReport>> {
    const out = new Map<string, ZoneAdminReport>();
    await Promise.all(
      [...new Set(zones)].map(async (z) => {
        const h = this.zones.host(z);
        if (!h) return;
        try {
          out.set(z, (await h.request({ kind: 'report' })).data as ZoneAdminReport);
        } catch (err) {
          this.log.warn({ err, zone: z }, 'admin report failed');
        }
      }),
    );
    return out;
  }

  async players(): Promise<AdminPlayerView[]> {
    const list = this.sessions.list();
    const reports = await this.reports(list.map((s) => s.zone));
    return list.map((s) => {
      const r = reports.get(s.zone)?.players.find((p) => p.connId === s.connId);
      const { accountId: _id, ...view } = s;
      return { ...view, ...(r ? { level: r.level, hp: r.hp, maxHp: r.maxHp, gold: r.gold, xp: r.xp, dead: r.dead, x: r.x, y: r.y, z: r.z } : {}) };
    });
  }

  // --- Moderation ---------------------------------------------------------------------

  async accounts(q: string): Promise<AdminAccountView[]> {
    const online = new Set(this.sessions.list().map((s) => s.character.toLowerCase()));
    const found = await this.repo.searchAccounts(q.trim());
    return found.map((a) => ({ ...a, admin: a.isAdmin, characters: a.characters.map((c) => ({ ...c, online: online.has(c.name.toLowerCase()) })) }));
  }

  async moderate(admin: { id: string; username: string }, req: ModerationRequest): Promise<string> {
    const account = await this.repo.findAccount(req.target);
    const live = this.sessions.find(req.target);
    // Guests have no account row: only what lives in memory (kick, mute) applies to them.
    const accountId = account?.id ?? live[0]?.accountId;
    if (!accountId) throw new AdminError(`No account or character named ${req.target}.`);
    if (accountId === admin.id && req.action !== 'unmute' && req.action !== 'unban') throw new AdminError('You cannot do that to your own account.');
    const name = account?.username ?? live[0]!.account;
    const sessions = account ? this.sessions.find(account.id) : live;
    const reason = req.reason ? ` (${req.reason})` : '';
    const until = (minutes: number | undefined) => (minutes ? Date.now() + minutes * 60_000 : PERMANENT_UNTIL);
    const span = (u: number) => (u >= PERMANENT_UNTIL ? 'permanently' : `for ${minutesText(u - Date.now())}`);
    let result: string;
    switch (req.action) {
      case 'kick':
        if (sessions.length === 0) throw new AdminError(`${req.target} is not online.`);
        for (const s of sessions) this.sessions.kick(s.connId, `You have been kicked by an administrator${reason}.`);
        result = `${name} kicked.`;
        break;
      case 'mute': {
        const u = until(req.minutes);
        if (account) await this.repo.setMute(account.id, u);
        this.sessions.setMute(accountId, u);
        result = `${name} muted ${span(u)}.`;
        break;
      }
      case 'unmute':
        if (account) await this.repo.setMute(account.id, null);
        this.sessions.setMute(accountId, null);
        result = `${name} unmuted.`;
        break;
      case 'timeout':
      case 'ban': {
        if (!account) {
          // A guest: nothing to keep him out with but the kick.
          for (const s of sessions) this.sessions.kick(s.connId, `You have been removed by an administrator${reason}.`);
          result = `${name} is a guest: kicked only.`;
          break;
        }
        const u = until(req.action === 'timeout' ? req.minutes ?? TIMEOUT_DEFAULT_MINUTES : req.minutes);
        await this.repo.setBan(account.id, u, req.reason ?? (req.action === 'timeout' ? 'timeout' : null));
        const words = req.action === 'timeout' ? `timed out ${span(u)}` : `banned ${span(u)}`;
        for (const s of sessions) this.sessions.kick(s.connId, `You have been ${words}${reason}.`);
        result = `${name} ${words}.`;
        break;
      }
      case 'unban':
        if (!account) throw new AdminError('Guests are never banned.');
        await this.repo.setBan(account.id, null, null);
        result = `${name} unbanned.`;
        break;
    }
    await this.audit(admin.username, req.action, name, [req.minutes ? `${req.minutes} min` : '', req.reason ?? ''].filter(Boolean).join(' · ') || null);
    return result;
  }

  // --- Player tools ---------------------------------------------------------------------

  async player(admin: string, req: PlayerAction): Promise<string> {
    const s = this.inWorld(req.target);
    const host = this.zones.host(s.zone);
    if (!host) throw new AdminError(`${req.target}'s zone is not running.`);
    let toConn: number | undefined;
    if (req.action === 'summon') {
      if (!req.to) throw new AdminError('Name the character to bring him to.');
      const to = this.inWorld(req.to);
      if (to.zone !== s.zone) throw new AdminError(`${to.character} is in ${to.zone}, ${s.character} in ${s.zone}: both must be in the same zone.`);
      toConn = to.connId;
    }
    if ((req.action === 'gold' || req.action === 'xp') && !req.amount) throw new AdminError('Give an amount.');
    if (req.action === 'item' && !req.itemId) throw new AdminError('Choose an item.');
    const op = { action: req.action, ...(req.amount !== undefined ? { amount: req.amount } : {}), ...(req.itemId ? { itemId: req.itemId } : {}), ...(toConn !== undefined ? { toConn } : {}) };
    const line = await this.zoneCall(() => host.request({ kind: 'player', connId: s.connId, op }));
    await this.audit(admin, `player.${req.action}`, s.character, [req.amount ?? '', req.itemId ?? '', req.to ?? ''].filter((v) => v !== '').join(' ') || null);
    return line as string;
  }

  private inWorld(name: string): SessionView {
    const s = this.sessions.find(name).find((v) => v.state === 'in_world' && v.character.toLowerCase() === name.toLowerCase());
    if (!s) throw new AdminError(`${name} is not in the world.`);
    return s;
  }

  private async zoneCall<T>(call: () => Promise<{ data: T }>): Promise<T> {
    try {
      return (await call()).data;
    } catch (err) {
      throw new AdminError((err as Error).message);
    }
  }

  // --- Events -------------------------------------------------------------------------

  async listEvents(): Promise<AdminEvent[]> {
    return this.repo.events(Date.now());
  }

  async createEvent(admin: string, req: EventRequest): Promise<AdminEvent> {
    const now = Date.now();
    const startsAt = req.startsAt && req.startsAt > now ? req.startsAt : now;
    const e: Omit<AdminEvent, 'id' | 'state'> = { name: req.name, rates: req.rates, startsAt, endsAt: startsAt + req.minutes * 60_000, announce: req.announce, createdBy: admin };
    const id = await this.repo.createEvent(e);
    const event: AdminEvent = { ...e, id, state: startsAt <= now ? 'active' : 'scheduled' };
    this.events.push(event);
    await this.audit(admin, 'event.create', req.name, `${rateText(req.rates)} · ${new Date(startsAt).toISOString()} · ${req.minutes} min`);
    this.tick();
    return event;
  }

  async cancelEvent(admin: string, id: string): Promise<void> {
    const e = this.events.find((x) => x.id === id);
    await this.repo.cancelEvent(id);
    this.events = this.events.filter((x) => x.id !== id);
    if (e && this.started.has(id) && e.announce) this.sessions.adminLine(`The event "${e.name}" has ended.`, admin, null);
    this.started.delete(id);
    this.applyRates();
    await this.audit(admin, 'event.cancel', e?.name ?? id, null);
  }

  /** Ends every running and scheduled event: the original's rates again. */
  async resetRates(admin: string): Promise<void> {
    for (const e of [...this.events]) await this.cancelEvent(admin, e.id);
    this.applyRates();
  }

  /** The line told to characters entering the world while events run. */
  greeting(): string | null {
    const now = Date.now();
    const active = this.events.filter((e) => e.startsAt <= now && e.endsAt > now);
    if (active.length === 0) return null;
    return active.map((e) => `Event "${e.name}" is on: ${rateText(e.rates)} (${minutesText(e.endsAt - now)} left).`).join(' ');
  }

  /** Every second: events starting and ending, and the custom spawns that ran out. */
  private tick(): void {
    const now = Date.now();
    let changed = false;
    for (const e of [...this.events]) {
      if (e.endsAt <= now) {
        this.events = this.events.filter((x) => x !== e);
        if (this.started.delete(e.id) && e.announce) this.sessions.adminLine(`The event "${e.name}" has ended.`, 'server', null);
        changed = true;
      } else if (e.startsAt <= now && !this.started.has(e.id)) {
        this.started.add(e.id);
        e.state = 'active';
        if (e.announce) this.sessions.adminLine(`Event "${e.name}" has begun: ${rateText(e.rates)} for ${minutesText(e.endsAt - now)}!`, 'server', null);
        changed = true;
      }
    }
    if (changed) this.applyRates();
    for (const [id, s] of this.spawns) {
      if (s.view.expiresAt > now) continue;
      this.spawns.delete(id);
      this.zones.unpin(s.view.zone);
    }
  }

  /** Running events' rates multiplied together, to every zone. */
  private applyRates(): void {
    const now = Date.now();
    const r: WorldRates = { ...DEFAULT_RATES };
    for (const e of this.events) {
      if (e.startsAt > now || e.endsAt <= now) continue;
      for (const k of Object.keys(r) as (keyof WorldRates)[]) r[k] *= e.rates[k];
    }
    const cur = this.zones.currentRates;
    if ((Object.keys(r) as (keyof WorldRates)[]).some((k) => r[k] !== cur[k])) {
      this.zones.setRates(r);
      this.log.info({ rates: r }, 'world rates');
    }
  }

  // --- Custom spawns ------------------------------------------------------------------

  catalog() {
    const creatures = Object.values(MOB_ARCHETYPES)
      .filter((a) => a.id !== 'spectral_ally')
      .map((a) => ({ id: a.id, name: a.name, hp: a.maxHp, xp: a.xpReward, goldMin: a.goldMin, goldMax: a.goldMax, passive: !!a.passive, loot: a.loot }))
      .sort((a, b) => Number(a.passive) - Number(b.passive) || a.name.localeCompare(b.name));
    const seen = new Set<string>();
    const items = [...this.items.values()]
      .filter((d) => !seen.has(d.id) && seen.add(d.id))
      .map((d) => ({ id: d.id, name: d.name, type: d.type }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { creatures, items, arenas: this.zones.arenas(), running: this.zones.names };
  }

  async spawn(admin: string, req: SpawnRequest): Promise<CustomSpawnView> {
    if (!MOB_ARCHETYPES[req.archetype]) throw new AdminError(`Unknown creature type ${req.archetype}.`);
    if (!this.zones.available(req.zone)) throw new AdminError(`${req.zone} is not available on this server.`);
    for (const l of req.loot ?? []) if (!this.items.get(l.itemId)) throw new AdminError(`Unknown item ${l.itemId}.`);
    // Next to a player: in his zone, whatever zone was chosen.
    let zone = req.zone;
    if ('player' in req.at) {
      const p = this.inWorld(req.at.player);
      zone = p.zone;
    }
    const host = await this.zoneCall(async () => ({ data: await this.zones.get(zone) }));
    const id = randomUUID();
    const expiresAt = Date.now() + req.minutes * 60_000;
    const { zone: _z, at, ...rest } = req;
    const spec: CustomSpawnSpec = { ...rest, id, at: 'player' in at || 'start' in at ? at : { ...at, yaw: 0 }, expiresAt };
    this.zones.pin(zone);
    let ids: number[];
    try {
      ids = await this.zoneCall(() => host.request({ kind: 'spawn', spec })) as number[];
    } catch (err) {
      this.zones.unpin(zone);
      throw err;
    }
    const base = MOB_ARCHETYPES[req.archetype]!;
    const view: CustomSpawnView = { id, zone, archetype: req.archetype, name: req.name || base.name, count: ids.length, alive: ids.length, respawn: req.respawn, expiresAt, createdBy: admin };
    this.spawns.set(id, { view });
    const where = 'player' in req.at ? `near ${req.at.player}` : 'start' in req.at ? 'at the start point' : `at ${req.at.x.toFixed(1)}, ${req.at.y.toFixed(1)}, ${req.at.z.toFixed(1)}`;
    await this.audit(admin, 'spawn', `${view.count} × ${view.name}`, `${zone} ${where} · hp ${req.hp ?? base.maxHp} · dmg ×${req.damage} · scale ×${req.scale} · speed ×${req.speed} · ${req.minutes} min${req.respawn ? ' · respawns' : ''}`);
    return view;
  }

  async listSpawns(): Promise<CustomSpawnView[]> {
    const reports = await this.reports([...this.spawns.values()].map((s) => s.view.zone));
    for (const [id, s] of [...this.spawns]) {
      const r = reports.get(s.view.zone);
      const seen = r?.spawns.find((x) => x.id === id);
      // All killed (and not coming back), or its zone stopped: gone.
      if (!seen && (r || !this.zones.host(s.view.zone))) {
        this.spawns.delete(id);
        this.zones.unpin(s.view.zone);
        continue;
      }
      if (seen) s.view.alive = seen.alive;
    }
    return [...this.spawns.values()].map((s) => ({ ...s.view }));
  }

  async despawn(admin: string, id: string): Promise<void> {
    const s = this.spawns.get(id);
    if (!s) throw new AdminError('That spawn is already gone.');
    this.spawns.delete(id);
    const host = this.zones.host(s.view.zone);
    if (host) await this.zoneCall(() => host.request({ kind: 'despawn', id }));
    this.zones.unpin(s.view.zone);
    await this.audit(admin, 'despawn', `${s.view.count} × ${s.view.name}`, s.view.zone);
  }

  // --- Audit ----------------------------------------------------------------------------

  async audit(admin: string, action: string, target: string | null, detail: string | null): Promise<void> {
    this.log.info({ admin, action, target, detail }, 'admin action');
    try {
      await this.repo.log(admin, action, target, detail);
    } catch (err) {
      this.log.error({ err }, 'admin audit failed');
    }
  }

  auditLog() {
    return this.repo.actions();
  }
}
