import { parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BUILTIN_ITEMS, LEVEL_PREFIX, buildLevelArena, catalogFromItemRules, gameplayFeatures, createSyntheticArena, initPhysics, spellTableFromRules, type ArenaDef, type ItemCatalog, type LevelPlacements, type SpellTable } from '@crusaders/shared';
import { SimulationClock, TickStats } from '../simulation/clock.ts';
import { WorldZone } from '../simulation/world_zone.ts';
import type { FromZone, ToZone, ZoneReply, ZoneWorkerData } from './messages.ts';

const METRICS_EVERY_TICKS = 100; // 5 s
const PERSIST_EVERY_TICKS = 20 * 60; // 60 s (persistence.md §2)

const port = parentPort!;
const { zone: zoneName, arena: arenaName, difficulty, features, itemRulesPath, generatedDir, rates } = workerData as ZoneWorkerData;

function loadItems(file: string | null): ItemCatalog {
  if (!file) return BUILTIN_ITEMS;
  return catalogFromItemRules(JSON.parse(readFileSync(file, 'utf8')) as Parameters<typeof catalogFromItemRules>[0]);
}

/** Drake's spell table from the converted default.ctx (rules/default.json), when present. */
function loadSpells(dir: string): SpellTable | undefined {
  const file = path.join(dir, 'rules', 'default.json');
  if (!existsSync(file)) return undefined;
  const rules = JSON.parse(readFileSync(file, 'utf8')) as { drake?: { spells?: Record<string, number[][]> } };
  return rules.drake?.spells ? spellTableFromRules(rules.drake.spells) : undefined;
}

function loadArena(name: string): ArenaDef {
  if (name === 'synthetic-arena') return createSyntheticArena();
  if (name.startsWith(LEVEL_PREFIX)) {
    const act = name.slice(LEVEL_PREFIX.length);
    if (!/^[a-z0-9_-]+$/.test(act)) throw new Error(`invalid level name ${name}`);
    const placements = JSON.parse(readFileSync(path.join(generatedDir, 'levels', `${act}.placements.json`), 'utf8')) as LevelPlacements;
    const collision = new Uint8Array(readFileSync(path.join(generatedDir, 'levels', `${placements.mesh}.collision.bin`)));
    return buildLevelArena(name, collision, placements, difficulty);
  }
  throw new Error(`unknown arena ${name}`);
}

const post = (msg: FromZone, transfer: ArrayBuffer[] = []) => port.postMessage(msg, transfer);

const rapier = await initPhysics();
let batch: [number, ArrayBuffer | string][] = [];
let transfer: ArrayBuffer[] = [];
const zone = new WorldZone(rapier, zoneName, loadArena(arenaName), {
  send(connId, data) {
    if (typeof data === 'string') {
      batch.push([connId, data]);
    } else {
      const buf = data.buffer as ArrayBuffer; // world_zone sends exact-size copies
      batch.push([connId, buf]);
      transfer.push(buf);
    }
  },
  persist(records, reason) {
    post({ t: 'persist', reason, records });
  },
  portal(connId, target, keep, via, waypoint) {
    post({ t: 'portal', connId, target, ...(keep ? { keep } : {}), ...(via ? { via } : {}), ...(waypoint ? { waypoint } : {}) });
  },
  loot(event) {
    post({ t: 'loot', event });
  },
}, { difficulty, features: gameplayFeatures(features ?? []), items: loadItems(itemRulesPath), spells: loadSpells(generatedDir) });
if (rates) zone.setRates(rates);

const flush = () => {
  if (batch.length === 0) return;
  post({ t: 'out', tick: zone.tick, batch }, transfer);
  batch = [];
  transfer = [];
};

