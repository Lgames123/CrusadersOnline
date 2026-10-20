/**
 * Load test (milestone 10): N headless bot clients play in one zone while the server reports
 * its tick duration. Run from the repository root:
 *
 *   node tests/load/bot_swarm.ts [--bots 100] [--seconds 60] [--arena synthetic-arena]
 *
 * The server runs in this process (its zone simulation runs in a worker thread, so the bots'
 * client-side prediction does not share the zone's thread). Bots are guests: they run, turn,
 * jump, block and attack at random, sending inputs at the 20 Hz client rate like the browser.
 * Output: the zone's tick metrics every 5 s (p50 / p99 / max ms, late ticks) and a summary.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { startServer } from '@crusaders/server';
import { ClientSession, INPUT, LEVEL_PREFIX, buildLevelArena, createInputFrame, createSyntheticArena, initPhysics, quantizeAngle, type ArenaDef, type LevelPlacements } from '@crusaders/shared';

const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const BOTS = Number(arg('bots', '100'));
const SECONDS = Number(arg('seconds', '60'));
const ARENA = arg('arena', 'synthetic-arena');
const TARGET_P99_MS = 15;
const TARGET_KBPS = 5;

interface Metrics { zone: string; players: number; ticks: number; p50: number; p99: number; max: number; late: number }
const samples: Metrics[] = [];
// Collect the zone's tick metrics from the server's log stream (debug level).
const sink = new Writable({
  write(chunk: Buffer, _enc, done) {
    for (const line of chunk.toString().split('\n')) {
      if (!line.includes('zone tick metrics')) continue;
      try {
        const m = JSON.parse(line) as Metrics;
        samples.push(m);
        console.log(`[tick] players ${String(m.players).padStart(3)}  p50 ${m.p50.toFixed(2)} ms  p99 ${m.p99.toFixed(2)} ms  max ${m.max.toFixed(2)} ms  late ${m.late}/${m.ticks}`);
      } catch { /* not JSON */ }
    }
    done();
  },
});

const dir = await mkdtemp(path.join(tmpdir(), 'crusaders-load-'));
const server = await startServer(
  { port: 0, host: '127.0.0.1', env: 'test', logLevel: 'debug', httpBurst: 100_000, httpRate: 100_000, databaseUrl: `pglite:${dir}`, arena: ARENA },
  pino({ level: 'debug' }, sink),
);
const rapier = await initPhysics();
/** The bots load the same arena as the zone (a converted level from local/generated, like the browser). */
function loadArena(name: string): ArenaDef {
  if (!name.startsWith(LEVEL_PREFIX)) return createSyntheticArena();
  const dir = path.resolve(import.meta.dirname, '../../local/generated/levels');
  const placements = JSON.parse(readFileSync(path.join(dir, `${name.slice(LEVEL_PREFIX.length)}.placements.json`), 'utf8')) as LevelPlacements;
  return buildLevelArena(name, new Uint8Array(readFileSync(path.join(dir, `${placements.mesh}.collision.bin`))), placements);
}
const arena = loadArena(ARENA);
const base = `http://127.0.0.1:${server.port}`;

/** One bot: a guest session that keeps changing what it does every 1-3 s. */
async function bot(i: number): Promise<{ session: ClientSession; stop: () => void }> {
  const res = await fetch(`${base}/api/dev/guest-ticket`, { method: 'POST' });
  const { ticket } = (await res.json()) as { ticket: string };
  const session = new ClientSession(rapier, arena);
  await session.connect(`ws://127.0.0.1:${server.port}/ws`, ticket);
  const input = createInputFrame();
  let flags = 0;
  let yaw = Math.random() * Math.PI * 2;
  let nextChange = 0;
  let t = 0;
  const timer = setInterval(() => {
    t++;
    if (t >= nextChange) {
      nextChange = t + 20 + Math.floor(Math.random() * 40);
      const r = Math.random();
      flags = r < 0.5 ? INPUT.FORWARD : r < 0.6 ? INPUT.FORWARD | INPUT.WALK : r < 0.7 ? INPUT.LEFT : r < 0.8 ? INPUT.BLOCK : 0;
      yaw += (Math.random() - 0.5) * 2;
    }
    input.flags = flags | (Math.random() < 0.02 ? INPUT.JUMP : 0);
    input.yaw = quantizeAngle(yaw);
    session.tick(input);
    if (Math.random() < 0.03) session.attack();
  }, 50 + (i % 5)); // slightly spread so the bots do not tick in lockstep
  return { session, stop: () => clearInterval(timer) };
}

console.log(`starting ${BOTS} bots in ${ARENA} for ${SECONDS} s ...`);
const bots: { session: ClientSession; stop: () => void }[] = [];
for (let i = 0; i < BOTS; i++) {
  try {
    bots.push(await bot(i));
  } catch (err) {
    console.error(`bot ${i} failed to connect:`, (err as Error).message);
  }
}
console.log(`${bots.length} bots connected`);
// Bandwidth is measured once everyone is in (the spawn bursts are not steady state).
const bytesAtStart = bots.reduce((s, b) => s + b.session.stats.bytesIn, 0);
const measuredFrom = performance.now();
await new Promise((r) => setTimeout(r, SECONDS * 1000));
const kbPerClient = (bots.reduce((s, b) => s + b.session.stats.bytesIn, 0) - bytesAtStart) / 1024 / ((performance.now() - measuredFrom) / 1000) / Math.max(1, bots.length);

for (const b of bots) b.stop();
const corrections = bots.reduce((s, b) => s + b.session.stats.corrections, 0);
for (const b of bots) b.session.close();
await server.close();
await rm(dir, { recursive: true, force: true });

const loaded = samples.filter((m) => m.players >= Math.max(1, Math.floor(bots.length * 0.9)));
const worstP99 = Math.max(0, ...loaded.map((m) => m.p99));
const worstMax = Math.max(0, ...loaded.map((m) => m.max));
const meanP50 = loaded.length ? loaded.reduce((s, m) => s + m.p50, 0) / loaded.length : 0;
const late = loaded.reduce((s, m) => s + m.late, 0);
const ticks = loaded.reduce((s, m) => s + m.ticks, 0);
console.log('\n--- summary ---');
console.log(`bots ${bots.length}  windows ${loaded.length}  mean p50 ${meanP50.toFixed(2)} ms  worst p99 ${worstP99.toFixed(2)} ms  worst max ${worstMax.toFixed(2)} ms  late ticks ${late}/${ticks}  client corrections ${corrections}`);
console.log(`down per client ${kbPerClient.toFixed(1)} KB/s (target ${TARGET_KBPS} KB/s at 100 players)`);
console.log(worstP99 < TARGET_P99_MS ? `PASS: p99 below ${TARGET_P99_MS} ms` : `FAIL: p99 ${worstP99.toFixed(2)} ms >= ${TARGET_P99_MS} ms`);
process.exit(worstP99 < TARGET_P99_MS ? 0 : 1);
