import { parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { createSyntheticArena, initPhysics, type ArenaDef } from '@crusaders/shared';
import { SimulationClock, TickStats } from '../simulation/clock.ts';
import { WorldZone } from '../simulation/world_zone.ts';
import type { FromZone, ToZone, ZoneWorkerData } from './messages.ts';

const METRICS_EVERY_TICKS = 100; // 5 s
const PERSIST_EVERY_TICKS = 20 * 60; // 60 s (persistence.md §2)

const port = parentPort!;
const { zone: zoneName, arena: arenaName } = workerData as ZoneWorkerData;

function loadArena(name: string): ArenaDef {
  if (name === 'synthetic-arena') return createSyntheticArena();
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
});

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
      zone.attack(msg.connId);
      break;
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
