/**
 * Child process for persistence.test.ts: joins the world, walks, then stops servicing its
 * socket (busy loop) — like a client whose network died — so the server must save the
 * character during shutdown without the WebSocket close handshake ever completing.
 * argv: <port> <ticket>
 */
import { ClientSession, INPUT, createSyntheticArena, initPhysics, quantizeAngle } from '@crusaders/shared';

const [port, ticket] = process.argv.slice(2);
const rapier = await initPhysics();
const s = new ClientSession(rapier, createSyntheticArena());
await s.connect(`ws://127.0.0.1:${port}/ws`, ticket!);
const input = { clientTick: 0, flags: INPUT.RIGHT, yaw: quantizeAngle(0), pitch: 0 };
for (let i = 0; i < 20; i++) {
  s.tick(input);
  await new Promise((r) => setTimeout(r, 50));
}
await new Promise((r) => setTimeout(r, 300));
const p = s.character!.position;
process.stdout.write(`${JSON.stringify({ x: p.x, y: p.y, z: p.z })}\n`);
for (;;) {
  // never yield: the socket is never read or closed from this side
}
