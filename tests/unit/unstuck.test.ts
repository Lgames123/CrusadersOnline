import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  INPUT_PACKET_MAX_BYTES,
  SC,
  TICK_RATE,
  createSyntheticArena,
  encodeInput,
  initPhysics,
  quantizeAngle,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

function setup(hp = 65) {
  const messages: ServerControlMsg[] = [];
  const zone = new WorldZone(rapier, 'test', createSyntheticArena(), {
    send: (_conn, data) => {
      if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg);
    },
    persist: () => {},
  }, { random: () => 0 });
  const id = zone.join(1, { name: 'Tester', characterId: 'c1', position: { x: 5, y: 0.5, z: 5 }, hp });
  const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
  let tick = 0;
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      const len = encodeInput(buf, 0, [{ clientTick: ++tick, flags: 0, yaw: quantizeAngle(0), pitch: 0 }]);
      zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      zone.step();
    }
  };
  const me = () => zone.inspect().find((a) => a.id === id)!;
  const notices = () => messages.filter((m) => m.op === SC.CHAT_BROADCAST).map((m) => (m.d as { kind?: string; text: string }));
  return { zone, run, me, notices };
}

describe('Unstuck (options menu)', () => {
  const back = createSyntheticArena().spawnPoints[0]!;
  const near = (a: { x: number; z: number }) => Math.hypot(a.x - back.x, a.z - back.z) < 0.1;

  it('puts the player back at his respawn spot, then waits out its cooldown', () => {
    const t = setup();
    t.run(5);
    expect(near(t.me())).toBe(false);
    t.zone.unstuck(1);
    t.run(1);
    expect(near(t.me())).toBe(true);
    expect(t.notices().at(-1)).toMatchObject({ kind: 'info' });

    // A second Unstuck within the cooldown is refused.
    t.zone.unstuck(1);
    expect(t.notices().at(-1)).toMatchObject({ kind: 'error' });
    t.run(30 * TICK_RATE);
    t.zone.unstuck(1);
    expect(t.notices().at(-1)).toMatchObject({ kind: 'info' });
  });
});
