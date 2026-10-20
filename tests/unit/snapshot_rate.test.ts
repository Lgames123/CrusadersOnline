import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  INPUT,
  INPUT_PACKET_MAX_BYTES,
  SC,
  createEntityState,
  createSyntheticArena,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
  initPhysics,
  quantizeAngle,
  snapshotBaselineTick,
  snapshotMaxBytes,
  updateInterval,
  type EntityState,
  type Rapier,
  type SnapshotHeader,
} from '@crusaders/shared';

/** Snapshot bandwidth (performance-testing.md §3): compact encoding and per-receiver rates. */
let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

const header = (tick: number, baseline: number): SnapshotHeader => ({
  serverTick: tick, baselineTick: baseline, lastProcessedInput: 0, selfVelY: 0, selfGrounded: true, selfRollDir: 0, selfRollTicks: 0,
  selfAirKind: 0, selfAirVelX: 0, selfAirVelZ: 0, selfAirTravel: 0, selfAirRise: 0, selfLocoState: 0, selfLocoFrame: 0,
});
const at = (id: number, x: number, z = 0): EntityState => ({ ...createEntityState(id), x, y: 100, z, yaw: 7, hp: 50 });

function encode(cur: Map<number, EntityState>, base: Map<number, EntityState> | null, plan?: Map<number, { mask: number; interval: number }>) {
  const view = new DataView(new ArrayBuffer(snapshotMaxBytes(cur.size, base?.size ?? 0)));
  return new DataView(view.buffer, 0, encodeSnapshot(view, header(20, base ? 10 : 0), cur, base, plan));
}

describe('snapshot encoding', () => {
  it('large ids, int16 position deltas, far jumps in full, varint removals', () => {
    const base = new Map([[3, at(3, 1000)], [200_000, at(200_000, 5000)], [9, at(9, 0)], [70_000, at(70_000, 1)]]);
    const cur = new Map([[3, at(3, 1300, -200)], [200_000, at(200_000, 5000 + 40_000)], [9, at(9, 0)], [5, at(5, 77)]]);
    const out = new Map<number, EntityState>();
    const sent = new Map<number, number>();
    expect(decodeSnapshot(encode(cur, base), base, out, sent)).not.toBeNull();
    expect(out).toEqual(cur);
    expect([...sent.keys()].sort((a, b) => a - b)).toEqual([3, 5, 200_000]);
    // A small move costs 1 (id) + 1 (mask) + 6 bytes.
    const one = encode(new Map([[3, at(3, 1300)]]), new Map([[3, at(3, 1000)]]));
    expect(one.byteLength).toBe(16 + 1 + 1 + 6 + 2);
  });

  it('a plan writes only its entities, with their intervals; the rest decode as the baseline', () => {
    const base = new Map([[1, at(1, 0)], [2, at(2, 0)]]);
    const cur = new Map([[1, at(1, 500)], [2, at(2, 500)]]);
    const out = new Map<number, EntityState>();
    const sent = new Map<number, number>();
    decodeSnapshot(encode(cur, base, new Map([[2, { mask: 1, interval: 4 }]])), base, out, sent);
    expect(sent).toEqual(new Map([[2, 4]]));
    expect(out.get(1)).toEqual(at(1, 0));
    expect(out.get(2)).toEqual(at(2, 500));
  });

  it('rates: near and nearest at 20 Hz, a crowd and far ones slower', () => {
    expect(updateInterval(50, 3)).toBe(1);
    expect(updateInterval(3, 30)).toBe(1);
    expect(updateInterval(12, 20)).toBe(2);
    expect(updateInterval(20, 20)).toBe(4);
    expect(updateInterval(30, 6)).toBe(8);
    expect(updateInterval(0, 45)).toBe(4);
    expect(updateInterval(0, 60)).toBe(8);
  });
});

describe('per-receiver update rates in the zone', () => {
  it('what the viewer draws is always what the server last wrote to him, for less bandwidth', () => {
    const frames: Uint8Array[] = [];
    const zone = new WorldZone(rapier, 'crowd', createSyntheticArena(), {
      send: (conn, data) => {
        if (conn === 1 && typeof data !== 'string' && data[0] === SC.WORLD_SNAPSHOT) frames.push(data);
      },
      persist: () => {},
    }, { random: () => 0.5 });
    const r = ((s) => () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31))(42);
    const N = 25;
    for (let i = 1; i <= N; i++) zone.join(i, { name: `P${i}`, characterId: `c${i}`, position: { x: i === 1 ? 0 : (r() - 0.5) * 50, y: 0.5, z: i === 1 ? 0 : (r() - 0.5) * 50 } });
    const internals = zone as unknown as { players: Map<number, { sent: Map<number, { state: EntityState }>; entityId: number }> };
    const viewer = internals.players.get(1)!;
    const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
    const yaws = Array.from({ length: N + 1 }, () => r() * Math.PI * 2);
    const baselines = new Map<number, Map<number, EntityState>>();
    const drawn = new Map<number, EntityState>();
    const sent = new Map<number, number>();
    let acked = 0;
    let bytes = 0;
    let written = 0;
    let visible = 0;
    for (let tick = 1; tick <= 200; tick++) {
      for (let i = 1; i <= N; i++) {
        if (r() < 0.05) yaws[i] = r() * Math.PI * 2;
        const flags = i === 1 ? 0 : r() < 0.8 ? INPUT.FORWARD : 0;
        // The viewer acknowledges what he decoded three ticks ago (a round trip).
        const len = encodeInput(buf, i === 1 ? acked : 0, [{ clientTick: tick, flags, yaw: quantizeAngle(yaws[i]!), pitch: 0 }]);
        zone.receiveInput(i, new DataView(buf.buffer.slice(0, len)));
      }
      zone.step();
      const frame = frames.shift()!;
      frames.length = 0;
      bytes += frame.byteLength;
      const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
      const state = new Map<number, EntityState>();
      const h = decodeSnapshot(view, baselines.get(snapshotBaselineTick(view)) ?? null, state, sent);
      expect(h).not.toBeNull();
      baselines.set(h!.serverTick, state);
      if (tick > 3) acked = h!.serverTick - 3;
      for (const id of sent.keys()) drawn.set(id, { ...state.get(id)! });
      written += sent.size;
      visible += state.size;
      for (const [id, s] of viewer.sent) if (id !== viewer.entityId) expect(drawn.get(id), `entity ${id} at tick ${tick}`).toEqual(s.state);
    }
    // Everyone around is drawn, but not every one of them is written every tick.
    expect(viewer.sent.size).toBeGreaterThan(15);
    expect(written).toBeLessThan(visible * 0.8);
    expect(bytes / 200).toBeLessThan(400);
  });
});
