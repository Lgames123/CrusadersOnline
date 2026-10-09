import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '@crusaders/server';
import {
  CS,
  ClientSession,
  INPUT,
  INTERP_DELAY_TICKS,
  createSyntheticArena,
  initPhysics,
  quantizeAngle,
  type InputFrame,
  type Rapier,
  type RemoteSample,
} from '@crusaders/shared';

let server: RunningServer;
let rapier: Rapier;
const arena = createSyntheticArena();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  rapier = await initPhysics();
  server = await startServer({ port: 0, host: '127.0.0.1', env: 'test', logLevel: 'silent', databaseUrl: 'pglite:memory', httpBurst: 1000 });
});

afterAll(async () => {
  await server?.close();
});

async function ticket(): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${server.port}/api/dev/guest-ticket`, { method: 'POST' });
  return ((await res.json()) as { ticket: string }).ticket;
}

async function connect(events: ConstructorParameters<typeof ClientSession>[2] = {}): Promise<ClientSession> {
  const s = new ClientSession(rapier, arena, events);
  await s.connect(`ws://127.0.0.1:${server.port}/ws`, await ticket());
  return s;
}

/** Drives sessions at the real 20 Hz rate; `perTick` client steps per 50 ms (1 = honest). */
async function drive(sessions: { s: ClientSession; input: InputFrame; perTick?: number }[], ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    for (const { s, input, perTick = 1 } of sessions) for (let k = 0; k < perTick; k++) s.tick(input);
    await sleep(50);
  }
}

const idle = (): InputFrame => ({ clientTick: 0, flags: 0, yaw: 0, pitch: 0 });

describe('authoritative multiplayer (M06)', () => {
  it('two clients see each other and remote movement is interpolated', async () => {
    const spawned: string[] = [];
    const a = await connect();
    const b = await connect({ spawn: (_id, name) => spawned.push(name) });
    await drive([{ s: a, input: idle() }, { s: b, input: idle() }], 20); // settle onto the floor
    expect(spawned).toContain(a.accountName);

    const startA = { ...a.character!.position };
    const forward: InputFrame = { clientTick: 0, flags: INPUT.FORWARD, yaw: quantizeAngle(0), pitch: 0 };
    await drive([{ s: a, input: forward }, { s: b, input: idle() }], 20);
    await drive([{ s: a, input: idle() }, { s: b, input: idle() }], 6);

    // Client A's prediction agrees with the server: no corrections on localhost.
    expect(a.stats.corrections).toBe(0);
    const travelled = startA.z - a.character!.position.z;
    expect(travelled).toBeGreaterThan(5.5);
    expect(travelled).toBeLessThan(6.5);

    // Client B sees A at A's authoritative position (A is idle now).
    const seen: RemoteSample = { x: 0, y: 0, z: 0, yaw: 0, anim: 0, hp: 0 };
    expect(b.sampleRemote(a.entityId, b.estimateServerTick() - INTERP_DELAY_TICKS, seen)).toBe(true);
    expect(Math.abs(seen.z - a.character!.position.z)).toBeLessThan(0.05);
    expect(Math.abs(seen.x - a.character!.position.x)).toBeLessThan(0.05);

    a.close();
    b.close();
  });

  it('sending inputs faster than 20 Hz does not move a character faster', async () => {
    const cheater = await connect();
    const observer = await connect();
    await drive([{ s: cheater, input: idle() }, { s: observer, input: idle() }], 20);
    const seen: RemoteSample = { x: 0, y: 0, z: 0, yaw: 0, anim: 0, hp: 0 };
    const start = { ...cheater.character!.position };

    // 2x input rate for 1 s: under the rate limiter's burst, so the socket stays open.
    const forward: InputFrame = { clientTick: 0, flags: INPUT.FORWARD, yaw: quantizeAngle(0), pitch: 0 };
    const t0 = performance.now();
    await drive([{ s: cheater, input: forward, perTick: 2 }, { s: observer, input: idle() }], 20);
    const elapsed = (performance.now() - t0) / 1000;
    // The cheater's own (unreconciled) prediction ran ~2x as far.
    const predictedRun = 40 * 0.3;
    await drive([{ s: cheater, input: idle() }, { s: observer, input: idle() }], 10);

    expect(observer.sampleRemote(cheater.entityId, observer.estimateServerTick(), seen)).toBe(true);
    const authoritative = Math.hypot(seen.x - start.x, seen.z - start.z);
    // Server moved at run speed for the elapsed time plus at most the queued frames (InputQueue.CAPACITY).
    expect(authoritative).toBeLessThan(6.0 * elapsed + 4 * 0.3 + 0.05);
    expect(authoritative).toBeLessThan(predictedRun * 0.8);
    // And the cheater was pulled back to the authoritative position.
    expect(cheater.stats.corrections).toBeGreaterThan(0);
    expect(Math.abs(cheater.character!.position.z - seen.z)).toBeLessThan(0.05);
    cheater.close();
    observer.close();
  });

  it('closes connections that flood inputs (rate limit)', async () => {
    const flooder = await connect();
    const closed = new Promise<number>((resolve) => {
      (flooder as unknown as { events: { close: (code: number) => void } }).events.close = (code) => resolve(code);
    });
    await drive([{ s: flooder, input: idle(), perTick: 10 }], 40);
    expect(await Promise.race([closed, sleep(3000).then(() => -1)])).toBe(1008);
  });

  it('rejects invalid and reused tickets', async () => {
    const t = await ticket();
    const ok = new ClientSession(rapier, arena);
    await ok.connect(`ws://127.0.0.1:${server.port}/ws`, t);
    ok.close();
    const reused = new ClientSession(rapier, arena);
    await expect(reused.connect(`ws://127.0.0.1:${server.port}/ws`, t)).rejects.toThrow(/4001/);
    const bogus = new ClientSession(rapier, arena);
    await expect(bogus.connect(`ws://127.0.0.1:${server.port}/ws`, 'x'.repeat(43))).rejects.toThrow(/4001/);
  });

  it('rejects binary frames before entering the world', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    const code = await new Promise<number>((resolve) => {
      ws.onopen = () => ws.send(new Uint8Array([CS.PLAYER_INPUT, 1, 0, 0, 0, 0]));
      ws.onclose = (e) => resolve(e.code);
    });
    expect(code).toBe(1008);
  });
});