port.on('message', (msg: ToZone) => {
  switch (msg.t) {
    case 'join':
      zone.join(msg.connId, msg.opts);
      flush();
      break;
    case 'leave': {
      flush();
      const record = zone.leave(msg.connId);
      if (record) post({ t: 'persist', reason: 'leave', records: [record] });
      break;
    }
    case 'input':
      zone.receiveInput(msg.connId, new DataView(msg.data));
      break;
    case 'attack':
      zone.attack(msg.connId, msg.kind);
      break;
    case 'cast':
      zone.castSpell(msg.connId);
      break;
    case 'selectSpell':
      zone.selectSpell(msg.connId, msg.spell);
      flush();
      break;
    case 'equip':
      zone.equip(msg.connId, msg.slot, msg.equip, msg.itemId, msg.to);
      flush();
      break;
    case 'moveInventoryItem':
      zone.moveInventoryItem(msg.connId, msg.slot, msg.x, msg.y, msg.itemId);
      flush();
      break;
    case 'mergeInventoryStacks':
      zone.mergeInventoryStacks(msg.connId, msg.fromSlot, msg.toSlot);
      flush();
      break;
    case 'splitInventoryStack':
      zone.splitInventoryStack(msg.connId, msg.slot, msg.quantity);
      flush();
      break;
    case 'dropInventoryItem':
      zone.dropInventoryItem(msg.connId, msg.slot, msg.itemId);
      flush();
      break;
    case 'interact':
      zone.interact(msg.connId, msg.object, msg.key);
      flush();
      break;
    case 'shopOpen':
      zone.shopOpen(msg.connId, msg.shop);
      flush();
      break;
    case 'shopBuy':
      zone.shopBuy(msg.connId, msg.shop, msg.index, msg.itemId);
      flush();
      break;
    case 'shopSell':
      zone.shopSell(msg.connId, msg.shop, msg.slot, msg.itemId);
      flush();
      break;
    case 'talk':
      zone.talk(msg.connId, msg.entity, msg.ms);
      break;
    case 'use':
      zone.useItem(msg.connId, msg.slot);
      flush();
      break;
    case 'cutsceneDone':
      zone.cutsceneDone(msg.connId, msg.sequence);
      flush();
      break;
    case 'unstuck':
      zone.unstuck(msg.connId);
      flush();
      break;
    case 'party':
      zone.setParty(msg.connId, msg.party);
      break;
    case 'waypoint':
      zone.waypointTravel(msg.connId, msg.act);
      flush();
      break;
    case 'transfer': {
      flush();
      const r = zone.leaveForTransfer(msg.connId);
      post({ t: 'transferred', connId: msg.connId, record: r?.record ?? null, state: r?.state ?? null });
      break;
    }
    case 'rates':
      zone.setRates(msg.rates);
      break;
    case 'request': {
      let reply: ZoneReply;
      try {
        const r = msg.req;
        const data = r.kind === 'report' ? zone.adminReport() : r.kind === 'spawn' ? zone.spawnCustom(r.spec) : r.kind === 'despawn' ? zone.despawnCustom(r.id) : zone.adminPlayer(r.connId, r.op);
        reply = { ok: true, data };
      } catch (err) {
        reply = { ok: false, error: (err as Error).message };
      }
      flush();
      post({ t: 'reply', reqId: msg.reqId, reply });
      break;
    }
    case 'stop':
      clock.stop();
      flush();
      post({ t: 'persist', reason: 'shutdown', records: zone.persistAll() });
      post({ t: 'stopped' });
      port.close();
      break;
  }
});

const clock = new SimulationClock();
const stats = new TickStats();
clock.start((tick) => {
  const t0 = performance.now();
  zone.step();
  flush();
  stats.record(performance.now() - t0);
  if (tick % PERSIST_EVERY_TICKS === 0) {
    const records = zone.persistAll();
    if (records.length > 0) post({ t: 'persist', reason: 'periodic', records });
  }
  if (tick % METRICS_EVERY_TICKS === 0) {
    const s = stats.drain();
    post({ t: 'metrics', metrics: { zone: zoneName, players: zone.playerCount, ticks: s.count, p50: s.p50, p99: s.p99, max: s.max, late: s.late } });
  }
});

post({ t: 'ready', zone: zoneName });
