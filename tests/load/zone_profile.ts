/**
 * Profiles one zone's tick without the network: N players joined directly, random inputs.
 *
 *   node --cpu-prof --cpu-prof-dir=local/profiles tests/load/zone_profile.ts [--players 100] [--ticks 600] [--arena level:ca1a]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import { INPUT, INPUT_PACKET_MAX_BYTES, LEVEL_PREFIX, buildLevelArena, createSyntheticArena, encodeInput, initPhysics, quantizeAngle, type ArenaDef, type LevelPlacements } from '@crusaders/shared';

const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const PLAYERS = Number(arg('players', '100'));
const TICKS = Number(arg('ticks', '600'));
const ARENA = arg('arena', 'level:ca1a');

function loadArena(name: string): ArenaDef {
  if (!name.startsWith(LEVEL_PREFIX)) return createSyntheticArena();
  const dir = path.resolve(import.meta.dirname, '../../local/generated/levels');
  const placements = JSON.parse(readFileSync(path.join(dir, `${name.slice(LEVEL_PREFIX.length)}.placements.json`), 'utf8')) as LevelPlacements;
  return buildLevelArena(name, new Uint8Array(readFileSync(path.join(dir, `${placements.mesh}.collision.bin`))), placements);
}

const rapier = await initPhysics();
let bytes = 0;
const zone = new WorldZone(rapier, ARENA, loadArena(ARENA), { send: (_c, data) => { bytes += typeof data === 'string' ? data.length : data.byteLength; } });
for (let i = 1; i <= PLAYERS; i++) zone.join(i, { name: `bot${i}`, characterId: null });
// Count the character controller's collision queries per tick.
const ctrl = (zone as unknown as { mw: { controller: { computeColliderMovement: (...a: unknown[]) => void } } }).mw.controller;
let queries = 0;
let queryMs = 0;
const original = ctrl.computeColliderMovement.bind(ctrl);
ctrl.computeColliderMovement = (...args: unknown[]) => { queries++; const t = performance.now(); original(...args); queryMs += performance.now() - t; };
const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
const state = Array.from({ length: PLAYERS }, () => ({ flags: 0, yaw: Math.random() * 6.28, next: 0, tick: 0 }));
const times: number[] = [];
for (let t = 0; t < TICKS; t++) {
  for (let i = 0; i < PLAYERS; i++) {
    const s = state[i]!;
    if (t >= s.next) {
      s.next = t + 20 + Math.floor(Math.random() * 40);
      const r = Math.random();
      s.flags = r < 0.5 ? INPUT.FORWARD : r < 0.6 ? INPUT.FORWARD | INPUT.WALK : r < 0.7 ? INPUT.LEFT : r < 0.8 ? INPUT.BLOCK : 0;
      s.yaw += (Math.random() - 0.5) * 2;
    }
    const len = encodeInput(buf, 0, [{ clientTick: ++s.tick, flags: s.flags, yaw: quantizeAngle(s.yaw), pitch: 0 }]);
    zone.receiveInput(i + 1, new DataView(buf.buffer.slice(0, len)));
    if (Math.random() < 0.03) zone.attack(i + 1);
  }
  const t0 = performance.now();
  zone.step();
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const q = (p: number) => times[Math.floor((times.length - 1) * p)]!.toFixed(2);
console.log(`controller queries ${(queries / TICKS).toFixed(1)}/tick, ${(queryMs / TICKS).toFixed(2)} ms/tick`);
console.log(`${PLAYERS} players, ${TICKS} ticks in ${ARENA}: p50 ${q(0.5)} ms  p99 ${q(0.99)} ms  max ${q(1)} ms  out ${(bytes / TICKS / 1024).toFixed(1)} KiB/tick`);
